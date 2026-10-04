import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
	build: {
		rollupOptions: {
			input: {
				index: resolve(import.meta.dirname, 'index.html'),
				sender: resolve(import.meta.dirname, 'sender/index.html'),
				receiver: resolve(import.meta.dirname, 'receiver/index.html')
			}
		},
		// Keep the emulator scripts as files, rather than inlining small ones as data: URLs.
		assetsInlineLimit: (file) => (file.endsWith('.js') ? false : undefined)
	}
})
