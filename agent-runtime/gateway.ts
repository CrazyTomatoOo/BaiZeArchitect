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
import { openStore, type Stage } from "./store.js";
import type { RunEvent, StageName } from "./cli.js";

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
const store = openStore(join(ROOT, ".baize", "baize.db"));

const STAGE_CN: Record<StageName, Stage> = {
	analysis: "分析",
	scenario: "场景",
	usecase: "用例",
	function: "功能分解",
};

function writeStageAssets(
	wsId: number,
	reqId: number,
	stage: string,
	assets: unknown,
): unknown[] {
	const a = (assets ?? {}) as Record<string, unknown[]>;
	const refs: unknown[] = [];
	if (stage === "scenario") {
		for (const s of (a.scenarios ?? []) as Array<{ title?: string; description?: string }>) {
			const sid = store.addScenario(wsId, s.title ?? "", s.description ?? "");
			store.linkRequirementScenario(reqId, sid);
			refs.push({ type: "scenario", id: sid, title: s.title });
		}
	} else if (stage === "usecase") {
		const scens = store.listScenarios(wsId) as Array<{ id: number; title: string }>;
		for (const u of (a.useCases ?? []) as Array<Record<string, unknown>>) {
			const scen = scens.find((s) => s.title === u.scenarioTitle) ?? null;
			const uid = store.addUseCase(wsId, scen ? scen.id : null, (u.title as string) ?? "", {
				precondition: (u.precondition as string) ?? "",
				mainFlow: (u.mainFlow as string) ?? "",
				exceptions: (u.exceptions as string) ?? "",
				postcondition: (u.postcondition as string) ?? "",
			});
			refs.push({ type: "usecase", id: uid, title: u.title });
		}
	} else if (stage === "function") {
		for (const d of (a.domains ?? []) as Array<Record<string, unknown>>) {
			const did = store.addFunctionDomain(wsId, (d.name as string) ?? "", (d.description as string) ?? "");
			refs.push({ type: "domain", id: did, name: d.name });
			for (const it of (d.items ?? []) as Array<{ title?: string; description?: string }>) {
				const fid = store.addFunctionItem(wsId, did, it.title ?? "", it.description ?? "");
				refs.push({ type: "function", id: fid, title: it.title });
			}
		}
	} else {
		refs.push(assets); // analysis 结论
	}
	return refs;
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

		if (url.pathname === "/api/workspaces" && req.method === "GET") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(store.listWorkspaces()));
			return;
		}

		if (url.pathname === "/api/workspaces" && req.method === "POST") {
			const b = JSON.parse(await readBody(req)) as { repoPath?: string; name?: string };
			const id = store.addWorkspace(b.repoPath ?? "", b.name ?? "");
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ id }));
			return;
		}

		if (url.pathname === "/api/requirements" && req.method === "GET") {
			const ws = Number(url.searchParams.get("workspace") ?? 0);
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(store.listRequirements(ws)));
			return;
		}

		if (url.pathname === "/api/requirements" && req.method === "POST") {
			const b = JSON.parse(await readBody(req)) as {
				workspaceId?: number;
				title?: string;
				description?: string;
			};
			const id = store.addRequirement(b.workspaceId ?? 0, b.title ?? "", b.description ?? "");
			store.setStage(id, "录入", "完成");
			for (const st of ["分析", "场景", "用例", "功能分解"] as const) {
				store.setStage(id, st, "未开始");
			}
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ id }));
			return;
		}

		const stagesOf = url.pathname.match(/^\/api\/requirements\/(\d+)\/stages$/);
		if (stagesOf && req.method === "GET") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(store.getStages(Number(stagesOf[1]))));
			return;
		}

		const stageRun = url.pathname.match(
			/^\/api\/requirements\/(\d+)\/stage\/(analysis|scenario|usecase|function)\/run$/,
		);
		if (stageRun && req.method === "POST") {
			const reqId = Number(stageRun[1]);
			const stage = stageRun[2] as StageName;
			const requirement = store.getRequirement(reqId) as
				| { workspace_id: number; title: string; description: string }
				| undefined;
			if (!requirement) {
				res.writeHead(404);
				res.end("not found");
				return;
			}
			const ws = store.getWorkspace(requirement.workspace_id) as
				| { repo_path: string }
				| undefined;
			const { runStage } = await import("./cli.js");
			const assets = await runStage({
				repoPath: ws?.repo_path ?? ROOT,
				repoId: ws?.repo_path.split("/").pop() ?? "",
				requirementTitle: requirement.title,
				requirementDesc: requirement.description,
				upstream: JSON.stringify(store.getStages(reqId)),
				stage,
			});
			const refs = writeStageAssets(requirement.workspace_id, reqId, stage, assets);
			store.setStage(reqId, STAGE_CN[stage], "待审", refs);
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true, refs }));
			return;
		}

		const stageApprove = url.pathname.match(
			/^\/api\/requirements\/(\d+)\/stage\/(analysis|scenario|usecase|function)\/approve$/,
		);
		if (stageApprove && req.method === "POST") {
			store.setStage(Number(stageApprove[1]), STAGE_CN[stageApprove[2] as StageName], "完成");
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
			return;
		}

		if (url.pathname === "/api/overview" && req.method === "GET") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(store.counts()));
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
