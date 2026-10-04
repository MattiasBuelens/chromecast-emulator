/**
 * A minimal stand-in for the browser's presentation dialog.
 *
 * When a page calls `PresentationRequest#start()` while it is already presenting, Chrome shows
 * its Cast dialog with the running presentation and a button to stop it. This shows a similar
 * dialog in the page itself.
 */

export interface DialogPresentation {
	id: string
	/** What the presentation shows, e.g. its URL. */
	description: string
}

const STYLES = `
	:host { all: initial; }
	dialog {
		color-scheme: light dark;
		box-sizing: border-box;
		width: min(360px, calc(100vw - 32px));
		padding: 16px;
		border: none;
		border-radius: 8px;
		box-shadow: 0 4px 24px rgb(0 0 0 / 0.3);
		background: Canvas;
		color: CanvasText;
		font: 14px/1.4 system-ui, sans-serif;
	}
	dialog::backdrop { background: rgb(0 0 0 / 0.2); }
	h2 { margin: 0 0 12px; font-size: 16px; font-weight: 600; }
	ul { margin: 0; padding: 0; list-style: none; }
	li { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
	.info { flex: 1; min-width: 0; }
	.name { font-weight: 500; }
	.description { opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.actions { display: flex; justify-content: flex-end; margin-top: 12px; }
	button { font: inherit; padding: 6px 14px; border-radius: 4px; cursor: pointer; }
`

/**
 * Show the running presentations, each with a button to stop it.
 * Resolves with the ID of the presentation to stop, or null when the user closes the dialog.
 */
export const showPresentationDialog = (
	presentations: readonly DialogPresentation[]
): Promise<string | null> =>
	new Promise((resolve) => {
		const host = document.createElement('div')
		const shadow = host.attachShadow({ mode: 'open' })
		const style = document.createElement('style')
		style.textContent = STYLES
		const dialog = document.createElement('dialog')
		dialog.setAttribute('aria-labelledby', 'title')
		// Like the browser's dialog, clicking outside of it closes it.
		dialog.setAttribute('closedby', 'any')

		const title = document.createElement('h2')
		title.id = 'title'
		title.textContent = 'Presenting'
		const list = document.createElement('ul')
		let result: string | null = null
		for (const { id, description } of presentations) {
			const item = document.createElement('li')
			const info = document.createElement('div')
			info.className = 'info'
			const name = document.createElement('div')
			name.className = 'name'
			name.textContent = 'Receiver window'
			const detail = document.createElement('div')
			detail.className = 'description'
			detail.textContent = description
			detail.title = description
			info.append(name, detail)
			const stop = document.createElement('button')
			stop.textContent = 'Stop'
			stop.addEventListener('click', () => {
				result = id
				dialog.close()
			})
			item.append(info, stop)
			list.append(item)
		}
		const actions = document.createElement('div')
		actions.className = 'actions'
		const cancel = document.createElement('button')
		cancel.textContent = 'Close'
		cancel.addEventListener('click', () => dialog.close())
		actions.append(cancel)
		dialog.append(title, list, actions)

		dialog.addEventListener('close', () => {
			host.remove()
			resolve(result)
		})

		shadow.append(style, dialog)
		document.documentElement.append(host)
		dialog.showModal()
	})
