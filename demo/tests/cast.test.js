// @ts-check
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Frame} Frame */

// The sender loads its media and images from here. The tests serve their own media instead, so
// they don't depend on (or download) real content.
const MEDIA_SOURCE_ROOT = 'https://storage.googleapis.com/cpe-sample-media/content/'
// The first video in the sender's carousel.
const MEDIA_URL = `${MEDIA_SOURCE_ROOT}big_buck_bunny/prog/big_buck_bunny_prog.mp4`
const MEDIA_FILE = new URL('./fixtures/test-video.webm', import.meta.url)

/**
 * The state of the `<video>` that `<cast-media-player>` plays media in.
 * @param {Frame} receiver
 */
const getReceiverVideo = (receiver) =>
	receiver.evaluate(() => {
		const video = document.querySelector('cast-media-player')?.shadowRoot?.querySelector('video')
		return video && { src: video.currentSrc, paused: video.paused, currentTime: video.currentTime }
	})

/**
 * The state of the Cast session and its media, as the sender SDK sees it.
 * @param {Page} sender
 */
const getSenderPlayer = (sender) =>
	sender.evaluate(() => {
		const context = cast.framework.CastContext.getInstance()
		const media = context.getCurrentSession()?.getMediaSession()
		return {
			sessionState: context.getSessionState(),
			contentId: media?.media?.contentId,
			playerState: media?.playerState
		}
	})

test.beforeEach(async ({ context }) => {
	const body = await readFile(MEDIA_FILE)
	// context.route() also covers the receiver popup.
	await context.route(`${MEDIA_SOURCE_ROOT}**`, (route) =>
		route.request().url() === MEDIA_URL
			? route.fulfill({
					body,
					// The sender says "video/mp4", but browsers sniff the actual format.
					contentType: 'video/webm',
					headers: { 'Access-Control-Allow-Origin': '*' }
				})
			: // Thumbnails
				route.fulfill({ status: 404 })
	)
})

/**
 * Open the sender page, and cast from it with the cast button.
 *
 * In "popup" mode, the emulator opens the receiver page in a popup. In "pip" mode, it opens a
 * Picture-in-Picture window (which Playwright also reports as a popup) with the receiver page
 * in an iframe.
 *
 * @param {Page} sender
 * @param {'popup' | 'pip'} mode
 * @returns {Promise<{ receiver: Frame, receiverWindow: Page }>}
 */
const castFromSender = async (sender, mode) => {
	await sender.goto(`/sender/?mode=${mode}`)
	// Wait for the Cast SDK to find the (emulated) receiver, before clicking the cast button.
	await sender.waitForFunction(
		() => window.cast?.framework?.CastContext.getInstance().getCastState() === 'NOT_CONNECTED'
	)
	const [receiverWindow] = await Promise.all([
		sender.waitForEvent('popup'),
		sender.locator('#castbutton').click()
	])
	/** @type {Frame | undefined} */
	let receiver
	if (mode === 'pip') {
		await expect
			.poll(
				() => (receiver = receiverWindow.frames().find((f) => f !== receiverWindow.mainFrame()))
			)
			.toBeTruthy()
	} else {
		receiver = receiverWindow.mainFrame()
	}
	await expect.poll(() => receiver?.url()).toMatch(/\/receiver\/$/)
	return { receiver: /** @type {Frame} */ (receiver), receiverWindow }
}

for (const mode of /** @type {const} */ (['popup', 'pip'])) {
	test.describe(`${mode} mode`, () => {
		test('casts and controls media from the sender to the receiver', async ({ page: sender }) => {
			// Cast: the emulator opens the receiver page.
			const { receiver, receiverWindow } = await castFromSender(sender, mode)
			await expect(receiver.locator('cast-media-player')).toBeAttached()
			await expect
				.poll(() =>
					sender.evaluate(() => cast.framework.CastContext.getInstance().getSessionState())
				)
				.toBe('SESSION_STARTED')

			// Pick the first video from the carousel. The sender loads it on the receiver.
			await sender.locator('#thumb0Div').click()

			// The receiver plays it...
			await expect
				.poll(() => getReceiverVideo(receiver))
				.toMatchObject({ src: MEDIA_URL, paused: false })
			await expect
				.poll(async () => (await getReceiverVideo(receiver))?.currentTime)
				.toBeGreaterThan(1)
			// ...and the sender sees it playing.
			await expect
				.poll(() => getSenderPlayer(sender))
				.toEqual({ sessionState: 'SESSION_STARTED', contentId: MEDIA_URL, playerState: 'PLAYING' })
			await expect(sender.locator('#playerstate')).toHaveText(/Big Buck Bunny/)

			// Pause from the sender's media controls.
			await sender.locator('#pause').click()
			await expect.poll(async () => (await getReceiverVideo(receiver))?.paused).toBe(true)
			await expect.poll(async () => (await getSenderPlayer(sender)).playerState).toBe('PAUSED')

			// Stop casting: the receiver closes its window.
			await sender.evaluate(() => cast.framework.CastContext.getInstance().endCurrentSession(true))
			await expect.poll(() => receiverWindow.isClosed()).toBe(true)
			await expect
				.poll(() =>
					sender.evaluate(() => cast.framework.CastContext.getInstance().getSessionState())
				)
				.toBe('SESSION_ENDED')
		})

		test('stops casting from the cast button', async ({ page: sender }) => {
			const { receiver, receiverWindow } = await castFromSender(sender, mode)
			await expect(receiver.locator('cast-media-player')).toBeAttached()
			await expect
				.poll(() =>
					sender.evaluate(() => cast.framework.CastContext.getInstance().getSessionState())
				)
				.toBe('SESSION_STARTED')

			// While casting, the cast button shows the running session instead of starting another one.
			let popups = 0
			sender.on('popup', () => popups++)
			await sender.locator('#castbutton').click()
			const dialog = sender.getByRole('dialog', { name: 'Presenting' })
			await expect(dialog).toBeVisible()

			// Clicking outside the dialog closes it.
			await sender.mouse.click(5, 5)
			await expect(dialog).toBeHidden()
			await sender.locator('#castbutton').click()
			await expect(dialog).toBeVisible()

			// Closing the dialog keeps casting.
			await dialog.getByRole('button', { name: 'Close' }).click()
			await expect(dialog).toBeHidden()
			expect(receiverWindow.isClosed()).toBe(false)
			expect(
				await sender.evaluate(() => cast.framework.CastContext.getInstance().getSessionState())
			).toBe('SESSION_STARTED')

			// Stop casting: the receiver closes its window.
			await sender.locator('#castbutton').click()
			await dialog.getByRole('button', { name: 'Stop' }).click()
			await expect(dialog).toBeHidden()
			await expect.poll(() => receiverWindow.isClosed()).toBe(true)
			await expect
				.poll(() =>
					sender.evaluate(() => cast.framework.CastContext.getInstance().getSessionState())
				)
				.toBe('SESSION_ENDED')
			await expect
				.poll(() => sender.evaluate(() => cast.framework.CastContext.getInstance().getCastState()))
				.toBe('NOT_CONNECTED')
			expect(popups).toBe(0)
		})
	})
}

/**
 * Start casting from the sender page in popup mode, and return the receiver page once the session
 * started.
 * @param {Page} sender
 */
const startCasting = async (sender) => {
	const { receiverWindow: receiver } = await castFromSender(sender, 'popup')
	await expect(receiver.locator('cast-media-player')).toBeAttached()
	await expect
		.poll(() => sender.evaluate(() => cast.framework.CastContext.getInstance().getSessionState()))
		.toBe('SESSION_STARTED')
	return receiver
}

/**
 * The messages the receiver emulator exchanged, with their (parsed) payloads.
 * @param {Page} receiver
 */
const getTrace = (receiver) =>
	receiver.evaluate(() =>
		window.castReceiverEmulator.trace.map(({ direction, message }) => {
			if (direction === 'emulator -> sender') return { direction, message }
			/** @type {any} */
			let parsed = JSON.parse(/** @type {string} */ (message))
			// IPC messages carry their payload as a JSON string.
			if (typeof parsed?.data === 'string') {
				try {
					parsed = { ...parsed, data: JSON.parse(parsed.data) }
				} catch {}
			}
			return { direction, message: parsed }
		})
	)

test('asks the receiver for its media status after a launch, like Chrome', async ({
	page: sender
}) => {
	const receiver = await startCasting(sender)

	await expect
		.poll(async () =>
			(await getTrace(receiver)).some(
				({ direction, message }) =>
					direction === 'emulator -> sender' &&
					message.type === 'v2_message' &&
					message.message?.type === 'MEDIA_STATUS'
			)
		)
		.toBe(true)
	const trace = await getTrace(receiver)
	expect(
		trace.some(
			({ direction, message }) =>
				direction === 'platform -> receiver' && message.data?.type === 'GET_STATUS'
		)
	).toBe(true)
	// The session info has the fields a real device reports.
	const newSession = trace.find(({ message }) => message.type === 'new_session')?.message.message
	expect(newSession).toMatchObject({ appType: 'WEB', universalAppId: newSession?.appId })
})

test('leaves the session without stopping the receiver', async ({ page: sender }) => {
	const receiver = await startCasting(sender)

	await sender.evaluate(() => cast.framework.CastContext.getInstance().endCurrentSession(false))
	await expect
		.poll(() => sender.evaluate(() => cast.framework.CastContext.getInstance().getSessionState()))
		.toBe('SESSION_ENDED')
	// The sender disconnected, but the receiver keeps running.
	await expect
		.poll(async () =>
			(await getTrace(receiver)).some(
				({ direction, message }) =>
					direction === 'platform -> receiver' && message.data?.type === 'senderdisconnected'
			)
		)
		.toBe(true)
	expect(receiver.isClosed()).toBe(false)
})

test('fills in media status fields the receiver leaves out', async ({ page: sender }) => {
	const receiver = await startCasting(sender)
	await sender.locator('#thumb0Div').click()
	await expect.poll(async () => (await getSenderPlayer(sender)).playerState).toBe('PLAYING')

	// The media statuses the receiver sent, and the ones the emulator passed on to the sender SDK.
	const statuses = await receiver.evaluate(() =>
		window.castReceiverEmulator.trace.flatMap(({ direction, message }) => {
			if (direction === 'receiver -> platform') {
				const { data } = JSON.parse(/** @type {string} */ (message))
				message = JSON.parse(data)
			} else if (direction === 'emulator -> sender') {
				message = /** @type {any} */ (message).message
			} else {
				return []
			}
			if (message?.type !== 'MEDIA_STATUS') return []
			return message.status.map((/** @type {any} */ status) => ({
				direction,
				mediaSessionId: status.mediaSessionId,
				hasMedia: !!status.media
			}))
		})
	)
	const fromReceiver = statuses.filter(({ direction }) => direction === 'receiver -> platform')
	const toSender = statuses.filter(({ direction }) => direction === 'emulator -> sender')
	// CAF only includes `media` in a status when it has changed...
	expect(fromReceiver.some(({ hasMedia }) => !hasMedia)).toBe(true)
	// ...but like Chrome, the emulator fills it in from the previous status of the same media session.
	// (Otherwise the sender SDK can create a media session without media info.)
	const seen = new Set()
	for (const { mediaSessionId, hasMedia } of toSender) {
		if (seen.has(mediaSessionId)) expect(hasMedia).toBe(true)
		if (hasMedia) seen.add(mediaSessionId)
	}
})
