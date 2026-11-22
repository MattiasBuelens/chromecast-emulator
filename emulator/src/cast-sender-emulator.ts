/**
 * Cast sender emulator.
 *
 * Lets an unmodified Cast Web Sender SDK app cast to a local receiver page in a new window.
 *
 * In Chrome, the Cast Web Sender SDK talks to Cast devices through the Presentation API,
 * using `cast:<appId>?clientId=...` presentation URLs. Together with presentation-polyfill.js,
 * this script makes those requests open a receiver page in a popup window instead. That
 * receiver page must load presentation-polyfill.js and cast-receiver-emulator.js.
 *
 * Load order, before cast_sender.js:
 *
 *     <script src="/presentation-polyfill.js"></script>
 *     <script src="/cast-sender-emulator.js" data-receiver-url="/receiver"></script>
 *     <script src="https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1"></script>
 *
 * `data-receiver-url` is the receiver page for every app ID. To pick a page per app ID, set
 * `window.castEmulatorConfig = { receivers: { '<appId>': '<url>' }, receiverUrl: '<fallback>' }`
 * before loading this script.
 *
 * For debugging, `castSenderEmulator.trace` holds the most recent messages between the sender SDK
 * and the receiver, and `castSenderEmulator` fires a `message` event (a CustomEvent whose `detail`
 * is a {@link CastMessage}) for each one.
 */
import type { PresentationPolyfill } from './presentation-polyfill'
import { parseCastUrl, SESSION_ID_PREFIX } from './shared/cast-url'

export interface CastEmulatorConfig {
	/** The receiver page for app IDs that are not in `receivers`. */
	receiverUrl: string | null
	/** The receiver page for each app ID. */
	receivers: Record<string, string>
}

/** A message between the sender SDK and the receiver, in the format of Chrome's Media Router. */
export interface CastMessage {
	/** When the SDK sent or received the message, as from `Date.now()`. */
	time: number
	/** `send`: from the sender SDK to the receiver; `receive`: from the receiver to the SDK. */
	direction: 'send' | 'receive'
	/** The Cast session, which is also the presentation ID. */
	sessionId: string
	/** The Media Router message type, e.g. `v2_message`, `app_message` or `new_session`. */
	type: string | null
	/**
	 * For `v2_message` and `app_message`: the Cast namespace, e.g. `urn:x-cast:com.google.cast.media`.
	 */
	namespace: string | null
	/** The type of the Cast message inside, e.g. `LOAD` or `MEDIA_STATUS`, if it has one. */
	messageType: string | null
	/** The message, parsed as JSON, or as it was sent if it isn't JSON. */
	message: unknown
}

export interface CastSenderEmulator extends EventTarget {
	parseCastUrl: typeof parseCastUrl
	config: CastEmulatorConfig
	/** The most recent messages between the sender SDK and the receiver, oldest first. */
	trace: CastMessage[]
}

declare global {
	interface Window {
		castEmulatorConfig?: Partial<CastEmulatorConfig>
		castSenderEmulator?: CastSenderEmulator
		/** cast_sender.js only uses the Presentation API when it detects Chrome. */
		chrome?: object
	}
}

const LOG_PREFIX = '[cast-sender-emulator]'

// The Cast SDK calls PresentationRequest#reconnect() with this ID to join an existing session.
const AUTO_JOIN_ID = 'auto-join'

const TRACE_LIMIT = 500
const MEDIA_NAMESPACE = 'urn:x-cast:com.google.cast.media'
const RECEIVER_NAMESPACE = 'urn:x-cast:com.google.cast.receiver'
// v2_message carries media messages, plus a few receiver ones (sent by the SDK as v2 too).
const RECEIVER_MESSAGE_TYPES = new Set(['SET_VOLUME', 'STOP', 'RECEIVER_STATUS'])

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

const stringOrNull = (value: unknown) => (typeof value === 'string' ? value : null)

/** Describe a message between the sender SDK and the receiver. */
const describeMessage = (
	direction: CastMessage['direction'],
	sessionId: string,
	data: unknown
): CastMessage => {
	let message: unknown = data
	if (typeof data === 'string') {
		try {
			message = JSON.parse(data)
		} catch {}
	}
	const type = isObject(message) ? stringOrNull(message.type) : null
	const body = isObject(message) ? message.message : undefined
	let namespace: string | null = null
	let messageType: string | null = null
	if (type === 'v2_message' && isObject(body)) {
		messageType = stringOrNull(body.type)
		namespace =
			messageType && RECEIVER_MESSAGE_TYPES.has(messageType) ? RECEIVER_NAMESPACE : MEDIA_NAMESPACE
	} else if (type === 'app_message' && isObject(body)) {
		namespace = stringOrNull(body.namespaceName)
		const appMessage = isObject(body.message) ? body.message : null
		messageType = appMessage ? stringOrNull(appMessage.type) : null
	}
	return { time: Date.now(), direction, sessionId, type, namespace, messageType, message }
}

const install = (presentationPolyfill: PresentationPolyfill) => {
	// document.currentScript is only set while this script runs, so read it right away.
	const script = document.currentScript as HTMLScriptElement | null
	const config: CastEmulatorConfig = {
		receiverUrl: script?.dataset.receiverUrl || null,
		receivers: {},
		...window.castEmulatorConfig
	}

	presentationPolyfill.addUrlResolver((presentationUrl) => {
		const cast = parseCastUrl(presentationUrl)
		if (!cast) return null
		for (const appId of cast.appIds) {
			const receiverUrl = config.receivers[appId] || config.receiverUrl
			if (receiverUrl) return new URL(receiverUrl, document.baseURI).href
		}
		console.warn(LOG_PREFIX, 'no receiver page configured for app IDs', cast.appIds)
		return null
	})

	presentationPolyfill.addPresentationIdGenerator((presentationUrl) =>
		parseCastUrl(presentationUrl) ? SESSION_ID_PREFIX + crypto.randomUUID() : null
	)

	presentationPolyfill.addReconnectResolver((requestedId, requestUrls, known) => {
		if (requestedId !== AUTO_JOIN_ID) return null
		// Join the most recent session of an app this sender asks for. We only know about receiver
		// windows opened from this origin, so this works like the "origin_scoped" auto join policy.
		const appIds = new Set(requestUrls.flatMap((url) => parseCastUrl(url)?.appIds || []))
		const session = known
			.filter(({ id, url }) => id.startsWith(SESSION_ID_PREFIX) && url)
			.reverse()
			.find(({ url }) => parseCastUrl(url!)?.appIds.some((appId) => appIds.has(appId)))
		return session?.id || null
	})

	const emulator = Object.assign(new EventTarget(), {
		parseCastUrl,
		config,
		trace: [] as CastMessage[]
	})

	presentationPolyfill.addMessageObserver(({ direction, connection, data }) => {
		if (!connection.id.startsWith(SESSION_ID_PREFIX)) return
		const message = describeMessage(direction, connection.id, data)
		emulator.trace.push(message)
		if (emulator.trace.length > TRACE_LIMIT) emulator.trace.shift()
		emulator.dispatchEvent(new CustomEvent('message', { detail: message }))
	})

	// cast_sender.js only uses the Presentation API when it detects Chrome.
	window.chrome = window.chrome || {}

	window.castSenderEmulator = emulator
}

if (window.presentationPolyfill) {
	install(window.presentationPolyfill)
} else {
	console.error(LOG_PREFIX, 'presentation-polyfill.js must be loaded first')
}
