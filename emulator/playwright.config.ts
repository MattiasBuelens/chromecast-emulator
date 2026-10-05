import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
	testDir: './tests',
	timeout: 30_000,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	// In CI, write an HTML report to upload as a workflow artifact.
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		trace: 'retain-on-failure',
		launchOptions: {
			// Use a Chromium that is already installed, instead of `playwright install chromium`.
			executablePath: process.env.CHROMIUM_PATH || undefined
		}
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
})
