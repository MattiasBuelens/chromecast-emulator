import { defineConfig } from 'tsdown'

// Each emulator script is a self-contained classic script, loaded with a <script> tag.
const SCRIPTS = ['presentation-polyfill', 'cast-sender-emulator', 'cast-receiver-emulator']

export default defineConfig(
	SCRIPTS.flatMap((name) =>
		[false, true].map((minify) => ({
			entry: { [name]: `src/${name}.js` },
			format: 'iife',
			platform: 'browser',
			target: 'es2020',
			minify,
			outputOptions: {
				entryFileNames: minify ? '[name].min.js' : '[name].js',
				// Like the source modules, the scripts run in strict mode.
				strict: true
			}
		}))
	)
)
