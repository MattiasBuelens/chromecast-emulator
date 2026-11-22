/**
 * The "Messages" section: the messages between the Cast SDK and the receiver, from the emulator's
 * `castSenderEmulator.trace` and its `message` events.
 */

/** @typedef {import('@mattiasbuelens/chromecast-emulator/cast-sender-emulator').CastMessage} CastMessage */

const MAX_ROWS = 500
const NAMESPACE_PREFIX = 'urn:x-cast:'
const GOOGLE_NAMESPACE_PREFIX = 'urn:x-cast:com.google.cast.'

/**
 * A short name for a Cast namespace, like "media" for urn:x-cast:com.google.cast.media.
 * @param {string | null} namespace
 */
const shortNamespace = (namespace) => {
	if (!namespace) return ''
	if (namespace.startsWith(GOOGLE_NAMESPACE_PREFIX))
		return namespace.slice(GOOGLE_NAMESPACE_PREFIX.length)
	return namespace.replace(NAMESPACE_PREFIX, '')
}

/**
 * Which filter a message belongs to.
 * @param {CastMessage} message
 * @returns {'media' | 'session' | 'custom'}
 */
const categorize = ({ type, namespace }) => {
	if (type === 'v2_message' && namespace?.endsWith('.media')) return 'media'
	if (type === 'app_message') return 'custom'
	return 'session'
}

/** @param {number} time */
const formatTime = (time) => {
	const date = new Date(time)
	const pad = (/** @type {number} */ n, length = 2) => String(n).padStart(length, '0')
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/**
 * A short label for a message, like "LOAD" or "new_session".
 * @param {CastMessage} message
 */
const describe = ({ type, messageType }) => messageType || type || '(unknown)'

/**
 * The content of a message, without the envelope fields that every message has.
 * @param {CastMessage} message
 */
const contentOf = ({ message }) => {
	if (message && typeof message === 'object' && 'message' in message) {
		return /** @type {{ message: unknown }} */ (message).message
	}
	return message
}

/** @param {unknown} value */
const preview = (value) => {
	const text = JSON.stringify(value) ?? String(value)
	return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

export const setupMessageLog = () => {
	const list = /** @type {HTMLOListElement} */ (document.getElementById('message-list'))
	const empty = /** @type {HTMLElement} */ (document.getElementById('message-empty'))
	const count = /** @type {HTMLElement} */ (document.getElementById('message-count'))
	const filter = /** @type {HTMLFieldSetElement} */ (document.getElementById('message-filter'))
	const pause = /** @type {HTMLInputElement} */ (document.getElementById('message-pause'))
	const clear = /** @type {HTMLButtonElement} */ (document.getElementById('message-clear'))

	const emulator = window.castSenderEmulator
	if (!emulator) {
		empty.textContent = 'The sender emulator is not loaded.'
		return
	}

	const updateCount = () => {
		count.textContent = String(list.childElementCount)
		empty.hidden = list.childElementCount > 0
	}

	/** @param {CastMessage} message */
	const add = (message) => {
		const category = categorize(message)
		const row = document.createElement('li')
		row.className = 'message'
		row.dataset.direction = message.direction
		row.dataset.category = category

		const details = document.createElement('details')
		const summary = document.createElement('summary')
		const time = document.createElement('time')
		time.textContent = formatTime(message.time)
		const direction = document.createElement('span')
		direction.className = 'direction'
		direction.textContent = message.direction === 'send' ? '→ receiver' : '← receiver'
		direction.title =
			message.direction === 'send'
				? 'From the Cast SDK in this page to the receiver'
				: 'From the receiver to the Cast SDK in this page'
		const namespace = document.createElement('span')
		namespace.className = 'namespace'
		namespace.textContent = shortNamespace(message.namespace)
		namespace.title = message.namespace || 'A message between the Cast SDK and the browser'
		const label = document.createElement('span')
		label.className = 'label'
		label.textContent = describe(message)
		const content = document.createElement('code')
		content.className = 'preview'
		content.textContent = preview(contentOf(message))
		summary.append(time, direction, namespace, label, content)

		const full = document.createElement('pre')
		full.textContent = JSON.stringify(message.message, null, 2)
		details.append(summary, full)
		row.append(details)

		list.append(row)
		while (list.childElementCount > MAX_ROWS) list.firstElementChild?.remove()
		updateCount()
	}

	/** @type {CastMessage[]} */
	let paused = []
	for (const message of emulator.trace) add(message)
	emulator.addEventListener('message', (event) => {
		const message = /** @type {CustomEvent<CastMessage>} */ (event).detail
		if (pause.checked) paused.push(message)
		else add(message)
	})
	pause.addEventListener('change', () => {
		if (pause.checked) return
		for (const message of paused) add(message)
		paused = []
	})
	clear.addEventListener('click', () => {
		list.replaceChildren()
		paused = []
		updateCount()
	})
	filter.addEventListener('change', (event) => {
		list.dataset.filter = /** @type {HTMLInputElement} */ (event.target).value
	})
	list.dataset.filter = 'all'
	updateCount()
}
