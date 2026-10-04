import { defineConfig, type UserConfig } from 'tsdown'

// Each emulator script is a self-contained classic script, loaded with a <script> tag.
const SCRIPTS = ['presentation-polyfill', 'cast-sender-emulator', 'cast-receiver-emulator']

export default defineConfig(
	SCRIPTS.flatMap((name) =>
		[false, true].map((minify): UserConfig => ({
			entry: { [name]: `src/${name}.ts` },
			format: 'iife',
			platform: 'browser',
			target: 'es2022',
			minify,
			outputOptions: {
				entryFileNames: minify ? '[name].min.js' : '[name].js',
				// Like the source modules, the scripts run in strict mode.
				strict: true
			}
		}))
	)
)
