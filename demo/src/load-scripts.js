/**
 * Load a classic script and wait for it to run.
 *
 * Vite only bundles module scripts, so the pages import the URLs of the emulator scripts with `?url`
 * and insert them from a module script. Dynamically inserted scripts run in any order, but the
 * emulator scripts must run before the Cast SDKs, so we load them one by one.
 *
 * @param {string} src
 * @param {Record<string, string>} [dataset] `data-*` attributes for the script
 * @returns {Promise<void>}
 */
export const loadScript = (src, dataset = {}) =>
	new Promise((resolve, reject) => {
		const script = document.createElement('script')
		Object.assign(script.dataset, dataset)
		script.src = src
		script.onload = () => resolve()
		script.onerror = () => reject(new Error(`Failed to load ${src}`))
		document.head.append(script)
	})

/**
 * Load classic scripts one after the other.
 *
 * @param {Array<string | [string, Record<string, string>]>} scripts URLs, or `[url, dataset]` pairs
 */
export const loadScripts = async (scripts) => {
	for (const entry of scripts) {
		const [src, dataset] = typeof entry === 'string' ? [entry, {}] : entry
		await loadScript(src, dataset)
	}
}
