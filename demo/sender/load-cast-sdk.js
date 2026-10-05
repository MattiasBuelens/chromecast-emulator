// Not part of CastVideos-chrome: loads the Chromecast emulator before the Cast sender SDK.
import { loadScripts } from '../src/load-scripts.js'
import presentationPolyfillUrl from '@mattiasbuelens/chromecast-emulator/presentation-polyfill?url'
import castSenderEmulatorUrl from '@mattiasbuelens/chromecast-emulator/cast-sender-emulator?url'

// The receiver page that the emulator opens, for every receiver application ID.
const RECEIVER_URL = '../receiver/'
const CAST_SENDER_SDK_URL =
	'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'

// Where the emulator opens the receiver: "popup" or "pip" (Picture-in-Picture). The ?mode= query
// parameter wins over the last choice in the picker.
const MODE_STORAGE_KEY = 'chromecast-emulator-demo:mode'
const readStoredMode = () => {
	try {
		return localStorage.getItem(MODE_STORAGE_KEY)
	} catch {
		return null
	}
}
const requestedMode = new URLSearchParams(location.search).get('mode') || readStoredMode()
const mode = requestedMode === 'pip' ? 'pip' : 'popup'

// The emulator scripts must run before the Cast SDK, so it picks up the Presentation API polyfill.
await loadScripts([
	[presentationPolyfillUrl, { mode }],
	[castSenderEmulatorUrl, { receiverUrl: RECEIVER_URL }],
	CAST_SENDER_SDK_URL
])

const picker = /** @type {HTMLSelectElement} */ (document.querySelector('#receiver_mode select'))
picker.value = mode
if (!presentationPolyfill.pipSupported) {
	const pipOption = /** @type {HTMLOptionElement} */ (picker.querySelector('option[value="pip"]'))
	pipOption.disabled = true
	pipOption.textContent += ' (not supported)'
}
// The next cast uses the new mode, without reloading the page.
picker.addEventListener('change', () => {
	presentationPolyfill.mode = /** @type {'popup' | 'pip'} */ (picker.value)
	try {
		localStorage.setItem(MODE_STORAGE_KEY, picker.value)
	} catch {}
})
