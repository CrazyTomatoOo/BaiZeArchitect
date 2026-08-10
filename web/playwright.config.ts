import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	timeout: 30_000,
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5173",
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},
	webServer: {
		command: "npm run dev -- --host 127.0.0.1",
		port: 5173,
		reuseExistingServer: !process.env.CI,
	},
	projects: [
		{ name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
		{ name: "tablet", use: { viewport: { width: 1024, height: 768 } } },
		{ name: "narrow", use: { viewport: { width: 390, height: 844 } } },
	],
});
