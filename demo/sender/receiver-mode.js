/**
 * The "Open the receiver in" switch: a popup window, or a Picture-in-Picture window.
 *
 * @param {'popup' | 'pip'} mode The mode the emulator started with
 * @param {string} storageKey Where to remember the choice
 */
export const setupReceiverMode = (mode, storageKey) => {
	const fieldset = /** @type {HTMLFieldSetElement} */ (document.getElementById('receiver-mode'))
	const inputs = /** @type {NodeListOf<HTMLInputElement>} */ (
		fieldset.querySelectorAll('input[name="mode"]')
	)
	for (const input of inputs) {
		input.checked = input.value === mode
		if (input.value === 'pip' && !('documentPictureInPicture' in window)) {
			input.disabled = true
			/** @type {HTMLElement} */ (input.parentElement).title =
				'This browser does not support Document Picture-in-Picture'
		}
	}
	// The next cast uses the new mode, without reloading the page.
	fieldset.addEventListener('change', (event) => {
		const value = /** @type {HTMLInputElement} */ (event.target).value
		if (value !== 'popup' && value !== 'pip') return
		presentationPolyfill.mode = value
		try {
			localStorage.setItem(storageKey, value)
		} catch {}
	})
}
