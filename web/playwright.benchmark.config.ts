import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: "architecture-canvas.benchmark.ts",
	fullyParallel: false,
	timeout: 60_000,
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
	projects: [{ name: "benchmark", use: { viewport: { width: 1280, height: 800 } } }],
});
