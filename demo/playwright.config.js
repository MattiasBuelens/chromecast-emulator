import { defineConfig, devices } from '@playwright/test'

const PORT = 4173

export default defineConfig({
	testDir: './tests',
	timeout: 60_000,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	// In CI, write an HTML report to upload as a workflow artifact.
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'retain-on-failure',
		launchOptions: {
			// The receiver popup has no user gesture of its own, so let it play media right away.
			// CHROMIUM_ARGS adds more flags, e.g. to trust a proxy's CA certificate in CI.
			args: [
				'--autoplay-policy=no-user-gesture-required',
				...(process.env.CHROMIUM_ARGS?.split(' ').filter(Boolean) ?? [])
			],
			// Use a Chromium that is already installed, instead of `playwright install chromium`.
			executablePath: process.env.CHROMIUM_PATH || undefined
		}
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: `vite --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}/sender/`,
		reuseExistingServer: !process.env.CI
	}
})
