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
 */
import type { PresentationPolyfill } from './presentation-polyfill'
import { parseCastUrl, SESSION_ID_PREFIX } from './shared/cast-url'

export interface CastEmulatorConfig {
	/** The receiver page for app IDs that are not in `receivers`. */
	receiverUrl: string | null
	/** The receiver page for each app ID. */
	receivers: Record<string, string>
}

declare global {
	interface Window {
		castEmulatorConfig?: Partial<CastEmulatorConfig>
		castSenderEmulator?: { parseCastUrl: typeof parseCastUrl; config: CastEmulatorConfig }
		/** cast_sender.js only uses the Presentation API when it detects Chrome. */
		chrome?: object
	}
}

const LOG_PREFIX = '[cast-sender-emulator]'

// The Cast SDK calls PresentationRequest#reconnect() with this ID to join an existing session.
const AUTO_JOIN_ID = 'auto-join'

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

	// cast_sender.js only uses the Presentation API when it detects Chrome.
	window.chrome = window.chrome || {}

	window.castSenderEmulator = { parseCastUrl, config }
}

if (window.presentationPolyfill) {
	install(window.presentationPolyfill)
} else {
	console.error(LOG_PREFIX, 'presentation-polyfill.js must be loaded first')
}
