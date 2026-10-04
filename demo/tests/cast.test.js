// @ts-check
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

/** @typedef {import('@playwright/test').Page} Page */

// The sender loads its media and images from here. The tests serve their own media instead, so
// they don't depend on (or download) real content.
const MEDIA_SOURCE_ROOT = 'https://storage.googleapis.com/cpe-sample-media/content/'
// The first video in the sender's carousel.
const MEDIA_URL = `${MEDIA_SOURCE_ROOT}big_buck_bunny/prog/big_buck_bunny_prog.mp4`
const MEDIA_FILE = new URL('./fixtures/test-video.webm', import.meta.url)

/**
 * The state of the `<video>` that `<cast-media-player>` plays media in.
 * @param {Page} receiver
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

test('casts and controls media from the sender to the receiver', async ({ page: sender }) => {
	await sender.goto('/sender/')

	// Cast: the emulator opens the receiver page in a popup.
	// Wait for the Cast SDK to find the (emulated) receiver, before clicking the cast button.
	await sender.waitForFunction(
		() => window.cast?.framework?.CastContext.getInstance().getCastState() === 'NOT_CONNECTED'
	)
	const [receiver] = await Promise.all([
		sender.waitForEvent('popup'),
		sender.locator('#castbutton').click()
	])
	await expect(receiver).toHaveURL(/\/receiver\/$/)
	await expect(receiver.locator('cast-media-player')).toBeAttached()
	await expect
		.poll(() => sender.evaluate(() => cast.framework.CastContext.getInstance().getSessionState()))
		.toBe('SESSION_STARTED')

	// Pick the first video from the carousel. The sender loads it on the receiver.
	await sender.locator('#thumb0Div').click()

	// The receiver plays it...
	await expect
		.poll(() => getReceiverVideo(receiver))
		.toMatchObject({ src: MEDIA_URL, paused: false })
	await expect.poll(async () => (await getReceiverVideo(receiver))?.currentTime).toBeGreaterThan(1)
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
	await expect.poll(() => receiver.isClosed()).toBe(true)
	await expect
		.poll(() => sender.evaluate(() => cast.framework.CastContext.getInstance().getSessionState()))
		.toBe('SESSION_ENDED')
})

test('stops casting from the cast button', async ({ page: sender }) => {
	await sender.goto('/sender/')
	await sender.waitForFunction(
		() => window.cast?.framework?.CastContext.getInstance().getCastState() === 'NOT_CONNECTED'
	)
	const [receiver] = await Promise.all([
		sender.waitForEvent('popup'),
		sender.locator('#castbutton').click()
	])
	await expect(receiver.locator('cast-media-player')).toBeAttached()
	await expect
		.poll(() => sender.evaluate(() => cast.framework.CastContext.getInstance().getSessionState()))
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
	expect(receiver.isClosed()).toBe(false)
	expect(
		await sender.evaluate(() => cast.framework.CastContext.getInstance().getSessionState())
	).toBe('SESSION_STARTED')

	// Stop casting: the receiver closes its window.
	await sender.locator('#castbutton').click()
	await dialog.getByRole('button', { name: 'Stop' }).click()
	await expect(dialog).toBeHidden()
	await expect.poll(() => receiver.isClosed()).toBe(true)
	await expect
		.poll(() => sender.evaluate(() => cast.framework.CastContext.getInstance().getSessionState()))
		.toBe('SESSION_ENDED')
	await expect
		.poll(() => sender.evaluate(() => cast.framework.CastContext.getInstance().getCastState()))
		.toBe('NOT_CONNECTED')
	expect(popups).toBe(0)
})
