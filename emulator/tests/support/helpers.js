// Helpers for the tests, loaded in every test page after presentation-polyfill.js.
// Like the EventWatcher and assert_throws_* helpers of web-platform-tests' testharness.js,
// but returning plain values that the tests compare in Node.

/** Resolve with the next event of the given type at the target. */
window.nextEvent = (target, type) =>
	new Promise((resolve) => target.addEventListener(type, resolve, { once: true }))

/** Resolve with whether an event of the given type fires at the target within `ms`. */
window.firesWithin = (target, type, ms = 500) =>
	new Promise((resolve) => {
		const listener = () => resolve(true)
		target.addEventListener(type, listener, { once: true })
		setTimeout(() => {
			target.removeEventListener(type, listener)
			resolve(false)
		}, ms)
	})

/** The name of the exception that a function throws, or null if it doesn't throw. */
window.errorName = (fn) => {
	try {
		fn()
		return null
	} catch (error) {
		return error.name
	}
}

/** The name of the exception that a promise rejects with, or null if it resolves. */
window.rejectionName = (promise) =>
	promise.then(
		() => null,
		(error) => error.name
	)

/** Describe an event, along with the state of the connection it fired at. */
window.describeEvent = (event) => ({
	type: event.type,
	bubbles: event.bubbles,
	cancelable: event.cancelable,
	...('state' in event.target && { state: event.target.state }),
	...('reason' in event && { reason: event.reason, message: event.message })
})

/** Collect a connection's messages as `{ type, data }`, with binary data decoded as text. */
window.collectMessages = (connection) => {
	const messages = []
	let queue = Promise.resolve()
	connection.addEventListener('message', (event) => {
		const { data } = event
		queue = queue.then(async () => {
			if (!(event instanceof MessageEvent) || event.bubbles || event.cancelable) {
				messages.push({ type: 'unexpected event' })
			} else if (typeof data === 'string') {
				messages.push({ type: 'text', data })
			} else if (data instanceof Blob) {
				messages.push({ type: 'blob', data: await data.text() })
			} else if (data instanceof ArrayBuffer) {
				messages.push({ type: 'arraybuffer', data: new TextDecoder().decode(data) })
			} else {
				messages.push({ type: 'unexpected data' })
			}
		})
	})
	return messages
}

/** The messages that the WPT send/onmessage tests exchange: two strings, then binary data. */
window.sendTestMessages = (connection) => {
	const encode = (text) => new TextEncoder().encode(text)
	connection.send('1st')
	connection.send('2nd')
	connection.send(new Blob([encode('3rd')]))
	connection.send(encode('4th').buffer)
	connection.send(encode('last'))
}
