import { defineConfig } from "vite";

// dev: Vite dev server 代理 /api + /ws 到 gateway(:18789, OpenClaw 同端口模式)。
// prod: gateway 服务 dist/(静态),/ws 同源。
export default defineConfig({
	server: {
		port: 5173,
		proxy: {
			"/api": "http://127.0.0.1:18789",
			"/ws": { target: "ws://127.0.0.1:18789", ws: true },
		},
	},
	build: { outDir: "dist" },
});
