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
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
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
const OUT_DIR = process.env.BAIZE_OUT_DIR ?? join(ROOT, "out");
const EVIDENCE_DIR = process.env.BAIZE_EVIDENCE_DIR ?? join(ROOT, "evidence");

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
			const status =
				process.env.BAIZE_AUTO_APPROVE !== "0" ? "accepted" : "pending";
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

interface PackageInfo {
	name: string;
	repoId: string;
	status: string;
}

async function listPackages(): Promise<PackageInfo[]> {
	const files = await readdir(OUT_DIR);
	const out: PackageInfo[] = [];
	for (const f of files) {
		if (!f.startsWith("design-package-") || !f.endsWith(".md")) continue;
		const content = await readFile(join(OUT_DIR, f), "utf8");
		const status = (content.match(/^> 审批状态: (.+)$/m) ?? [, "?"])[1].trim();
		const repoId = f.replace(/^design-package-/, "").replace(/\.md$/, "");
		out.push({ name: f, repoId, status });
	}
	out.sort((a, b) => (a.name < b.name ? 1 : -1));
	return out;
}
async function listRepos(): Promise<string[]> {
	const dirs = await readdir(REPOS_ROOT, { withFileTypes: true });
	const out: string[] = [];
	for (const d of dirs) {
		if (!d.isDirectory()) continue;
		try {
			await stat(join(REPOS_ROOT, d.name, ".git"));
			out.push(d.name);
		} catch {
			/* not a git repo */
		}
	}
	return out;
}

async function readEvidence(repoId: string): Promise<unknown> {
	try {
		return JSON.parse(await readFile(join(EVIDENCE_DIR, `${repoId}.json`), "utf8"));
	} catch {
		return null;
	}
}

async function listGenes(): Promise<Array<Record<string, unknown>>> {
	const file = join(
		process.env.EVOLVER_HOME ?? join(ROOT, "evolver-home"),
		"assets",
		"genes.jsonl",
	);
	try {
		const raw = await readFile(file, "utf8");
		return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
	} catch {
		return [];
	}
}

const server = http.createServer(
	async (req: IncomingMessage, res: ServerResponse) => {
		res.setHeader("access-control-allow-origin", "*");
		res.setHeader("access-control-allow-headers", "content-type");
		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}
		const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
		const baizeToken = process.env.BAIZE_TOKEN;
		if (baizeToken && url.pathname.startsWith("/api")) {
			if ((req.headers.authorization ?? "") !== `Bearer ${baizeToken}`) {
				res.writeHead(401);
				res.end(JSON.stringify({ error: "unauthorized" }));
				return;
			}
		}

		if (url.pathname === "/" && req.method === "GET") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({ ok: true, service: "baize-gateway", runs: runs.size }),
			);
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

		const seg = url.pathname.split("/");

		if (
			seg[1] === "api" &&
			seg[2] === "packages" &&
			seg.length === 3 &&
			req.method === "GET"
		) {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(await listPackages()));
			return;
		}

		if (
			seg[1] === "api" &&
			seg[2] === "packages" &&
			seg.length === 4 &&
			seg[3].startsWith("design-package-") &&
			seg[3].endsWith(".md") &&
			req.method === "GET"
		) {
			try {
				const content = await readFile(join(OUT_DIR, seg[3]), "utf8");
				res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
				res.end(content);
			} catch {
				res.writeHead(404);
				res.end("not found");
			}
			return;
		}

		if (
			seg[1] === "api" &&
			seg[2] === "packages" &&
			seg.length === 5 &&
			seg[4] === "approve" &&
			seg[3].startsWith("design-package-") &&
			req.method === "POST"
		) {
			try {
				const file = join(OUT_DIR, seg[3]);
				const content = await readFile(file, "utf8");
				const updated = content.replace(/^(> 审批状态:) .*$/m, "$1 accepted");
				await writeFile(file, updated, "utf8");
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ ok: true, status: "accepted" }));
			} catch (e) {
				res.writeHead(500);
				res.end(JSON.stringify({ error: String(e) }));
			}
			return;
		}
		if (url.pathname === "/api/repos" && req.method === "GET") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(await listRepos()));
			return;
		}

		if (
			seg[1] === "api" &&
			seg[2] === "evidence" &&
			seg.length === 4 &&
			req.method === "GET"
		) {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(await readEvidence(seg[3])));
			return;
		}

		if (url.pathname === "/api/genes" && req.method === "GET") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(await listGenes()));
			return;
		}

		res.writeHead(404);
		res.end("not found");
	},
);

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
	console.log(
		`[baize-gateway] http://127.0.0.1:${PORT} (POST /api/runs, ws /ws?run=ID)`,
	);
});
