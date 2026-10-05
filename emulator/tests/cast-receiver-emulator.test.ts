/**
 * Tests for the autoplay handling of cast-receiver-emulator.js.
 *
 * The receiver page opens without a user gesture of its own, so the autoplay policy may block its
 * media. These tests load a page with just the receiver emulator, and play audio in it like CAF does.
 *
 * Chromium under Playwright Test doesn't reliably apply its autoplay policy, so the test page
 * simulates one: until the first click or key press, play() rejects and the autoplay attribute
 * does nothing.
 */
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

declare global {
	interface Window {
		media: HTMLAudioElement
		loadMedia(): void
	}
}

// A made-up secure origin, served by the tests themselves.
const ORIGIN = 'https://receiver.test'

/** A second of a 440 Hz tone, as a WAV file. */
const createTone = () => {
	const rate = 8000
	const samples = rate
	const wav = Buffer.alloc(44 + samples * 2)
	wav.write('RIFF', 0)
	wav.writeUInt32LE(36 + samples * 2, 4)
	wav.write('WAVEfmt ', 8)
	wav.writeUInt32LE(16, 16)
	wav.writeUInt16LE(1, 20) // PCM
	wav.writeUInt16LE(1, 22) // mono
	wav.writeUInt32LE(rate, 24)
	wav.writeUInt32LE(rate * 2, 28)
	wav.writeUInt16LE(2, 32)
	wav.writeUInt16LE(16, 34)
	wav.write('data', 36)
	wav.writeUInt32LE(samples * 2, 40)
	for (let i = 0; i < samples; i++) {
		wav.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2)
	}
	return wav
}

// Runs before the receiver emulator, like the browser's own autoplay policy.
const SIMULATE_AUTOPLAY_POLICY = `
	let activated = false
	const activate = () => (activated = true)
	addEventListener('pointerdown', activate, true)
	addEventListener('keydown', activate, true)
	const proto = HTMLMediaElement.prototype
	const play = proto.play
	proto.play = function () {
		return activated ? play.call(this) : Promise.reject(new DOMException('Blocked', 'NotAllowedError'))
	}
	// The real autoplay attribute stays off; we start the media ourselves when it's allowed.
	const autoplay = new WeakMap()
	Object.defineProperty(proto, 'autoplay', {
		configurable: true,
		get() {
			return !!autoplay.get(this)
		},
		set(value) {
			if (!autoplay.has(this)) {
				this.addEventListener('canplaythrough', () => {
					if (autoplay.get(this) && activated && this.paused) play.call(this)
				})
			}
			autoplay.set(this, !!value)
		}
	})
`

// Loads media like CAF's player does: with the autoplay attribute, rather than play().
const PAGE = `<!doctype html><meta charset="utf-8">
<script>${SIMULATE_AUTOPLAY_POLICY}</script>
<script src="/cast-receiver-emulator.js"></script>
<button id="load">Load</button>
<script>
	window.media = new Audio()
	document.body.append(media)
	window.loadMedia = () => {
		media.autoplay = false
		media.src = '/tone.wav'
		media.autoplay = true
		media.load()
	}
	document.querySelector('#load').onclick = loadMedia
	// Load without a user gesture, like a receiver loading media on a sender's request.
	if (location.hash === '#autoload') setTimeout(loadMedia)
	if (location.hash === '#autoload-and-pause') setTimeout(() => (loadMedia(), media.pause()))
</script>`

test.beforeEach(async ({ context }) => {
	const files: Record<string, { body: string | Buffer; contentType: string }> = {
		'/receiver.html': { body: PAGE, contentType: 'text/html' },
		'/cast-receiver-emulator.js': {
			body: await readFile(new URL('../dist/cast-receiver-emulator.js', import.meta.url)),
			contentType: 'text/javascript'
		},
		'/tone.wav': { body: createTone(), contentType: 'audio/wav' }
	}
	await context.route(`${ORIGIN}/**`, (route) => {
		const file = files[new URL(route.request().url()).pathname]
		return file ? route.fulfill(file) : route.fulfill({ status: 404 })
	})
})

const OVERLAY = 'text=Click to allow media playback'

test('asks for a click when the autoplay policy blocks the autoplay attribute', async ({
	page
}) => {
	await page.goto(`${ORIGIN}/receiver.html#autoload`)
	await expect(page.locator(OVERLAY)).toBeVisible()
	expect(await page.evaluate(() => window.media.paused)).toBe(true)

	// A click anywhere in the page lets the media play.
	await page.mouse.click(10, 10)
	await expect(page.locator(OVERLAY)).toBeHidden()
	await expect.poll(() => page.evaluate(() => window.media.paused)).toBe(false)
})

test('does not ask for a click when autoplay is allowed', async ({ page }) => {
	await page.goto(`${ORIGIN}/receiver.html`)
	await page.locator('#load').click()
	await expect.poll(() => page.evaluate(() => window.media.paused)).toBe(false)
	await expect(page.locator(OVERLAY)).toHaveCount(0)
})

test('does not play media that was paused before it could autoplay', async ({ page }) => {
	await page.goto(`${ORIGIN}/receiver.html#autoload-and-pause`)
	await expect.poll(() => page.evaluate(() => window.media.readyState)).toBe(4)
	await page.waitForTimeout(200)
	expect(await page.evaluate(() => window.media.paused)).toBe(true)
	await expect(page.locator(OVERLAY)).toHaveCount(0)
})
