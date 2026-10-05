/**
 * Tests for presentation-polyfill.js.
 *
 * Adapted from the Presentation API tests in web-platform-tests
 * (https://github.com/web-platform-tests/wpt/tree/master/presentation-api), each test names the WPT
 * file it is based on. Copyright web-platform-tests contributors, licensed under the 3-Clause BSD
 * License (https://github.com/web-platform-tests/wpt/blob/master/LICENSE.md).
 *
 * Many WPT tests are "manual": a person clicks a button and picks a display. Here, the receiving
 * page opens in a popup, so Playwright clicks for us and drives both pages. Instead of WPT's stash
 * server, the tests talk to the receiving page through Playwright directly.
 *
 * Not adapted:
 * - Sandboxing tests: the polyfill cannot tell whether a sandboxed iframe allows presentations.
 * - isTrusted checks: script-created events are never trusted.
 * - startMultiplePresentations: like Chrome, start() shows a dialog to stop the running
 *   presentation instead of starting a second one.
 * - PresentationReceiver_create: the receiving page shares storage and history with the
 *   controlling page, since it's just a popup in the same browser.
 */
import { expect, test as base, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

declare global {
	interface Window {
		request: PresentationRequest
		connection: PresentationConnection
		list: PresentationConnectionList
		messages: Array<{ type: string; data?: string }>
		result: Promise<unknown>
		nextEvent(target: EventTarget, type: string): Promise<Event>
		firesWithin(target: EventTarget, type: string, ms?: number): Promise<boolean>
		errorName(fn: () => unknown): string | null
		rejectionName(promise: Promise<unknown>): Promise<string | null>
		describeEvent(event: Event): Record<string, unknown>
		collectMessages(connection: PresentationConnection): Array<{ type: string; data?: string }>
		sendTestMessages(connection: PresentationConnection): void
	}
}

// A made-up secure origin, served by the tests themselves.
const ORIGIN = 'https://presentation.test'
const RECEIVER_URL = `${ORIGIN}/receiver.html`

const html = (body: string) =>
	`<!doctype html><meta charset="utf-8">` +
	`<script src="/presentation-polyfill.js"></script><script src="/helpers.js"></script>${body}`

const FILES: Record<string, { body: string | Promise<Buffer>; contentType: string }> = {
	'/presentation-polyfill.js': {
		body: readFile(new URL('../dist/presentation-polyfill.js', import.meta.url)),
		contentType: 'text/javascript'
	},
	'/helpers.js': {
		body: readFile(new URL('./support/helpers.js', import.meta.url)),
		contentType: 'text/javascript'
	},
	'/controller.html': { body: html('<title>Controller</title>'), contentType: 'text/html' },
	'/receiver.html': { body: html('<title>Receiver</title>'), contentType: 'text/html' },
	'/other-receiver.html': { body: html('<title>Other receiver</title>'), contentType: 'text/html' },
	// A page that never accepts the presentation, because it doesn't load the polyfill.
	'/blank.html': { body: '<!doctype html><title>Blank</title>', contentType: 'text/html' },
	// Calls start() without a user gesture.
	'/start-on-load.html': {
		body: html(
			`<script>window.result = rejectionName(new PresentationRequest('/receiver.html').start())</script>`
		),
		contentType: 'text/html'
	}
}

const test = base.extend<{ controller: Page }>({
	controller: async ({ context, page }, use) => {
		// context.route() also covers the receiving popups.
		await context.route(`${ORIGIN}/**`, async (route) => {
			const file = FILES[new URL(route.request().url()).pathname]
			if (!file) return route.fulfill({ status: 404 })
			await route.fulfill({ body: await file.body, contentType: file.contentType })
		})
		await page.goto(`${ORIGIN}/controller.html`)
		await use(page)
	}
})

/**
 * Start a presentation from the controlling page, as `window.request` and `window.connection`, and
 * wait for it to connect. Playwright's evaluate() counts as a user gesture.
 */
const startPresentation = async (controller: Page, url = RECEIVER_URL) => {
	const [receiver] = await Promise.all([
		controller.waitForEvent('popup'),
		controller.evaluate(async (url) => {
			window.request = new PresentationRequest(url)
			window.connection = await window.request.start()
			if (window.connection.state === 'connecting') {
				await window.nextEvent(window.connection, 'connect')
			}
		}, url)
	])
	return receiver
}

/** Get the receiving page's first connection, as `window.list` and `window.connection`. */
const getReceiverConnection = (receiver: Page) =>
	receiver.evaluate(async () => {
		window.list = await navigator.presentation.receiver!.connectionList
		window.connection = window.list.connections[0]
		return { count: window.list.connections.length, state: window.connection.state }
	})

test.describe('PresentationRequest constructor', () => {
	// PresentationRequest_success.https.html
	test('accepts relative, absolute and multiple URLs, ignoring unsupported ones', async ({
		controller
	}) => {
		const urls = await controller.evaluate(() => [
			new PresentationRequest('presentation.html').urls,
			new PresentationRequest('https://example.org/').urls,
			new PresentationRequest(['presentation.html', 'https://example.org/presentation/']).urls,
			new PresentationRequest([
				'unsupported://example.com',
				'presentation.html',
				'https://example.org/presentation/'
			]).urls
		])
		expect(urls).toEqual([
			[`${ORIGIN}/presentation.html`],
			['https://example.org/'],
			[`${ORIGIN}/presentation.html`, 'https://example.org/presentation/'],
			[`${ORIGIN}/presentation.html`, 'https://example.org/presentation/']
		])
	})

	// PresentationRequest_error.https.html
	test('throws for missing, invalid or unsupported URLs', async ({ controller }) => {
		const errors = await controller.evaluate(() =>
			[
				// @ts-expect-error: no URL
				() => new PresentationRequest(),
				() => new PresentationRequest([]),
				() => new PresentationRequest('https://@'),
				() => new PresentationRequest('unsupported://example.com'),
				() => new PresentationRequest(['presentation.html', 'https://@']),
				() => new PresentationRequest(['unsupported://example.com', 'invalid://example.com'])
			].map(window.errorName)
		)
		expect(errors).toEqual([
			'TypeError',
			'NotSupportedError',
			'SyntaxError',
			'NotSupportedError',
			'SyntaxError',
			'NotSupportedError'
		])
	})

	// PresentationRequest_mixedcontent.https.html
	test('throws a SecurityError for http: URLs in a secure context', async ({ controller }) => {
		const errors = await controller.evaluate(() =>
			[
				() => new PresentationRequest('http://example.org/presentation.html'),
				() => new PresentationRequest(['https://example.org/', 'http://example.org/']),
				// localhost is potentially trustworthy.
				() => new PresentationRequest('http://localhost:8080/presentation.html')
			].map(window.errorName)
		)
		expect(errors).toEqual(['SecurityError', 'SecurityError', null])
	})
})

// defaultRequest.https.html
test('navigator.presentation.defaultRequest', async ({ controller }) => {
	const result = await controller.evaluate(() => {
		const initial = navigator.presentation.defaultRequest
		const request = new PresentationRequest('https://example.org/')
		navigator.presentation.defaultRequest = request
		const set = navigator.presentation.defaultRequest === request
		// @ts-expect-error: not a PresentationRequest
		const error = window.errorName(() => (navigator.presentation.defaultRequest = {}))
		navigator.presentation.defaultRequest = null
		return { initial, set, error, reset: navigator.presentation.defaultRequest }
	})
	expect(result).toEqual({ initial: null, set: true, error: 'TypeError', reset: null })
})

// PresentationConnectionCloseEvent.https.html
test('PresentationConnectionCloseEvent constructor', async ({ controller }) => {
	const events = await controller.evaluate(() =>
		(['error', 'closed', 'wentaway'] as const)
			.flatMap((reason) => [
				new PresentationConnectionCloseEvent('close', { reason, message: 'A message' }),
				new PresentationConnectionCloseEvent('close', { reason })
			])
			.map(({ type, reason, message }) => ({ type, reason, message }))
	)
	expect(events).toEqual(
		['error', 'closed', 'wentaway'].flatMap((reason) => [
			{ type: 'close', reason, message: 'A message' },
			{ type: 'close', reason, message: '' }
		])
	)
})

// getAvailability.https.html
test('getAvailability() returns a new promise for the same availability', async ({
	controller
}) => {
	const result = await controller.evaluate(async () => {
		const request = new PresentationRequest(['receiver.html', 'cast:915D2A2C'])
		const promise1 = request.getAvailability()
		const promise2 = request.getAvailability()
		const availability = await promise1
		const other = await new PresentationRequest('https://example.com').getAvailability()
		return {
			isPromise: promise1 instanceof Promise,
			newPromise: promise1 !== promise2,
			isAvailability: availability instanceof PresentationAvailability,
			value: availability.value,
			sameAvailability: availability === (await promise2),
			otherRequestHasOtherAvailability: availability !== other
		}
	})
	expect(result).toEqual({
		isPromise: true,
		newPromise: true,
		isAvailability: true,
		value: true,
		sameAvailability: true,
		otherRequestHasOtherAvailability: true
	})
})

test.describe('start()', () => {
	// startNewPresentation_error.https.html
	test('rejects with an InvalidAccessError without a user gesture', async ({ controller }) => {
		await controller.goto(`${ORIGIN}/start-on-load.html`)
		expect(await controller.evaluate(() => window.result)).toBe('InvalidAccessError')
	})

	// startNewPresentation_success-manual.https.html,
	// PresentationRequest_onconnectionavailable-manual.https.html
	test('resolves with a connecting connection, then fires connectionavailable and connect', async ({
		controller
	}) => {
		const [receiver, result] = await Promise.all([
			controller.waitForEvent('popup'),
			controller.evaluate(async () => {
				const order: string[] = []
				const request = new PresentationRequest('receiver.html')
				const connectionAvailable = window.nextEvent(request, 'connectionavailable')
				const handlerEvent = new Promise<Event>(
					(resolve) => (request.onconnectionavailable = resolve)
				)
				const connection = await request.start()
				order.push(`resolved (${connection.state})`)
				connectionAvailable.then(() => order.push(`connectionavailable (${connection.state})`))
				await window.nextEvent(connection, 'connect')
				order.push(`connect (${connection.state})`)
				const event = (await connectionAvailable) as PresentationConnectionAvailableEvent
				connection.terminate()
				return {
					order,
					id: typeof connection.id === 'string' && connection.id.length > 0,
					url: connection.url,
					isConnection: connection instanceof PresentationConnection,
					isEvent: event instanceof PresentationConnectionAvailableEvent,
					event: window.describeEvent(event),
					sameEventForHandler: event === (await handlerEvent),
					eventTarget: event.target === request,
					eventConnection: event.connection === connection
				}
			})
		])
		expect(result).toEqual({
			order: ['resolved (connecting)', 'connectionavailable (connecting)', 'connect (connected)'],
			id: true,
			url: RECEIVER_URL,
			isConnection: true,
			isEvent: true,
			event: { type: 'connectionavailable', bubbles: false, cancelable: false },
			sameEventForHandler: true,
			eventTarget: true,
			eventConnection: true
		})
		await expect.poll(() => receiver.isClosed()).toBe(true)
	})

	// startNewPresentation_unsettledpromise-manual.https.html
	test('rejects with an OperationError while another start() is pending', async ({
		controller
	}) => {
		const [, error] = await Promise.all([
			controller.waitForEvent('popup'),
			controller.evaluate(async () => {
				const request1 = new PresentationRequest('receiver.html')
				const request2 = new PresentationRequest('receiver.html')
				const start1 = request1.start()
				const error = await window.rejectionName(request2.start())
				;(await start1).terminate()
				return error
			})
		])
		expect(error).toBe('OperationError')
	})

	// startNewPresentation_displaynotallowed-manual.https.html
	test('rejects with a NotAllowedError when the presentation window is closed', async ({
		controller
	}) => {
		const [receiver] = await Promise.all([
			controller.waitForEvent('popup'),
			controller.evaluate(() => {
				window.result = window.rejectionName(new PresentationRequest('blank.html').start())
			})
		])
		await receiver.close()
		expect(await controller.evaluate(() => window.result)).toBe('NotAllowedError')
	})
})

test.describe('PresentationConnection', () => {
	// PresentationConnection_send-manual.https.html, PresentationConnection_onmessage_receiving-ua.html
	test('sends text and binary messages to the receiver', async ({ controller }) => {
		const receiver = await startPresentation(controller)
		await getReceiverConnection(receiver)
		await receiver.evaluate(() => (window.messages = window.collectMessages(window.connection)))
		await controller.evaluate(() => window.sendTestMessages(window.connection))
		await expect
			.poll(() => receiver.evaluate(() => window.messages))
			.toEqual([
				{ type: 'text', data: '1st' },
				{ type: 'text', data: '2nd' },
				// Binary messages arrive as an ArrayBuffer, whatever the sender sent.
				{ type: 'arraybuffer', data: '3rd' },
				{ type: 'arraybuffer', data: '4th' },
				{ type: 'arraybuffer', data: 'last' }
			])
	})

	// PresentationConnection_onmessage-manual.https.html, PresentationConnection_send_receiving-ua.html
	test('receives text and binary messages from the receiver', async ({ controller }) => {
		const receiver = await startPresentation(controller)
		await getReceiverConnection(receiver)
		expect(await controller.evaluate(() => window.connection.binaryType)).toBe('arraybuffer')
		await controller.evaluate(() => (window.messages = window.collectMessages(window.connection)))
		await receiver.evaluate(() => window.sendTestMessages(window.connection))
		await expect
			.poll(() => controller.evaluate(() => window.messages))
			.toEqual([
				{ type: 'text', data: '1st' },
				{ type: 'text', data: '2nd' },
				{ type: 'arraybuffer', data: '3rd' },
				{ type: 'arraybuffer', data: '4th' },
				{ type: 'arraybuffer', data: 'last' }
			])

		// With binaryType "blob", binary messages arrive as a Blob.
		await controller.evaluate(() => {
			window.connection.binaryType = 'blob'
			window.messages.length = 0
		})
		await receiver.evaluate(() => window.sendTestMessages(window.connection))
		await expect
			.poll(() => controller.evaluate(() => window.messages))
			.toEqual([
				{ type: 'text', data: '1st' },
				{ type: 'text', data: '2nd' },
				{ type: 'blob', data: '3rd' },
				{ type: 'blob', data: '4th' },
				{ type: 'blob', data: 'last' }
			])
	})

	// PresentationConnection_send-manual.https.html
	test('send() throws an InvalidStateError unless connected', async ({ controller }) => {
		const [, errors] = await Promise.all([
			controller.waitForEvent('popup'),
			controller.evaluate(async () => {
				const request = new PresentationRequest('receiver.html')
				const connection = await request.start()
				const connecting = window.errorName(() => connection.send(''))
				await window.nextEvent(connection, 'connect')
				const connected = window.errorName(() => connection.send(''))
				connection.close()
				const closed = window.errorName(() => connection.send(''))
				await request.reconnect(connection.id)
				await window.nextEvent(connection, 'connect')
				connection.terminate()
				await window.nextEvent(connection, 'terminate')
				const terminated = window.errorName(() => connection.send(''))
				return { connecting, connected, closed, terminated }
			})
		])
		expect(errors).toEqual({
			connecting: 'InvalidStateError',
			connected: null,
			closed: 'InvalidStateError',
			terminated: 'InvalidStateError'
		})
	})
})

test.describe('close()', () => {
	// PresentationConnection_onclose-manual.https.html
	test('closes a connecting connection, and does nothing once closed', async ({ controller }) => {
		const [receiver, result] = await Promise.all([
			controller.waitForEvent('popup'),
			controller.evaluate(async () => {
				const request = new PresentationRequest('receiver.html')
				const connection = await request.start()
				connection.close()
				// The close event fires asynchronously, so we can still listen for it.
				const handlerEvent = new Promise<Event>((resolve) => (connection.onclose = resolve))
				const event = (await window.nextEvent(
					connection,
					'close'
				)) as PresentationConnectionCloseEvent
				connection.close()
				return {
					isCloseEvent: event instanceof PresentationConnectionCloseEvent,
					event: window.describeEvent(event),
					sameEventForHandler: event === (await handlerEvent),
					eventTarget: event.target === connection,
					closesAgain: await window.firesWithin(connection, 'close')
				}
			})
		])
		expect(result).toEqual({
			isCloseEvent: true,
			event: {
				type: 'close',
				bubbles: false,
				cancelable: false,
				state: 'closed',
				reason: 'closed',
				message: ''
			},
			sameEventForHandler: true,
			eventTarget: true,
			closesAgain: false
		})
		// The presentation keeps running.
		expect(receiver.isClosed()).toBe(false)
	})

	// PresentationConnection_onclose-manual.https.html,
	// PresentationConnectionList_onconnectionavailable_receiving-ua.html
	test('closes the receiving connection, and removes it from the connection list', async ({
		controller
	}) => {
		const receiver = await startPresentation(controller)
		expect(await getReceiverConnection(receiver)).toEqual({ count: 1, state: 'connected' })
		await receiver.evaluate(() => {
			window.result = window.nextEvent(window.connection, 'close').then(window.describeEvent)
		})
		await controller.evaluate(() => window.connection.close())
		expect(await receiver.evaluate(() => window.result)).toMatchObject({
			type: 'close',
			state: 'closed',
			reason: 'closed'
		})
		expect(await receiver.evaluate(() => window.list.connections.length)).toBe(0)
	})

	// PresentationConnection_onclose_receiving-ua.html
	test('closes the controlling connection when the receiver closes it', async ({ controller }) => {
		const receiver = await startPresentation(controller)
		await getReceiverConnection(receiver)
		await controller.evaluate(() => {
			window.result = window.nextEvent(window.connection, 'close').then(window.describeEvent)
		})
		const receiverEvent = await receiver.evaluate(async () => {
			window.connection.close()
			return window.describeEvent(await window.nextEvent(window.connection, 'close'))
		})
		expect(receiverEvent).toMatchObject({ state: 'closed', reason: 'closed' })
		expect(await controller.evaluate(() => window.result)).toMatchObject({
			state: 'closed',
			reason: 'closed'
		})
	})

	// PresentationConnection_onclose_receiving-ua.html
	test('closes the receiving connection with "wentaway" when the controlling page goes away', async ({
		controller
	}) => {
		const receiver = await startPresentation(controller)
		await getReceiverConnection(receiver)
		await receiver.evaluate(() => {
			window.result = window.nextEvent(window.connection, 'close').then(window.describeEvent)
		})
		await controller.close({ runBeforeUnload: true })
		expect(await receiver.evaluate(() => window.result)).toMatchObject({
			state: 'closed',
			reason: 'wentaway'
		})
	})
})

test.describe('reconnect()', () => {
	// reconnectToPresentation_success-manual.https.html
	test('resolves with the existing connection, and reconnects it once closed', async ({
		controller
	}) => {
		const [receiver, result] = await Promise.all([
			controller.waitForEvent('popup'),
			controller.evaluate(async () => {
				const request = new PresentationRequest('receiver.html')
				const connection = await request.start()
				const id = connection.id
				const whileConnecting = await request.reconnect(id)
				const stateWhileConnecting = whileConnecting.state
				await window.nextEvent(connection, 'connect')
				const whileConnected = await request.reconnect(id)
				const stateWhileConnected = whileConnected.state
				connection.close()
				await window.nextEvent(connection, 'close')
				const fired = window.firesWithin(request, 'connectionavailable')
				const whileClosed = await request.reconnect(id)
				const stateWhileClosed = whileClosed.state
				const event = await window.nextEvent(whileClosed, 'connect')
				window.connection = connection
				return {
					sameWhileConnecting: whileConnecting === connection,
					stateWhileConnecting,
					sameWhileConnected: whileConnected === connection,
					stateWhileConnected,
					sameWhileClosed: whileClosed === connection,
					stateWhileClosed,
					sameId: whileClosed.id === id,
					connectEvent: window.describeEvent(event),
					// Reconnecting this page's own connection doesn't fire connectionavailable.
					connectionAvailable: await fired
				}
			})
		])
		expect(result).toEqual({
			sameWhileConnecting: true,
			stateWhileConnecting: 'connecting',
			sameWhileConnected: true,
			stateWhileConnected: 'connected',
			sameWhileClosed: true,
			stateWhileClosed: 'connecting',
			sameId: true,
			connectEvent: { type: 'connect', bubbles: false, cancelable: false, state: 'connected' },
			connectionAvailable: false
		})

		// PresentationConnectionList_onconnectionavailable_receiving-ua.html:
		// the receiver gets a new connection.
		const receiverResult = await receiver.evaluate(async () => {
			const list = await navigator.presentation.receiver!.connectionList
			return {
				count: list.connections.length,
				state: list.connections[0].state,
				reconnect: list.connections[0].polyfillInfo?.reconnect
			}
		})
		expect(receiverResult).toEqual({ count: 1, state: 'connected', reconnect: true })

		// Messages flow over the reconnected connection.
		await getReceiverConnection(receiver)
		await receiver.evaluate(() => (window.messages = window.collectMessages(window.connection)))
		await controller.evaluate(() => window.connection.send('hello again'))
		await expect
			.poll(() => receiver.evaluate(() => window.messages))
			.toEqual([{ type: 'text', data: 'hello again' }])
	})

	test('reconnects from a new page with a new connection', async ({ controller }) => {
		const receiver = await startPresentation(controller)
		await getReceiverConnection(receiver)
		const id = await controller.evaluate(() => window.connection.id)
		await receiver.evaluate(() => {
			window.result = Promise.all([
				window.nextEvent(window.connection, 'close').then(window.describeEvent),
				window.nextEvent(window.list, 'connectionavailable').then((event) => {
					const { connection } = event as PresentationConnectionAvailableEvent
					return { state: connection.state, reconnect: connection.polyfillInfo?.reconnect }
				})
			])
		})

		await controller.reload()
		const result = await controller.evaluate(async (id) => {
			const request = new PresentationRequest('receiver.html')
			const connectionAvailable = window.nextEvent(request, 'connectionavailable')
			const connection = await request.reconnect(id)
			const state = connection.state
			const event = (await connectionAvailable) as PresentationConnectionAvailableEvent
			await window.nextEvent(connection, 'connect')
			return { id: connection.id, state, eventConnection: event.connection === connection }
		}, id)
		expect(result).toEqual({ id, state: 'connecting', eventConnection: true })

		// The receiver's old connection went away, and a new one came in.
		expect(await receiver.evaluate(() => window.result)).toEqual([
			expect.objectContaining({ state: 'closed', reason: 'wentaway' }),
			{ state: 'connected', reconnect: true }
		])
	})

	// reconnectToPresentation_notfound_error-manual.https.html
	test('rejects with a NotFoundError for an unknown presentation', async ({ controller }) => {
		const error = await controller.evaluate(() =>
			window.rejectionName(
				new PresentationRequest('receiver.html').reconnect('wrongPresentationId')
			)
		)
		expect(error).toBe('NotFoundError')
	})

	// reconnectToPresentation_notfound_error-manual.https.html
	test('rejects with a NotFoundError for a request with other URLs', async ({ controller }) => {
		await startPresentation(controller)
		const errors = await controller.evaluate(async () => {
			const { id } = window.connection
			window.connection.close()
			await window.nextEvent(window.connection, 'close')
			const otherError = await window.rejectionName(
				new PresentationRequest('other-receiver.html').reconnect(id)
			)
			const sameError = await window.rejectionName(
				new PresentationRequest(['other-receiver.html', 'receiver.html']).reconnect(id)
			)
			return { otherError, sameError }
		})
		expect(errors).toEqual({ otherError: 'NotFoundError', sameError: null })
	})

	// reconnectToPresentation_success-manual.https.html
	test('rejects with a NotFoundError once the presentation is terminated', async ({
		controller
	}) => {
		await startPresentation(controller)
		const error = await controller.evaluate(async () => {
			window.connection.terminate()
			await window.nextEvent(window.connection, 'terminate')
			return window.rejectionName(window.request.reconnect(window.connection.id))
		})
		expect(error).toBe('NotFoundError')
	})
})

test.describe('terminate()', () => {
	// PresentationConnection_onterminate-manual.https.html
	test('terminates a connecting connection and closes the presentation', async ({ controller }) => {
		const [receiver, result] = await Promise.all([
			controller.waitForEvent('popup'),
			controller.evaluate(async () => {
				const connection = await new PresentationRequest('receiver.html').start()
				connection.terminate()
				// The terminate event fires asynchronously, so we can still listen for it.
				const handlerEvent = new Promise<Event>((resolve) => (connection.onterminate = resolve))
				const event = await window.nextEvent(connection, 'terminate')
				connection.terminate()
				return {
					event: window.describeEvent(event),
					sameEventForHandler: event === (await handlerEvent),
					eventTarget: event.target === connection,
					terminatesAgain: await window.firesWithin(connection, 'terminate')
				}
			})
		])
		expect(result).toEqual({
			event: { type: 'terminate', bubbles: false, cancelable: false, state: 'terminated' },
			sameEventForHandler: true,
			eventTarget: true,
			terminatesAgain: false
		})
		await expect.poll(() => receiver.isClosed()).toBe(true)
	})

	// PresentationConnection_onterminate-manual.https.html
	test('does nothing on a closed connection', async ({ controller }) => {
		const receiver = await startPresentation(controller)
		const result = await controller.evaluate(async () => {
			const { connection } = window
			connection.close()
			await window.nextEvent(connection, 'close')
			connection.terminate()
			const terminated = await window.firesWithin(connection, 'terminate')
			return { terminated, state: connection.state }
		})
		expect(result).toEqual({ terminated: false, state: 'closed' })
		expect(receiver.isClosed()).toBe(false)
	})

	// PresentationConnection_terminate_receiving-ua.html
	test('terminates the controlling connection when the receiver terminates', async ({
		controller
	}) => {
		const receiver = await startPresentation(controller)
		await getReceiverConnection(receiver)
		await controller.evaluate(() => {
			window.result = window.nextEvent(window.connection, 'terminate').then(window.describeEvent)
		})
		await Promise.all([
			receiver.waitForEvent('close'),
			receiver.evaluate(() => window.connection.terminate())
		])
		expect(await controller.evaluate(() => window.result)).toMatchObject({
			type: 'terminate',
			state: 'terminated'
		})
	})
})

// PresentationReceiver_create-manual.https.html (checkNavigation), idlharness
test('navigator.presentation.receiver', async ({ controller }) => {
	expect(await controller.evaluate(() => navigator.presentation.receiver)).toBeNull()

	const receiver = await startPresentation(controller)
	const result = await receiver.evaluate(async () => {
		const list = await navigator.presentation.receiver!.connectionList
		return {
			isReceiver: navigator.presentation.receiver instanceof PresentationReceiver,
			isList: list instanceof PresentationConnectionList,
			isArray: Array.isArray(list.connections),
			count: list.connections.length,
			isConnection: list.connections[0] instanceof PresentationConnection,
			url: list.connections[0].url === location.href,
			defaultRequest: navigator.presentation.defaultRequest
		}
	})
	expect(result).toEqual({
		isReceiver: true,
		isList: true,
		isArray: true,
		count: 1,
		isConnection: true,
		url: true,
		defaultRequest: null
	})
})
