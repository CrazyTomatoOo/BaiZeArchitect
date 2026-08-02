/**
 * gateway.ts — BaiZe web UI 网关(参考 OpenClaw:单进程服务 SPA + WebSocket)。
 *
 * 进程内调 runDesign(architect+critic 两 phase),WebSocket 流事件给前端。
 * 与 cli.ts 共用 runDesign(writeDesignPackage);cli.ts 仍独立跑 headless。
 *
 * ponytail: 不引 Hono,用 node 内置 http + ws(已装的 transitive dep);
 * 动态 import cli.ts(BAIZE_GATEWAY=1 跳过其 main,只取 runDesign/writeDesignPackage)。
 */
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { RunEvent } from "./cli.js";

// 必须在 import cli.ts 前设,否则 cli.ts 的 main 会跑(import 即执行)。
process.env.BAIZE_GATEWAY = "1";
const cli = await import("./cli.js");
const { runDesign, writeDesignPackage } = cli;

const ROOT =
	process.env.BAIZE_PROJECT_ROOT ??
	join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.BAIZE_PORT ?? 18789);
const REPOS_ROOT = process.env.BAIZE_REPOS_ROOT ?? ROOT;

interface Run {
	id: string;
	repoId: string;
	requirement: string;
	status: "running" | "done" | "error";
	events: RunEvent[];
	file?: string;
	error?: string;
	subs: Set<WebSocket>;
}
const runs = new Map<string, Run>();

function broadcast(run: Run, ev: RunEvent): void {
	run.events.push(ev);
	const msg = JSON.stringify(ev);
	for (const s of run.subs) {
		try {
			s.send(msg);
		} catch {
			run.subs.delete(s);
		}
	}
}

function startRun(
	repoId: string,
	requirement: string,
	commitSha?: string,
): string {
	const id = randomUUID();
	const run: Run = {
		id,
		repoId,
		requirement,
		status: "running",
		events: [],
		subs: new Set(),
	};
	runs.set(id, run);
	// 异步跑(不阻塞 HTTP 响应)— 事件经 onEvent→broadcast 流给 ws subscribers
	void (async () => {
		try {
			const { plan, critique } = await runDesign(
				{ repoPath: join(REPOS_ROOT, repoId), repoId, requirement, commitSha },
				(e) => broadcast(run, e),
			);
			const status = process.env.BAIZE_AUTO_APPROVE !== "0" ? "accepted" : "pending";
			const file = await writeDesignPackage(plan, critique, repoId, status);
			run.file = file;
			run.status = "done";
			broadcast(run, { type: "done", file });
		} catch (e) {
			run.status = "error";
			run.error = e instanceof Error ? e.message : String(e);
			broadcast(run, { type: "error", error: run.error });
		}
	})();
	return id;
}

async function readBody(req: IncomingMessage): Promise<string> {
	let body = "";
	for await (const chunk of req) body += chunk;
	return body;
}

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
	res.setHeader("access-control-allow-origin", "*");
	res.setHeader("access-control-allow-headers", "content-type");
	if (req.method === "OPTIONS") {
		res.writeHead(204);
		res.end();
		return;
	}
	const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

	if (url.pathname === "/" && req.method === "GET") {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ ok: true, service: "baize-gateway", runs: runs.size }));
		return;
	}

	if (url.pathname === "/api/runs" && req.method === "POST") {
		let parsed: { repoId?: string; requirement?: string; commitSha?: string };
		try {
			parsed = JSON.parse(await readBody(req));
		} catch {
			res.writeHead(400);
			res.end(JSON.stringify({ error: "bad json" }));
			return;
		}
		if (!parsed.repoId || !parsed.requirement) {
			res.writeHead(400);
			res.end(JSON.stringify({ error: "need repoId + requirement" }));
			return;
		}
		const id = startRun(parsed.repoId, parsed.requirement, parsed.commitSha);
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ runId: id, status: "started" }));
		return;
	}

	if (url.pathname === "/api/runs" && req.method === "GET") {
		const list = [...runs.values()].map((r) => ({
			id: r.id,
			repoId: r.repoId,
			status: r.status,
			file: r.file,
		}));
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify(list));
		return;
	}

	res.writeHead(404);
	res.end("not found");
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
	const url = new URL(req.url ?? "/", "http://x");
	const runId = url.searchParams.get("run");
	const run = runId ? runs.get(runId) : undefined;
	if (!run) {
		ws.send(JSON.stringify({ type: "error", error: "run not found" }));
		ws.close();
		return;
	}
	run.subs.add(ws);
	// 回放已发生事件(后连的客户端能看到完整流)
	for (const ev of run.events) ws.send(JSON.stringify(ev));
	ws.on("close", () => {
		run.subs.delete(ws);
	});
});

server.listen(PORT, () => {
	console.log(`[baize-gateway] http://127.0.0.1:${PORT} (POST /api/runs, ws /ws?run=ID)`);
});
