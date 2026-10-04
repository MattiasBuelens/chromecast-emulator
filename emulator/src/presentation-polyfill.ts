/**
 * Window-based Presentation API polyfill.
 *
 * Replaces the browser's Presentation API (https://w3c.github.io/presentation-api/)
 * with one that "presents" by opening the presentation URL in a new window and
 * exchanging messages with it through postMessage().
 *
 * Load this script in both pages, before anything that uses the Presentation API:
 *
 * - Controlling page: `PresentationRequest#start()` opens the URL in a popup window,
 *   and resolves with a `PresentationConnection` to it.
 * - Receiving page (the popup): `navigator.presentation.receiver.connectionList`
 *   resolves with the incoming connections from the opener window.
 *
 * Presentation URLs that are not plain http(s) URLs (such as `cast:` URLs) can be
 * mapped to a page URL with `presentationPolyfill.addUrlResolver()`.
 */
import { showPresentationDialog } from './shared/presentation-dialog'
import { defineEventHandlers, randomId } from './shared/utils'

export interface KnownPresentation {
	id: string
	url: string | null
}

export interface PresentationPolyfill {
	/**
	 * Register a function that maps a presentation URL to the URL of the page to open
	 * for it, or returns null when it does not handle that URL.
	 */
	addUrlResolver(resolver: (presentationUrl: string) => string | null): void
	/**
	 * Register a function that picks the ID for a new presentation of a presentation URL,
	 * or returns null to leave it to the next one (or a random ID).
	 */
	addPresentationIdGenerator(generator: (presentationUrl: string) => string | null): void
	/**
	 * Register a function that maps the ID passed to `PresentationRequest#reconnect()` to the ID
	 * of a known presentation, or returns null when it does not handle that ID.
	 */
	addReconnectResolver(
		resolver: (
			requestedId: string,
			requestUrls: readonly string[],
			known: KnownPresentation[]
		) => string | null
	): void
	/** Whether this page was opened as a presentation, by a page that also uses the polyfill. */
	isReceivingWindow: boolean
	/** The browser's own `navigator.presentation`, if any. */
	nativePresentation: Presentation | undefined
}

export interface PresentationConnectionPolyfillInfo {
	/** Whether the controlling page reconnected to the presentation, rather than starting it. */
	readonly reconnect: boolean
	/** The user agent of the controlling page. */
	readonly userAgent: string
}

declare global {
	interface Window {
		presentationPolyfill?: PresentationPolyfill
	}

	interface PresentationConnection {
		/**
		 * Not part of the spec: lets receiver-side code tell new sessions from reconnects.
		 * Only set on the receiving side.
		 */
		readonly polyfillInfo?: PresentationConnectionPolyfillInfo
	}
}

// Every message we post carries this key, so we can ignore unrelated postMessage() traffic.
const MESSAGE_KEY = '__presentationPolyfill'
// The receiving window's name starts with this prefix, followed by the presentation ID.
// The name survives reloads, so the receiving page can always tell it is a presentation.
const WINDOW_NAME_PREFIX = '__presentation__:'
const WINDOW_FEATURES = 'popup,width=1280,height=720'
const CLOSED_WINDOW_POLL_MS = 500
const RECEIVER_HEARTBEAT_MS = 1000
const RECEIVER_DISCOVERY_TIMEOUT_MS = 2 * RECEIVER_HEARTBEAT_MS + 500
const LOG_PREFIX = '[presentation-polyfill]'

const NativePresentation = navigator.presentation

/** The messages that the controlling and receiving windows exchange. */
type PolyfillMessage =
	| { type: 'receiver-hello' | 'receiver-alive'; presentationId: string; url: string | null }
	| {
			type: 'connect'
			connectionId: string
			presentationId: string
			url: string
			reconnect: boolean
			userAgent: string
	  }
	| { type: 'connected'; connectionId: string }
	| { type: 'message'; connectionId: string; data: MessageData }
	| { type: 'close'; connectionId: string; reason: CloseReason; message: string }
	| { type: 'terminate'; connectionId: string }
	| { type: 'terminated' }

type MessageType = PolyfillMessage['type']
type MessagePayload<T extends MessageType> = Omit<Extract<PolyfillMessage, { type: T }>, 'type'>
/** A message as it is posted: the type is under MESSAGE_KEY. */
type PostedMessage = { [MESSAGE_KEY]: MessageType } & Partial<Record<string, unknown>>

type MessageData = string | Blob | ArrayBuffer
type CloseReason = PresentationConnectionCloseReason

// ----------- Helpers

const domException = (name: string, message?: string) => new DOMException(message || name, name)

const post = <T extends MessageType>(target: Window, type: T, payload: MessagePayload<T>) => {
	// The receiving page may live on another origin, so we cannot restrict the target origin.
	// Both sides verify event.source instead.
	target.postMessage({ [MESSAGE_KEY]: type, ...payload }, '*')
}

/** Read a message that the other side posted, or null if it is not one of ours. */
const readMessage = (data: unknown): PolyfillMessage | null => {
	if (!data || typeof data !== 'object' || !(MESSAGE_KEY in data)) return null
	const { [MESSAGE_KEY]: type, ...payload } = data as PostedMessage
	return { type, ...payload } as PolyfillMessage
}

type UrlResolver = Parameters<PresentationPolyfill['addUrlResolver']>[0]
type IdGenerator = Parameters<PresentationPolyfill['addPresentationIdGenerator']>[0]
type ReconnectResolver = Parameters<PresentationPolyfill['addReconnectResolver']>[0]

const urlResolvers: UrlResolver[] = []
const idGenerators: IdGenerator[] = []
const reconnectResolvers: ReconnectResolver[] = []

/** Pick the ID for a new presentation of the given presentation URL. */
const createPresentationId = (presentationUrl: string): string => {
	for (const generator of idGenerators) {
		const id = generator(presentationUrl)
		if (id) return id
	}
	return randomId()
}

/** Map a presentation URL to the URL of the page to open, or null if unsupported. */
const resolvePageUrl = (presentationUrl: string): string | null => {
	for (const resolver of urlResolvers) {
		const resolved = resolver(presentationUrl)
		if (resolved) return resolved
	}
	const { protocol } = new URL(presentationUrl)
	return protocol === 'http:' || protocol === 'https:' ? presentationUrl : null
}

// ----------- Events

class PresentationConnectionAvailableEvent
	extends Event
	implements globalThis.PresentationConnectionAvailableEvent
{
	readonly connection: PresentationConnection

	constructor(type: string, init: EventInit & { connection: PresentationConnection }) {
		super(type, init)
		this.connection = init.connection
	}
}

class PresentationConnectionCloseEvent
	extends Event
	implements globalThis.PresentationConnectionCloseEvent
{
	readonly reason: CloseReason
	readonly message: string

	constructor(type: string, init: EventInit & { reason: CloseReason; message?: string }) {
		super(type, init)
		this.reason = init.reason
		this.message = init.message || ''
	}
}

// ----------- PresentationConnection

/** Carries a connection's messages to the other side. */
interface Transport {
	send(data: MessageData): void
	close(reason: CloseReason, message: string): void
	terminate(): void
}

const transportKey = Symbol('transport')

class PresentationConnection extends EventTarget implements globalThis.PresentationConnection {
	readonly id: string
	readonly url: string
	state: PresentationConnectionState = 'connecting'
	binaryType: BinaryType = 'arraybuffer'
	declare readonly polyfillInfo?: PresentationConnectionPolyfillInfo
	declare onconnect: globalThis.PresentationConnection['onconnect']
	declare onclose: globalThis.PresentationConnection['onclose']
	declare onterminate: globalThis.PresentationConnection['onterminate']
	declare onmessage: globalThis.PresentationConnection['onmessage']
	private readonly [transportKey]: Transport

	constructor(id: string, url: string, transport: Transport) {
		super()
		this.id = id
		this.url = url
		this[transportKey] = transport
	}

	send(data: string | Blob | ArrayBuffer | ArrayBufferView) {
		if (this.state !== 'connected') {
			throw domException('InvalidStateError', `Connection is ${this.state}`)
		}
		this[transportKey].send(toTransferable(data))
	}

	close() {
		if (this.state !== 'connecting' && this.state !== 'connected') return
		this[transportKey].close('closed', '')
		_closed(this, 'closed', '')
	}

	terminate() {
		if (this.state === 'terminated') return
		this[transportKey].terminate()
	}
}
defineEventHandlers(PresentationConnection.prototype, ['connect', 'close', 'terminate', 'message'])

const _connected = (connection: PresentationConnection) => {
	if (connection.state !== 'connecting') return
	connection.state = 'connected'
	connection.dispatchEvent(new Event('connect'))
}

const _closed = (connection: PresentationConnection, reason: CloseReason, message?: string) => {
	if (connection.state !== 'connecting' && connection.state !== 'connected') return
	connection.state = 'closed'
	connection.dispatchEvent(new PresentationConnectionCloseEvent('close', { reason, message }))
}

const _terminated = (connection: PresentationConnection) => {
	if (connection.state === 'terminated') return
	connection.state = 'terminated'
	connection.dispatchEvent(new Event('terminate'))
}

const _received = (connection: PresentationConnection, data: MessageData) => {
	if (connection.state !== 'connected') return
	if (data instanceof ArrayBuffer && connection.binaryType === 'blob') data = new Blob([data])
	connection.dispatchEvent(new MessageEvent('message', { data }))
}

const toTransferable = (data: unknown): MessageData => {
	if (typeof data === 'string' || data instanceof Blob || data instanceof ArrayBuffer) return data
	if (ArrayBuffer.isView(data)) {
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer
	}
	throw new TypeError('Unsupported message type')
}

// ----------- Controlling side

/** A presentation started (or rediscovered) by this page. */
interface ControlledPresentation {
	id: string
	url: string | null
	window: Window
	/**
	 * True if this page started it with `PresentationRequest#start()`, false if it rediscovered it
	 * from receiver heartbeats (e.g. after a reload).
	 */
	started: boolean
	connections: Map<string, PresentationConnection>
	receiverReady: boolean
	onReceiverReady: Array<{ resolve: () => void; reject: (error: Error) => void }>
}

/** Presentations started (or rediscovered) by this page, by presentation ID. */
const presentations = new Map<string, ControlledPresentation>()

const getOrCreatePresentation = (
	id: string,
	url: string | null,
	win: Window
): ControlledPresentation => {
	let presentation = presentations.get(id)
	if (!presentation) {
		presentation = {
			id,
			url,
			window: win,
			started: false,
			connections: new Map(),
			receiverReady: false,
			onReceiverReady: []
		}
		presentations.set(id, presentation)
		watchForClosedWindow(presentation)
	}
	return presentation
}

const watchForClosedWindow = (presentation: ControlledPresentation) => {
	const timer = setInterval(() => {
		if (presentation.window.closed) {
			clearInterval(timer)
			terminatePresentation(presentation)
		}
	}, CLOSED_WINDOW_POLL_MS)
}

const terminatePresentation = (presentation: ControlledPresentation) => {
	presentations.delete(presentation.id)
	// The window closed before the receiver was ready, e.g. because the user closed it.
	presentation.onReceiverReady
		.splice(0)
		.forEach(({ reject }) =>
			reject(domException('NotAllowedError', 'The presentation window was closed'))
		)
	for (const connection of presentation.connections.values()) _terminated(connection)
	presentation.connections.clear()
}

/** Terminate a presentation from the controlling side: close its window and tell everyone. */
const stopPresentation = (presentation: ControlledPresentation, connectionId = '') => {
	post(presentation.window, 'terminate', { connectionId })
	presentation.window.close()
	terminatePresentation(presentation)
}

/** The presentations whose window is still open. */
const livePresentations = () => [...presentations.values()].filter((p) => !p.window.closed)

const whenReceiverReady = (presentation: ControlledPresentation, timeoutMs?: number) =>
	new Promise<void>((resolve, reject) => {
		if (presentation.receiverReady) return resolve()
		presentation.onReceiverReady.push({ resolve, reject })
		if (timeoutMs) {
			setTimeout(() => reject(domException('NotFoundError', 'Receiver did not respond')), timeoutMs)
		}
	})

/** Create a controlling connection to a receiving window, and ask the receiver to accept it. */
const connectToPresentation = (
	presentation: ControlledPresentation,
	url: string,
	{ reconnect }: { reconnect: boolean }
) => {
	const connectionId = randomId()
	const connection = new PresentationConnection(presentation.id, url, {
		send(data) {
			post(presentation.window, 'message', { connectionId, data })
		},
		close(reason, message) {
			presentation.connections.delete(connectionId)
			post(presentation.window, 'close', { connectionId, reason, message })
		},
		terminate() {
			stopPresentation(presentation, connectionId)
		}
	})
	presentation.connections.set(connectionId, connection)
	post(presentation.window, 'connect', {
		connectionId,
		presentationId: presentation.id,
		url,
		reconnect,
		userAgent: navigator.userAgent
	})
	return connection
}

const findPresentationBySource = (source: MessageEventSource | null) => {
	for (const presentation of presentations.values()) {
		if (presentation.window === source) return presentation
	}
	return null
}

/** Handle messages from the receiving windows that this page opened. */
const listenToReceivers = () => {
	window.addEventListener('message', (event) => {
		const message = readMessage(event.data)
		if (!message) return

		// Heartbeats let a reloaded controlling page find receivers it opened before the reload.
		if (message.type === 'receiver-hello' || message.type === 'receiver-alive') {
			// The receiving window may be cross-origin, so `instanceof Window` would not work.
			const source = event.source as Window | null
			if (!source || !message.presentationId) return
			const presentation = getOrCreatePresentation(message.presentationId, message.url, source)
			if (presentation.window !== source) return
			if (!presentation.receiverReady) {
				presentation.receiverReady = true
				presentation.onReceiverReady.splice(0).forEach(({ resolve }) => resolve())
			}
			return
		}

		const presentation = findPresentationBySource(event.source)
		if (!presentation) return
		const connection =
			'connectionId' in message ? presentation.connections.get(message.connectionId) : undefined

		switch (message.type) {
			case 'connected':
				if (connection) _connected(connection)
				break
			case 'message':
				if (connection) _received(connection, message.data)
				break
			case 'close':
				if (connection) {
					presentation.connections.delete(message.connectionId)
					_closed(connection, message.reason || 'closed', message.message)
				}
				break
			case 'terminated':
				terminatePresentation(presentation)
				break
		}
	})

	window.addEventListener('pagehide', () => {
		for (const presentation of presentations.values()) {
			for (const [connectionId, connection] of presentation.connections) {
				if (connection.state === 'connected' || connection.state === 'connecting') {
					post(presentation.window, 'close', { connectionId, reason: 'wentaway', message: '' })
				}
			}
		}
	})
}

class PresentationAvailability extends EventTarget implements globalThis.PresentationAvailability {
	readonly value: boolean
	declare onchange: globalThis.PresentationAvailability['onchange']

	constructor(value: boolean) {
		super()
		this.value = value
	}
}
defineEventHandlers(PresentationAvailability.prototype, ['change'])

// Like the spec says, only one start() may be in progress at a time, across all requests.
let startInProgress = false

class PresentationRequest extends EventTarget implements globalThis.PresentationRequest {
	readonly urls: readonly string[]
	declare onconnectionavailable: globalThis.PresentationRequest['onconnectionavailable']
	private availability: Promise<PresentationAvailability> | undefined

	constructor(urls: string | string[]) {
		super()
		const list = Array.isArray(urls) ? urls : [urls]
		if (list.length === 0) throw domException('NotSupportedError', 'No presentation URLs')
		this.urls = list.map((url) => {
			try {
				return new URL(url, document.baseURI).href
			} catch {
				throw new DOMException(`Invalid presentation URL: ${url}`, 'SyntaxError')
			}
		})
	}

	/** Pick the first presentation URL we know how to open. */
	private _selectUrl() {
		for (const url of this.urls) {
			const pageUrl = resolvePageUrl(url)
			if (pageUrl) return { url, pageUrl }
		}
		return null
	}

	start(): Promise<PresentationConnection> {
		if (startInProgress) {
			return Promise.reject(
				domException('OperationError', 'Another presentation is already being started')
			)
		}
		const selected = this._selectUrl()
		if (!selected) {
			return Promise.reject(domException('NotFoundError', 'No available presentation display'))
		}
		// While presenting, Chrome shows the running presentation in its dialog, with a button to
		// stop it, instead of starting another one.
		const live = livePresentations()
		if (live.length > 0) return this._showDialog(live)
		// Open the window synchronously, so it still counts as part of the user gesture.
		const presentationId = createPresentationId(selected.url)
		const win = window.open(selected.pageUrl, WINDOW_NAME_PREFIX + presentationId, WINDOW_FEATURES)
		if (!win) {
			return Promise.reject(
				domException('NotAllowedError', 'Could not open the presentation window (pop-up blocked?)')
			)
		}
		const presentation = getOrCreatePresentation(presentationId, selected.url, win)
		presentation.started = true
		startInProgress = true
		return whenReceiverReady(presentation)
			.then(() => {
				const connection = connectToPresentation(presentation, selected.url, { reconnect: false })
				this._fireConnectionAvailable(connection)
				return connection
			})
			.finally(() => (startInProgress = false))
	}

	private _showDialog(live: ControlledPresentation[]): Promise<PresentationConnection> {
		startInProgress = true
		const items = live.map(({ id, url }) => ({ id, description: url?.split('?')[0] || '' }))
		return showPresentationDialog(items)
			.then((stopId) => {
				const presentation = stopId && presentations.get(stopId)
				if (presentation) stopPresentation(presentation)
				// Like closing the browser's dialog, this does not start a presentation.
				throw domException('AbortError', 'The presentation dialog was closed')
			})
			.finally(() => (startInProgress = false))
	}

	reconnect(requestedId: string): Promise<PresentationConnection> {
		// Presentations that this page starts from now on are not candidates: reconnect() is about
		// presentations that already exist. Otherwise the poll below would grab a presentation that
		// start() opens while we're still waiting (e.g. the Cast SDK's "auto-join" on page load).
		const candidates = new Set(presentations.keys())
		const isCandidate = (p: ControlledPresentation) => !p.started || candidates.has(p.id)
		// Map special presentation IDs (like the Cast SDK's "auto-join") to a known presentation.
		const resolveId = () => {
			const requested = presentations.get(requestedId)
			if (requested && isCandidate(requested)) return requestedId
			const known: KnownPresentation[] = [...presentations.values()]
				.filter((p) => isCandidate(p) && !p.window.closed)
				.map(({ id, url }) => ({ id, url }))
			for (const resolver of reconnectResolvers) {
				const id = resolver(requestedId, this.urls, known)
				if (id && known.some((p) => p.id === id)) return id
			}
			return requestedId
		}
		let presentationId = resolveId()
		const live = () => {
			const presentation = presentations.get(presentationId)
			if (!presentation || presentation.window.closed) return null
			// Reuse an existing connection to this presentation, as the spec says.
			for (const connection of presentation.connections.values()) {
				if (connection.state === 'connecting' || connection.state === 'connected') return connection
			}
			return presentation
		}
		const found = live()
		if (found instanceof PresentationConnection) return Promise.resolve(found)

		const wait = found
			? whenReceiverReady(found, RECEIVER_DISCOVERY_TIMEOUT_MS)
			: new Promise<void>((resolve, reject) => {
					// After a reload, we only learn about the receiver from its next heartbeat.
					const started = Date.now()
					const poll = setInterval(() => {
						presentationId = resolveId()
						const presentation = presentations.get(presentationId)
						if (presentation && isCandidate(presentation)) {
							clearInterval(poll)
							resolve()
						} else if (Date.now() - started > RECEIVER_DISCOVERY_TIMEOUT_MS) {
							clearInterval(poll)
							reject(domException('NotFoundError', `No presentation with ID ${presentationId}`))
						}
					}, 100)
				})

		return wait.then(() => {
			const presentation = presentations.get(presentationId)
			if (!presentation || presentation.window.closed) {
				throw domException('NotFoundError', `No presentation with ID ${presentationId}`)
			}
			const url = this._selectUrl()?.url || presentation.url || this.urls[0]
			const connection = connectToPresentation(presentation, url, { reconnect: true })
			this._fireConnectionAvailable(connection)
			return connection
		})
	}

	getAvailability(): Promise<PresentationAvailability> {
		if (!this.availability) {
			this.availability = Promise.resolve(new PresentationAvailability(!!this._selectUrl()))
		}
		return this.availability
	}

	private _fireConnectionAvailable(connection: PresentationConnection) {
		setTimeout(() =>
			this.dispatchEvent(
				new PresentationConnectionAvailableEvent('connectionavailable', { connection })
			)
		)
	}
}
defineEventHandlers(PresentationRequest.prototype, ['connectionavailable'])

// ----------- Receiving side

class PresentationConnectionList
	extends EventTarget
	implements globalThis.PresentationConnectionList
{
	/** @internal Every connection this receiver accepted, including closed ones. */
	readonly _connections: PresentationConnection[] = []
	declare onconnectionavailable: globalThis.PresentationConnectionList['onconnectionavailable']

	get connections() {
		return this._connections.filter((c) => c.state === 'connected' || c.state === 'connecting')
	}
}
defineEventHandlers(PresentationConnectionList.prototype, ['connectionavailable'])

class PresentationReceiver implements globalThis.PresentationReceiver {
	/** @internal Resolves `connectionList`, once the first connection comes in. */
	_resolveList!: (list: PresentationConnectionList) => void
	private readonly listReady = new Promise<PresentationConnectionList>(
		(resolve) => (this._resolveList = resolve)
	)

	get connectionList() {
		return this.listReady
	}
}

const createReceiver = () => {
	const presentationId = window.name.slice(WINDOW_NAME_PREFIX.length)
	const controller: Window = window.opener
	const list = new PresentationConnectionList()
	const receiver = new PresentationReceiver()
	const connections = new Map<string, PresentationConnection>()
	let presentationUrl: string | null = null

	const sendTerminated = () => post(controller, 'terminated', {})

	window.addEventListener('message', (event) => {
		if (event.source !== controller) return
		const message = readMessage(event.data)
		if (!message) return

		switch (message.type) {
			case 'connect': {
				const { connectionId } = message
				if (connections.has(connectionId)) return
				presentationUrl = presentationUrl || message.url
				const connection = new PresentationConnection(presentationId, message.url, {
					send(data) {
						post(controller, 'message', { connectionId, data })
					},
					close(reason, message) {
						post(controller, 'close', { connectionId, reason, message })
					},
					terminate() {
						for (const c of connections.values()) _terminated(c)
						sendTerminated()
						window.close()
					}
				})
				Object.defineProperty(connection, 'polyfillInfo', {
					value: Object.freeze({
						reconnect: !!message.reconnect,
						userAgent: message.userAgent || ''
					})
				})
				connections.set(connectionId, connection)
				list._connections.push(connection)
				_connected(connection)
				post(controller, 'connected', { connectionId })
				receiver._resolveList(list)
				list.dispatchEvent(
					new PresentationConnectionAvailableEvent('connectionavailable', { connection })
				)
				break
			}
			case 'message': {
				const connection = connections.get(message.connectionId)
				if (connection) _received(connection, message.data)
				break
			}
			case 'close': {
				const connection = connections.get(message.connectionId)
				if (connection) {
					connections.delete(message.connectionId)
					_closed(connection, message.reason || 'closed', message.message)
				}
				break
			}
			case 'terminate':
				for (const c of connections.values()) _terminated(c)
				connections.clear()
				window.close()
				break
		}
	})

	const hello = (type: 'receiver-hello' | 'receiver-alive') =>
		post(controller, type, { presentationId, url: presentationUrl })
	hello('receiver-hello')
	setInterval(() => {
		if (!controller.closed) hello('receiver-alive')
	}, RECEIVER_HEARTBEAT_MS)
	window.addEventListener('pagehide', sendTerminated)

	return receiver
}

// ----------- Install

const install = () => {
	listenToReceivers()

	const isReceivingWindow = window.name.startsWith(WINDOW_NAME_PREFIX) && !!window.opener

	let defaultRequest: PresentationRequest | null = null
	const presentation: Presentation = {
		get defaultRequest() {
			return defaultRequest
		},
		set defaultRequest(request) {
			defaultRequest = request instanceof PresentationRequest ? request : null
		},
		receiver: isReceivingWindow ? createReceiver() : null
	}

	Object.defineProperty(navigator, 'presentation', {
		configurable: true,
		enumerable: true,
		get: () => presentation
	})

	Object.assign(window, {
		PresentationRequest,
		PresentationAvailability,
		PresentationConnection,
		PresentationConnectionAvailableEvent,
		PresentationConnectionCloseEvent,
		PresentationReceiver,
		PresentationConnectionList
	})

	window.presentationPolyfill = {
		addUrlResolver(resolver) {
			urlResolvers.push(resolver)
		},
		addPresentationIdGenerator(generator) {
			idGenerators.push(generator)
		},
		addReconnectResolver(resolver) {
			reconnectResolvers.push(resolver)
		},
		isReceivingWindow,
		nativePresentation: NativePresentation
	}

	console.debug(LOG_PREFIX, isReceivingWindow ? 'installed (receiving window)' : 'installed')
}

// Don't install twice when the script is loaded more than once.
if (!window.presentationPolyfill) install()
