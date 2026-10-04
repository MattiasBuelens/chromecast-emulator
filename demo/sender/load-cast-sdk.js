// Not part of CastVideos-chrome: loads the Chromecast emulator before the Cast sender SDK.
import { loadScripts } from '../src/load-scripts.js'
import presentationPolyfillUrl from '@mattiasbuelens/chromecast-emulator/presentation-polyfill?url'
import castSenderEmulatorUrl from '@mattiasbuelens/chromecast-emulator/cast-sender-emulator?url'

// The receiver page that the emulator opens, for every receiver application ID.
const RECEIVER_URL = '../receiver/'
const CAST_SENDER_SDK_URL =
	'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'

// The emulator scripts must run before the Cast SDK, so it picks up the Presentation API polyfill.
await loadScripts([
	presentationPolyfillUrl,
	[castSenderEmulatorUrl, { receiverUrl: RECEIVER_URL }],
	CAST_SENDER_SDK_URL
])
