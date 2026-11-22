/**
 * The player and the library.
 *
 * The player is Media Chrome around a <castable-video>, which casts with the Cast SDK: it loads the
 * current video on the receiver at the local position when a session starts, and continues locally
 * when it ends. The page only picks what to play.
 */
import { catalog } from './catalog.js'

const MEDIA_STORAGE_KEY = 'chromecast-emulator-demo:media'

/** @typedef {import('./catalog.js').MediaItem} MediaItem */

/**
 * @typedef {HTMLVideoElement & {
 *   castSrc: string | undefined
 *   remote: RemotePlayback & { state: RemotePlaybackState }
 * }} CastableVideo
 */

const formatDuration = (/** @type {number} */ seconds) => {
	const minutes = Math.floor(seconds / 60)
	return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
}

const readStoredMedia = () => {
	try {
		return localStorage.getItem(MEDIA_STORAGE_KEY)
	} catch {
		return null
	}
}

export const setupPlayer = () => {
	const video = /** @type {CastableVideo} */ (document.getElementById('video'))
	const player = /** @type {HTMLElement} */ (document.getElementById('player'))
	const library = /** @type {HTMLUListElement} */ (document.getElementById('library'))
	const title = /** @type {HTMLElement} */ (document.getElementById('media-title'))
	const credit = /** @type {HTMLElement} */ (document.getElementById('media-credit'))

	/** @type {Map<string, HTMLButtonElement>} */
	const buttons = new Map()
	for (const item of catalog) {
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'library-item'
		button.dataset.mediaId = item.id
		const image = document.createElement('img')
		image.src = item.poster
		image.alt = ''
		image.loading = 'lazy'
		const name = document.createElement('span')
		name.className = 'library-title'
		name.textContent = item.title
		const duration = document.createElement('span')
		duration.className = 'library-duration'
		duration.textContent = formatDuration(item.duration)
		const description = document.createElement('span')
		description.className = 'library-description'
		description.textContent = item.description
		button.append(image, name, duration, description)
		button.addEventListener('click', () => select(item, { play: true }))
		li.append(button)
		library.append(li)
		buttons.set(item.id, button)
	}

	/**
	 * Play an item: locally, or on the receiver while casting.
	 * @param {MediaItem} item
	 * @param {{ play: boolean }} options
	 */
	const select = (item, { play }) => {
		for (const [id, button] of buttons) {
			button.setAttribute('aria-current', String(id === item.id))
		}
		title.textContent = item.title
		credit.textContent = `${item.description} ${item.credit}.`
		// <castable-video> sends the title and poster to the receiver.
		video.title = item.title
		video.poster = item.poster
		video.src = item.src
		// While casting, a new cast-src loads it on the receiver.
		video.castSrc = item.src
		if (play && video.remote.state !== 'connected') {
			video.play().catch(() => {})
		}
		try {
			localStorage.setItem(MEDIA_STORAGE_KEY, item.id)
		} catch {}
	}

	// Start with the last video, so a reloaded page can rejoin the session that plays it.
	const stored = catalog.find(({ id }) => id === readStoredMedia())
	select(stored || catalog[0], { play: false })

	// Show where the video plays while casting.
	const updateCasting = () => {
		const casting = video.remote.state === 'connected'
		player.toggleAttribute('data-casting', casting)
		const device = window.cast?.framework?.CastContext.getInstance()
			.getCurrentSession()
			?.getCastDevice()
		const name = player.querySelector('.device-name')
		if (name && device) name.textContent = device.friendlyName
	}
	video.remote.addEventListener('connect', updateCasting)
	video.remote.addEventListener('disconnect', updateCasting)
	updateCasting()
}
