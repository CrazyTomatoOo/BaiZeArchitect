/**
 * gateway.ts — BaiZe web UI 网关:单进程 HTTP API,服务前端旅程。
 *
 * 旅程状态机:workspace → requirement → 阶段流水线
 *   分析 → 场景 → 用例 → 功能分解 → 功能设计 → 归档
 * 每阶段:未开始 --run--> 待审 --approve--> 完成
 *                  └--reject(意见)--> 打回 --run(意见注入重跑)--> 待审
 * 门禁:上一阶段完成才能 run 下一阶段;归档为确定性汇总落盘,不走 LLM。
 *
 * ponytail: 不引 Hono,用 node 内置 http;动态 import cli.ts(BAIZE_GATEWAY=1 跳过 main,只取 runStage)。
 */
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { openStore, type Stage } from "./store.js";
import type { StageName } from "./cli.js";

// 必须在 import cli.ts 前设,否则 cli.ts 的 main 会跑(import 即执行)。
process.env.BAIZE_GATEWAY = "1";
const { runStage, chatIntake } = await import("./cli.js");

const ROOT =
	process.env.BAIZE_PROJECT_ROOT ??
	join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.BAIZE_PORT ?? 18789);
const REPOS_ROOT = process.env.BAIZE_REPOS_ROOT ?? ROOT;
const OUT_DIR = process.env.BAIZE_OUT_DIR ?? join(ROOT, "out");
const EVIDENCE_DIR = process.env.BAIZE_EVIDENCE_DIR ?? join(ROOT, "evidence");
// 生产部署:单进程服务 web/dist(SPA);dev 用 vite(:5173)代理 /api。
const WEB_DIST = process.env.BAIZE_WEB_DIST ?? join(ROOT, "web", "dist");

async function readBody(req: IncomingMessage): Promise<string> {
	let body = "";
	for await (const chunk of req) body += chunk;
	return body;
}

// malformed JSON 不炸连接,返回 null 由调用方回 400
async function readJson(
	req: IncomingMessage,
): Promise<Record<string, unknown> | null> {
	try {
		return JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
	} catch {
		return null;
	}
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
		return JSON.parse(
			await readFile(join(EVIDENCE_DIR, `${repoId}.json`), "utf8"),
		);
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
		return raw
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l));
	} catch {
		return [];
	}
}

const store = openStore(join(ROOT, ".baize", "baize.db"));

// 阶段流水线(LLM 阶段,按序门禁);归档单独处理。
const STAGE_ORDER: StageName[] = [
	"analysis",
	"scenario",
	"usecase",
	"function",
	"design",
];
const STAGE_CN: Record<StageName, Stage> = {
	analysis: "分析",
	scenario: "场景",
	usecase: "用例",
	function: "功能分解",
	design: "功能设计",
};

interface StageRow {
	requirement_id: number;
	stage: string;
	status: string;
	artifact_refs: string;
	feedback: string;
	updated_at: string;
}

function parseRefs(row: StageRow | undefined): unknown[] {
	if (!row) return [];
	try {
		return JSON.parse(row.artifact_refs) as unknown[];
	} catch {
		return [];
	}
}

// 需求进展(老用户旅程:工作中/已完成 + 当前卡点)
function reqProgress(rows: StageRow[]): { done: boolean; current: string } {
	const order: string[] = [...STAGE_ORDER.map((s) => STAGE_CN[s]), "归档"];
	for (const cn of order) {
		const r = rows.find((x) => x.stage === cn);
		if (!r || r.status !== "完成") return { done: false, current: cn };
	}
	return { done: true, current: "" };
}

// 打回重跑前清掉旧资产,避免复用池堆积重复项。analysis/design 为内联产物,无需清理。
function clearRefs(oldRefs: unknown[]): void {
	for (const r of oldRefs) {
		const { type, id, items } = (r ?? {}) as {
			type?: string;
			id?: number;
			items?: Array<{ id?: number }>;
		};
		if (typeof id !== "number") continue;
		if (type === "scenario") store.deleteScenario(id);
		else if (type === "usecase") store.deleteUseCase(id);
		else if (type === "domain") {
			for (const it of items ?? []) {
				if (typeof it.id === "number") store.deleteFunctionItem(it.id);
			}
			store.deleteFunctionDomain(id);
		} else if (type === "function") {
			store.deleteFunctionItem(id); // 兼容旧版平铺 ref
		}
	}
}

function writeStageAssets(
	wsId: number,
	reqId: number,
	stage: StageName,
	assets: unknown,
	oldRefs: unknown[],
): unknown[] {
	clearRefs(oldRefs);
	const a = (assets ?? {}) as Record<string, unknown[]>;
	const refs: unknown[] = [];
	if (stage === "scenario") {
		for (const s of (a.scenarios ?? []) as Array<{
			title?: string;
			description?: string;
		}>) {
			const sid = store.addScenario(wsId, s.title ?? "", s.description ?? "");
			store.linkRequirementScenario(reqId, sid);
			refs.push({
				type: "scenario",
				id: sid,
				title: s.title,
				description: s.description,
			});
		}
	} else if (stage === "usecase") {
		const scens = store.listScenarios(wsId) as Array<{
			id: number;
			title: string;
		}>;
		for (const u of (a.useCases ?? []) as Array<Record<string, unknown>>) {
			const scen = scens.find((s) => s.title === u.scenarioTitle) ?? null;
			const uid = store.addUseCase(
				wsId,
				scen ? scen.id : null,
				(u.title as string) ?? "",
				{
					precondition: (u.precondition as string) ?? "",
					mainFlow: (u.mainFlow as string) ?? "",
					exceptions: (u.exceptions as string) ?? "",
					postcondition: (u.postcondition as string) ?? "",
				},
			);
			refs.push({
				type: "usecase",
				id: uid,
				title: u.title,
				scenarioTitle: u.scenarioTitle,
				precondition: u.precondition,
				mainFlow: u.mainFlow,
				exceptions: u.exceptions,
				postcondition: u.postcondition,
			});
		}
	} else if (stage === "function") {
		for (const d of (a.domains ?? []) as Array<Record<string, unknown>>) {
			const did = store.addFunctionDomain(
				wsId,
				(d.name as string) ?? "",
				(d.description as string) ?? "",
			);
			const items: unknown[] = [];
			for (const it of (d.items ?? []) as Array<{
				title?: string;
				description?: string;
			}>) {
				const fid = store.addFunctionItem(
					wsId,
					did,
					it.title ?? "",
					it.description ?? "",
				);
				items.push({ id: fid, title: it.title, description: it.description });
			}
			refs.push({
				type: "domain",
				id: did,
				name: d.name,
				description: d.description,
				items,
			});
		}
	} else {
		// analysis / design:内联产物
		refs.push({ type: stage, content: assets });
	}
	return refs;
}

// 归档:确定性汇总所有阶段产物 → out/ 下 markdown 包,不走 LLM。
async function runArchive(
	reqId: number,
	reqRow: { title: string; description: string },
	wsName: string,
): Promise<unknown[]> {
	const rows = store.getStages(reqId) as StageRow[];
	const byStage = (cn: string): unknown[] =>
		parseRefs(rows.find((r) => r.stage === cn));
	const lines: string[] = [
		`# 设计归档 — ${reqRow.title}`,
		"",
		`> 需求描述: ${reqRow.description || "(无)"}`,
		`> 工作区: ${wsName}`,
		`> 归档时间: ${new Date().toISOString()}`,
		"",
		"## 需求分析",
		"```json",
		JSON.stringify(byStage("分析"), null, 2),
		"```",
		"",
		"## 场景",
	];
	for (const s of byStage("场景") as Array<{
		title?: string;
		description?: string;
	}>) {
		lines.push(`### ${s.title ?? ""}`, s.description ?? "", "");
	}
	lines.push("## 用例");
	for (const u of byStage("用例") as Array<Record<string, unknown>>) {
		lines.push(
			`### ${String(u.title ?? "")}`,
			`- 场景: ${String(u.scenarioTitle ?? "")}`,
			`- 前置: ${String(u.precondition ?? "")}`,
			`- 主流程: ${String(u.mainFlow ?? "")}`,
			`- 异常: ${String(u.exceptions ?? "")}`,
			`- 后置: ${String(u.postcondition ?? "")}`,
			"",
		);
	}
	lines.push("## 功能分解");
	for (const d of byStage("功能分解") as Array<{
		name?: string;
		description?: string;
		items?: Array<{ title?: string; description?: string }>;
	}>) {
		lines.push(`### ${d.name ?? ""}`, d.description ?? "");
		for (const it of d.items ?? [])
			lines.push(`- **${it.title ?? ""}**: ${it.description ?? ""}`);
		lines.push("");
	}
	lines.push("## 功能设计");
	const design = byStage("功能设计")[0] as { content?: unknown } | undefined;
	lines.push(
		"```json",
		JSON.stringify(design?.content ?? null, null, 2),
		"```",
		"",
	);
	await mkdir(OUT_DIR, { recursive: true });
	const file = join(OUT_DIR, `design-archive-${reqId}-${Date.now()}.md`);
	await writeFile(file, lines.join("\n"), "utf8");
	return [{ type: "archive", file }];
}

// 生产部署:单进程 serve web/dist(SPA 单路由,非文件路径回 index.html)。
const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".map": "application/json",
};

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
	const distRoot = resolve(WEB_DIST);
	const rel = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
	const fp = resolve(distRoot, rel);
	if (!fp.startsWith(distRoot)) {
		res.writeHead(403);
		res.end("forbidden");
		return;
	}
	try {
		const body = await readFile(fp);
		const ext = fp.slice(fp.lastIndexOf("."));
		res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
		res.end(body);
	} catch {
		if (/\.[a-z0-9]+$/i.test(rel)) {
			res.writeHead(404);
			res.end("not found");
			return;
		}
		try {
			const body = await readFile(join(distRoot, "index.html"));
			res.writeHead(200, { "content-type": MIME[".html"] });
			res.end(body);
		} catch {
			res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			res.end("web/dist 未构建 — 运行: cd web && npm run build");
		}
	}
}

// SSE:阶段 run 事件流(单向推送,无新依赖;替代 ws)。token 级流式待 runStage 仪器化。
const sseClients = new Set<ServerResponse>();
function broadcastRun(ev: Record<string, unknown>) {
	const line = `data: ${JSON.stringify(ev)}\n\n`;
	for (const c of sseClients) {
		try {
			c.write(line);
		} catch {
			sseClients.delete(c);
		}
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

		const json = (code: number, body: unknown): void => {
			res.writeHead(code, { "content-type": "application/json" });
			res.end(JSON.stringify(body));
		};

		const seg = url.pathname.split("/");

		if (url.pathname === "/api/repos" && req.method === "GET") {
			json(200, await listRepos());
			return;
		}

		if (
			seg[1] === "api" &&
			seg[2] === "evidence" &&
			seg.length === 4 &&
			req.method === "GET"
		) {
			json(200, await readEvidence(seg[3]));
			return;
		}

		if (url.pathname === "/api/genes" && req.method === "GET") {
			json(200, await listGenes());
			return;
		}

		if (url.pathname === "/api/workspaces" && req.method === "GET") {
			json(200, store.listWorkspaces());
			return;
		}

		if (url.pathname === "/api/workspaces" && req.method === "POST") {
			const b = (await readJson(req)) as {
				repoPath?: string;
				name?: string;
			} | null;
			if (!b) {
				json(400, { error: "bad json" });
				return;
			}
			const id = store.addWorkspace(b.repoPath ?? "", b.name ?? "");
			json(200, { id });
			return;
		}

		if (url.pathname === "/api/requirements" && req.method === "GET") {
			const ws = Number(url.searchParams.get("workspace") ?? 0);
			const reqs = store.listRequirements(ws) as Array<
				Record<string, unknown> & { id: number }
			>;
			for (const r of reqs) {
				const p = reqProgress(store.getStages(r.id) as StageRow[]);
				r.done = p.done;
				r.current = p.current;
			}
			json(200, reqs);
			return;
		}

		if (url.pathname === "/api/requirements" && req.method === "POST") {
			const b = (await readJson(req)) as {
				workspaceId?: number;
				title?: string;
				description?: string;
			} | null;
			if (!b) {
				json(400, { error: "bad json" });
				return;
			}
			const id = store.addRequirement(
				b.workspaceId ?? 0,
				b.title ?? "",
				b.description ?? "",
			);
			store.setStage(id, "录入", "完成");
			for (const cn of [
				...STAGE_ORDER.map((s) => STAGE_CN[s]),
				"归档",
			] as Stage[]) {
				store.setStage(id, cn, "未开始");
			}
			json(200, { id });
			return;
		}

		const stagesOf = url.pathname.match(/^\/api\/requirements\/(\d+)\/stages$/);
		if (stagesOf && req.method === "GET") {
			json(200, store.getStages(Number(stagesOf[1])));
			return;
		}

		// run:LLM 阶段(带门禁+打回意见注入);archive 为确定性归档。
		const stageRun = url.pathname.match(
			/^\/api\/requirements\/(\d+)\/stage\/(analysis|scenario|usecase|function|design|archive)\/run$/,
		);
		if (stageRun && req.method === "POST") {
			const reqId = Number(stageRun[1]);
			const stage = stageRun[2] as StageName | "archive";
			const requirement = store.getRequirement(reqId) as
				| { workspace_id: number; title: string; description: string }
				| undefined;
			if (!requirement) {
				json(404, { error: "requirement not found" });
				return;
			}
			const rows = store.getStages(reqId) as StageRow[];
			const statusOf = (cn: string): string =>
				rows.find((x) => x.stage === cn)?.status ?? "未开始";

			if (stage === "archive") {
				if (STAGE_ORDER.some((s) => statusOf(STAGE_CN[s]) !== "完成")) {
					json(409, { error: "全部阶段完成后方可归档" });
					return;
				}
				if (statusOf("归档") === "完成") {
					json(409, { error: "已归档" });
					return;
				}
				const wsRow = store.getWorkspace(requirement.workspace_id) as {
					name: string;
				};
				const refs = await runArchive(reqId, requirement, wsRow?.name ?? "");
			store.setStage(reqId, "归档", "完成", refs);
			broadcastRun({ type: "done", requirementId: reqId, stage: "归档" });
				json(200, { ok: true, refs });
				return;
			}

			// 门禁:之前所有阶段必须已完成
			const idx = STAGE_ORDER.indexOf(stage);
			for (const prev of STAGE_ORDER.slice(0, idx)) {
				if (statusOf(STAGE_CN[prev]) !== "完成") {
					json(409, { error: `请先完成「${STAGE_CN[prev]}」阶段` });
					return;
				}
			}
			const cur = rows.find((x) => x.stage === STAGE_CN[stage]);
			const curStatus = cur?.status ?? "未开始";
			if (curStatus !== "未开始" && curStatus !== "打回") {
				json(409, { error: `当前阶段状态为「${curStatus}」,无法运行` });
				return;
			}

			const ws = store.getWorkspace(requirement.workspace_id) as
				| { repo_path: string }
				| undefined;
			broadcastRun({ type: "start", requirementId: reqId, stage, requirementTitle: requirement.title });
			const assets = await runStage({
				repoPath: ws?.repo_path ?? ROOT,
				repoId: ws?.repo_path.split("/").pop() ?? "",
				requirementTitle: requirement.title,
				requirementDesc: requirement.description,
				upstream: JSON.stringify(rows),
				stage,
				feedback: cur?.feedback || undefined,
			});
			const refs = writeStageAssets(
				requirement.workspace_id,
				reqId,
				stage,
				assets,
				parseRefs(cur),
			);
			store.setStage(reqId, STAGE_CN[stage], "待审", refs);
			broadcastRun({ type: "done", requirementId: reqId, stage: STAGE_CN[stage] });
			json(200, { ok: true, refs });
			return;
		}

		const stageAct = url.pathname.match(
			/^\/api\/requirements\/(\d+)\/stage\/(analysis|scenario|usecase|function|design)\/(approve|reject)$/,
		);
		if (stageAct && req.method === "POST") {
			const rid = Number(stageAct[1]);
			const cn = STAGE_CN[stageAct[2] as StageName];
			const action = stageAct[3];
			const cur = (store.getStages(rid) as StageRow[]).find(
				(x) => x.stage === cn,
			);
			if ((cur?.status ?? "未开始") !== "待审") {
				json(409, {
					error: `「${cn}」当前不可审批(状态:${cur?.status ?? "未开始"})`,
				});
				return;
			}
			const refs = parseRefs(cur);
			if (action === "approve") {
				store.setStage(rid, cn, "完成", refs);
				json(200, { ok: true });
			} else {
				const b = (await readJson(req)) as { feedback?: string } | null;
				const fb = b?.feedback?.trim() ?? "";
				if (!fb) {
					json(400, { error: "打回必须填写修改意见" });
					return;
				}
				store.setStage(rid, cn, "打回", refs, fb);
				json(200, { ok: true });
			}
			return;
		}

		if (url.pathname === "/api/overview" && req.method === "GET") {
			json(200, store.counts());
			return;
		}

		if (url.pathname === "/api/assets" && req.method === "GET") {
			// ponytail: N+1 per scenario(listUseCases 按 scenarioId);workspace 小可接受,大时加 store.listUseCasesByWorkspace
			const ws = Number(url.searchParams.get("workspace") ?? 0);
			const scenarios = store.listScenarios(ws) as Array<Record<string, unknown>>;
			const usecases: Array<Record<string, unknown>> = [];
			for (const s of scenarios) {
				const sid = s.id as number;
				for (const u of store.listUseCases(sid) as Array<Record<string, unknown>>) {
					usecases.push({ ...u, scenarioTitle: s.title });
				}
			}
			const domains = store.listFunctionDomains(ws) as Array<Record<string, unknown>>;
			const functions = domains.map((d) => ({
				domain: d,
				items: store.listFunctionItems(d.id as number),
			}));
			json(200, { scenarios, usecases, functions });
			return;
		}

		if (url.pathname === "/api/decisions" && req.method === "GET") {
			const ws = Number(url.searchParams.get("workspace") ?? 0);
			// ponytail: N+1 per requirement(getStages);workspace 小可接受
			const cnToEn: Record<string, StageName> = {};
			for (const en of STAGE_ORDER) cnToEn[STAGE_CN[en]] = en;
			const out: Array<Record<string, unknown>> = [];
			for (const r of store.listRequirements(ws) as Array<Record<string, unknown> & { id: number }>) {
				const rows = store.getStages(r.id) as StageRow[];
				for (const row of rows) {
					if (row.status === "待审" || row.status === "打回") {
						out.push({
							requirementId: r.id,
							requirementTitle: r.title,
							stage: row.stage,
							stageEn: cnToEn[row.stage],
							status: row.status,
							feedback: row.feedback,
							refs: parseRefs(row),
							updated_at: row.updated_at,
						});
					}
				}
			}
			out.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
			json(200, out);
			return;
		}

		if (url.pathname === "/api/runs/stream" && req.method === "GET") {
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			sseClients.add(res);
			res.write(": connected\n\n");
			req.on("close", () => sseClients.delete(res));
			return;
		}

		if (url.pathname === "/api/chat/intake" && req.method === "POST") {
			const b = (await readJson(req)) as { messages?: Array<{ role: string; content: string }> } | null;
			if (!b?.messages?.length) {
				json(400, { error: "messages required" });
				return;
			}
			try {
				const reply = await chatIntake(b.messages as Array<{ role: "user" | "assistant"; content: string }>);
				json(200, { reply });
			} catch (e) {
				json(500, { error: String((e as Error)?.message ?? e) });
			}
			return;
		}

	// 非 API GET → web/dist(SPA);生产部署唯一入口
		if (req.method === "GET") {
			await serveStatic(res, url.pathname);
			return;
		}

		json(404, { error: "not found" });
	},
);

server.listen(PORT, () => {
	console.log(`[baize-gateway] http://127.0.0.1:${PORT} (UI + 阶段流水线 API)`);
});
