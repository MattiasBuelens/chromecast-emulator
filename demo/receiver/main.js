import { loadScripts } from '../src/load-scripts.js'
import presentationPolyfillUrl from '@mattiasbuelens/chromecast-emulator/presentation-polyfill?url'
import castReceiverEmulatorUrl from '@mattiasbuelens/chromecast-emulator/cast-receiver-emulator?url'

const CAST_RECEIVER_SDK_URL =
	'https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js'

// The emulator scripts must run before the receiver SDK, so it connects to the emulated platform.
await loadScripts([presentationPolyfillUrl, castReceiverEmulatorUrl, CAST_RECEIVER_SDK_URL])

const context = cast.framework.CastReceiverContext.getInstance()
context.start()
