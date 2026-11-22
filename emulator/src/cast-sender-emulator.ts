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

// The Cast extension IDs that cast_sender.js tries, in this order, when it doesn't recognize the
// browser as a recent Chrome, e.g. in Firefox or Safari.
const CAST_EXTENSION_IDS = ['pkedcjkdefgpdelpbcmbmeomcjbeemfm', 'enhhojjnijigcajfphajepfemndkmdlo']
// The Chrome version whose Cast API we load in other browsers. In Chrome, cast_sender.js loads the
// Cast API for its own version from www.gstatic.com/eureka/clank/<version>/cast_sender.js. (The
// unversioned www.gstatic.com/eureka/clank/cast_sender.js is an old version that doesn't notice when
// a session ends.)
const CAST_API_CHROME_VERSION = 156
const castApiUrl = (chromeVersion: number) =>
	`https://www.gstatic.com/eureka/clank/${chromeVersion}/cast_sender.js`

/**
 * Let cast_sender.js load the Cast API in browsers other than Chrome.
 *
 * cast_sender.js is only a loader. In a recent Chrome (going by the user agent), it loads the actual
 * Cast API for that Chrome version from www.gstatic.com, and falls back to the previous version. In
 * other browsers, it tries the Cast extension's scripts from chrome-extension: URLs instead, which
 * fail, so `chrome.cast` stays undefined. We point those at the Cast API of a recent Chrome version
 * and the one before it, which work with the polyfilled Presentation API.
 */
const loadCastApiInAnyBrowser = () => {
	const srcProperty = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src')
	if (!srcProperty?.set) return
	const replacements = new Map(
		CAST_EXTENSION_IDS.map((id, index) => [
			`chrome-extension://${id}/cast_sender.js`,
			castApiUrl(CAST_API_CHROME_VERSION - index)
		])
	)
	Object.defineProperty(HTMLScriptElement.prototype, 'src', {
		...srcProperty,
		set(value: unknown) {
			srcProperty.set!.call(this, replacements.get(String(value)) ?? value)
		}
	})
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

	// cast_sender.js only uses the Presentation API when it detects Chrome.
	window.chrome = window.chrome || {}

	loadCastApiInAnyBrowser()

	window.castSenderEmulator = { parseCastUrl, config }
}

if (window.presentationPolyfill) {
	install(window.presentationPolyfill)
} else {
	console.error(LOG_PREFIX, 'presentation-polyfill.js must be loaded first')
}
