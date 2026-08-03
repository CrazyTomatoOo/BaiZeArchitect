import { defineConfig } from "vite";

// dev: Vite dev server 代理 /api 到 gateway(:18789)。
export default defineConfig({
	server: {
		port: 5173,
		proxy: {
			"/api": "http://127.0.0.1:18789",
		},
	},
	build: { outDir: "dist" },
});
