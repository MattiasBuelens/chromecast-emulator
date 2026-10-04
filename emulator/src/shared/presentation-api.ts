// Types for the Presentation API (https://w3c.github.io/presentation-api/), which TypeScript's DOM
// library does not include. presentation-polyfill.ts implements them.

export type PresentationConnectionState = 'connecting' | 'connected' | 'closed' | 'terminated'
export type PresentationConnectionCloseReason = 'error' | 'closed' | 'wentaway'

export interface PresentationConnectionAvailableEvent extends Event {
	readonly connection: PresentationConnection
}

export interface PresentationConnectionCloseEvent extends Event {
	readonly reason: PresentationConnectionCloseReason
	readonly message: string
}

export interface PresentationConnectionEventMap {
	connect: Event
	close: PresentationConnectionCloseEvent
	terminate: Event
	message: MessageEvent
}

export interface PresentationConnection extends EventTarget {
	readonly id: string
	readonly url: string
	readonly state: PresentationConnectionState
	binaryType: BinaryType
	onconnect: ((this: PresentationConnection, event: Event) => unknown) | null
	onclose:
		((this: PresentationConnection, event: PresentationConnectionCloseEvent) => unknown) | null
	onterminate: ((this: PresentationConnection, event: Event) => unknown) | null
	onmessage: ((this: PresentationConnection, event: MessageEvent) => unknown) | null
	/**
	 * Not part of the spec: lets receiver-side code tell new sessions from reconnects.
	 * Only set on the receiving side.
	 */
	readonly polyfillInfo?: PresentationConnectionPolyfillInfo
	close(): void
	terminate(): void
	send(data: string | Blob | ArrayBuffer | ArrayBufferView): void
	addEventListener<K extends keyof PresentationConnectionEventMap>(
		type: K,
		listener: (this: PresentationConnection, event: PresentationConnectionEventMap[K]) => unknown,
		options?: boolean | AddEventListenerOptions
	): void
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions
	): void
}

export interface PresentationConnectionPolyfillInfo {
	/** Whether the controlling page reconnected to the presentation, rather than starting it. */
	readonly reconnect: boolean
	/** The user agent of the controlling page. */
	readonly userAgent: string
}

export interface PresentationAvailability extends EventTarget {
	readonly value: boolean
	onchange: ((this: PresentationAvailability, event: Event) => unknown) | null
}

export interface PresentationRequestEventMap {
	connectionavailable: PresentationConnectionAvailableEvent
}

export interface PresentationRequest extends EventTarget {
	start(): Promise<PresentationConnection>
	reconnect(presentationId: string): Promise<PresentationConnection>
	getAvailability(): Promise<PresentationAvailability>
	onconnectionavailable:
		((this: PresentationRequest, event: PresentationConnectionAvailableEvent) => unknown) | null
	addEventListener<K extends keyof PresentationRequestEventMap>(
		type: K,
		listener: (this: PresentationRequest, event: PresentationRequestEventMap[K]) => unknown,
		options?: boolean | AddEventListenerOptions
	): void
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions
	): void
}

export interface PresentationConnectionListEventMap {
	connectionavailable: PresentationConnectionAvailableEvent
}

export interface PresentationConnectionList extends EventTarget {
	readonly connections: readonly PresentationConnection[]
	onconnectionavailable:
		| ((this: PresentationConnectionList, event: PresentationConnectionAvailableEvent) => unknown)
		| null
	addEventListener<K extends keyof PresentationConnectionListEventMap>(
		type: K,
		listener: (
			this: PresentationConnectionList,
			event: PresentationConnectionListEventMap[K]
		) => unknown,
		options?: boolean | AddEventListenerOptions
	): void
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions
	): void
}

export interface PresentationReceiver {
	readonly connectionList: Promise<PresentationConnectionList>
}

export interface Presentation {
	defaultRequest: PresentationRequest | null
	readonly receiver: PresentationReceiver | null
}

declare global {
	interface Navigator {
		/** Only in browsers that support the Presentation API, or with presentation-polyfill.js. */
		readonly presentation?: Presentation
	}
}
