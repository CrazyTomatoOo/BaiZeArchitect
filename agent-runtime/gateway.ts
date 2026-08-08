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
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { openStore, RunInProgressError, type ArtifactKind, type Stage } from "./store.js";
import type { StageName } from "./cli.js";
import { generateEvidence } from "./evidence.js";

// 必须在 import cli.ts 前设,否则 cli.ts 的 main 会跑(import 即执行)。
process.env.BAIZE_GATEWAY = "1";
const {
	runStage,
	chatIntake,
	writeModelConfig,
	currentModelConfig,
	applyModelConfig,
	openPersistentSession,
} = await import("./cli.js");

const ROOT =
	process.env.BAIZE_PROJECT_ROOT ??
	join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.BAIZE_PORT ?? 18789);
const REPOS_ROOT = process.env.BAIZE_REPOS_ROOT ?? ROOT;
const OUT_DIR = process.env.BAIZE_OUT_DIR ?? join(ROOT, "out");
const EVIDENCE_DIR = process.env.BAIZE_EVIDENCE_DIR ?? join(ROOT, "evidence");
const DB_PATH = process.env.BAIZE_DB_PATH ?? join(ROOT, ".baize", "baize.db");
const SESSION_DIR = process.env.BAIZE_SESSION_DIR ?? join(ROOT, ".baize", "sessions");
// 生产部署:单进程服务 web/dist(SPA);dev 用 vite(:5173)代理 /api。
const WEB_DIST = process.env.BAIZE_WEB_DIST ?? join(ROOT, "web", "dist");
const C4_GENERATION = "heuristic-draft-v2";

// —— 数据层接线(spec §2):证据快照 + 设计包落库 ——
function gitHeadSha(repoPath: string): Promise<string> {
	return new Promise((res) => {
		execFile("git", ["-C", repoPath, "rev-parse", "HEAD"], (err, out) =>
			res(err ? "" : out.trim()),
		);
	});
}

async function readEvidenceArchitecture(
	repoId: string,
): Promise<Record<string, unknown> | null> {
	try {
		const raw = await readFile(join(EVIDENCE_DIR, `${repoId}.json`), "utf8");
		const j = JSON.parse(raw) as { architecture?: Record<string, unknown> };
		return j.architecture ?? null;
	} catch {
		return null;
	}
}

async function latestDesignPackage(
	repoId: string,
): Promise<{ title: string; content: string } | null> {
	try {
		const files = (await readdir(OUT_DIR))
			.filter(
				(f) => f.startsWith(`design-package-${repoId}-`) && f.endsWith(".md"),
			)
			.sort();
		if (!files.length) return null;
		const content = await readFile(join(OUT_DIR, files[files.length - 1]), "utf8");
		const m = content.match(/^#\s+(.+)$/m);
		return { title: m?.[1] ?? repoId, content };
	} catch {
		return null;
	}
}
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
	// 列出已有证据的仓库(evidence/<repoId>.json)—— 这是真实"可见"的仓库,
	// 不扫描仓库目录；只暴露本次容器会话已经生成的证据快照。
	try {
		const files = await readdir(EVIDENCE_DIR);
		return files
			.filter((f) => f.endsWith(".json") && !f.endsWith(".c4.json"))
			.map((f) => f.slice(0, -".json".length));
	} catch {
		return [];
	}
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

async function gitnexusStatus(): Promise<{ available: boolean; version?: string }> {
	return new Promise((resolve) => {
		execFile("gitnexus", ["--version"], { timeout: 10000 }, (err, stdout) => {
			if (err) resolve({ available: false });
			else resolve({ available: true, version: stdout.trim() });
		});
	});
}

async function systemStatus(): Promise<Record<string, unknown>> {
	const [workspaces, evidenceRepositories, genes, gitnexus] = await Promise.all([
		Promise.resolve(store.listWorkspaces() as Array<{ id: number; name?: string }>),
		listRepos(),
		listGenes(),
		gitnexusStatus(),
	]);
	const config = currentModelConfig();
	return {
		ok: true,
		checkedAt: new Date().toISOString(),
		server: { sseClients: sseClients.size },
		model: { provider: config.provider, modelId: config.modelId, hasKey: Boolean(config.apiKey) },
		workspaces: workspaces.map((w) => ({ id: w.id, name: w.name ?? "" })),
		evidenceRepositories,
		geneCount: genes.length,
		gitnexus,
	};
}

function geneIdOf(gene: Record<string, unknown>): string {
	return String(gene.id ?? gene.gene_id ?? gene.name ?? "");
}

function geneTokens(text: string): Set<string> {
	return new Set(text.toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9_][a-z0-9_-]{1,}/g) ?? []);
}

function recommendGeneIds(requirement: Record<string, unknown>, genes: Array<Record<string, unknown>>): string[] {
	const query = geneTokens(`${String(requirement.title ?? "")} ${String(requirement.description ?? "")}`);
	return genes
		.map((gene) => {
			const id = geneIdOf(gene);
			const text = geneTokens(JSON.stringify(gene));
			const score = [...query].filter((token) => text.has(token)).length;
			return { id, score };
		})
		.filter((x) => x.id && x.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 3)
		.map((x) => x.id);
}

async function geneContextForRequirement(reqId: number, requirement: Record<string, unknown>, autoRecommend: boolean): Promise<string> {
	const genes = await listGenes();
	let refs = store.listRequirementGenes(reqId) as Array<{ gene_id: string; source: string }>;
	if (autoRecommend && refs.length === 0) {
		for (const geneId of recommendGeneIds(requirement, genes)) store.addRequirementGene(reqId, geneId, "auto");
		refs = store.listRequirementGenes(reqId) as Array<{ gene_id: string; source: string }>;
	}
	if (!refs.length) return "";
	const byId = new Map(genes.map((gene) => [geneIdOf(gene), gene]));
	return JSON.stringify(refs.map((ref) => ({ id: ref.gene_id, source: ref.source, gene: byId.get(ref.gene_id) ?? null })), null, 2);
}

	interface DirectoryNode {
		name: string;
		path: string;
		kind: "directory" | "file";
		children?: DirectoryNode[];
	}

	const TREE_IGNORES = new Set([".git", ".gitnexus", "node_modules", "dist", "build", "coverage", ".baize", "out", "evolver-home"]);

	async function repoPathForId(repoId: string): Promise<string | null> {
		const rows = store.listWorkspaces() as Array<{ repo_path?: string; name?: string }>;
		const row = rows.find((w) => {
			const pathName = w.repo_path?.split("/").filter(Boolean).pop();
			return pathName === repoId || w.name === repoId;
		});
		if (row?.repo_path) return row.repo_path;
		const root = resolve(REPOS_ROOT);
		const fallback = resolve(root, repoId);
		return fallback === root || !fallback.startsWith(`${root}/`) ? null : fallback;
	}

	async function readTextIfExists(file: string): Promise<string | null> {
		try {
			return await readFile(file, "utf8");
		} catch {
			return null;
		}
	}

	async function readJsonIfExists(file: string): Promise<Record<string, unknown> | null> {
		const raw = await readTextIfExists(file);
		if (!raw) return null;
		try {
			return JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return null;
		}
	}

	async function buildDirectoryTree(repoPath: string, relative = "", depth = 0): Promise<DirectoryNode[]> {
		if (depth > 5) return [];
		try {
			const absolute = resolve(repoPath, relative);
			const entries = await readdir(absolute, { withFileTypes: true });
			const visible = entries
				.filter((entry) => !TREE_IGNORES.has(entry.name) && entry.name !== ".DS_Store")
				.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
				.slice(0, 300);
			const nodes: DirectoryNode[] = [];
			for (const entry of visible) {
				const path = relative ? `${relative}/${entry.name}` : entry.name;
				if (entry.isDirectory()) {
					nodes.push({ name: entry.name, path, kind: "directory", children: await buildDirectoryTree(repoPath, path, depth + 1) });
				} else {
					nodes.push({ name: entry.name, path, kind: "file" });
				}
			}
			return nodes;
		} catch {
			return [];
		}
	}

	async function readC4Cache(repoId: string): Promise<Record<string, unknown> | null> {
		return readJsonIfExists(join(EVIDENCE_DIR, `${repoId}.c4.json`));
	}

	async function generateC4(repoId: string, repoPath: string): Promise<Record<string, unknown>> {
		const headSha = (await gitHeadSha(repoPath)) || "untracked";
		const cached = await readC4Cache(repoId);
		if (
			cached &&
			cached.head_sha === headSha &&
			cached.generation === C4_GENERATION
		)
			return { ...cached, cached: true };

		const architecture = (await readEvidenceArchitecture(repoId)) ?? {};
		const rootPackage = await readJsonIfExists(join(repoPath, "package.json"));
		const packageDirs = ["", "agent-runtime", "web"];
		const containers: Array<Record<string, unknown>> = [];
		for (const dir of packageDirs) {
			const pkg = await readJsonIfExists(join(repoPath, dir, "package.json"));
			if (!pkg) continue;
			const name = String(pkg.name ?? (dir ? `${repoId}/${dir}` : repoId));
			containers.push({
				id: dir ? dir.replace(/[^a-zA-Z0-9]/g, "-") : "app",
				name,
				description: String(pkg.description ?? (dir ? `${dir} package` : "repository application")),
				technology: "Node.js / TypeScript",
				source: dir ? `${dir}/package.json` : "package.json",
			});
		}
		const composeFiles = ["compose.yaml", "compose.yml", "docker-compose.yml"];
		for (const file of composeFiles) {
			const text = await readTextIfExists(join(repoPath, file));
			if (!text) continue;
			for (const match of text.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)) {
				const name = match[1];
				if (name === "services" || containers.some((c) => c.name === name)) continue;
				containers.push({ id: `compose-${name}`, name, description: `compose service ${name}`, technology: "Docker", source: file });
			}
			break;
		}
		const clusters = Array.isArray((architecture as { clusters?: unknown }).clusters) ? (architecture as { clusters: Array<Record<string, unknown>> }).clusters : [];
		const components = clusters.map((cluster, index) => ({
			id: `component-${index + 1}`,
			name: String(cluster.label ?? `Component ${index + 1}`),
			description: "从代码聚类反推的职责块(draft)",
			containerId: containers[0]?.id ?? "app",
			members: Number(cluster.members ?? 0),
			cohesion: Number(cluster.cohesion ?? 0),
			topNodes: cluster.top_nodes ?? [],
		}));
		const dependencies = Object.keys((rootPackage?.dependencies as Record<string, unknown>) ?? {}).slice(0, 12);
		const payload: Record<string, unknown> = {
			repositoryId: repoId,
			head_sha: headSha,
			generatedAt: new Date().toISOString(),
			generation: C4_GENERATION,
			context: {
				name: String(rootPackage?.name ?? repoId),
				description: String(rootPackage?.description ?? "当前仓库的系统上下文(draft)"),
				externalSystems: dependencies.map((name) => ({ name, kind: "dependency" })),
			},
			containers,
			components,
			code: {
				totalNodes: Number(architecture.total_nodes ?? 0),
				totalEdges: Number(architecture.total_edges ?? 0),
				hotspots: (architecture as { hotspots?: unknown }).hotspots ?? [],
				boundaries: (architecture as { boundaries?: unknown }).boundaries ?? [],
				clusters,
			},
		};
		await mkdir(EVIDENCE_DIR, { recursive: true });
		await writeFile(join(EVIDENCE_DIR, `${repoId}.c4.json`), JSON.stringify(payload, null, 2));
		return payload;
	}

	const store = openStore(DB_PATH);
	store.recoverActiveRuns();

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

function writeDomainArtifactRevision(
	requirementId: number,
	runId: number,
	kind: ArtifactKind,
	title: string,
	content: unknown,
 ): void {
	const artifact =
		store.listArtifacts(requirementId).find((item) => item.kind === kind && item.title === title) ??
		store.createArtifact(requirementId, kind, title);
	const previous = store.listArtifactRevisions(artifact.id).at(-1);
	store.createArtifactRevision(
		artifact.id,
		runId,
		content,
		"pending",
		previous?.id ?? null,
	);
}

function writeStageAssets(
	wsId: number,
	reqId: number,
	stage: StageName,
	assets: unknown,
	oldRefs: unknown[],
	runId: number,
 ): unknown[] {
	return store.transaction(() => {
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
			writeDomainArtifactRevision(reqId, runId, "scenario", s.title ?? "", s);
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
			writeDomainArtifactRevision(reqId, runId, "usecase", (u.title as string) ?? "", u);
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
			writeDomainArtifactRevision(reqId, runId, "function", (d.name as string) ?? "", d);
		}
	} else {
		// analysis / design:内联产物
		refs.push({ type: stage, content: assets });
		writeDomainArtifactRevision(reqId, runId, stage, stage, assets);
	}
	return refs;
});
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

// SSE:阶段 run 事件流(单向推送,无新依赖;替代 ws)。token 级流式已仪器化:runStage 追踪 prevTextLen,从 message_update 发真 delta,经此转发到前端 append 滚动。
interface SseClient {
    res: ServerResponse;
    runId?: number;
}

const sseClients = new Set<SseClient>();
const activeRuns = new Map<number, {
    session: {
        steer(text: string): Promise<void>;
        abort(): Promise<void>;
    };
}>();

function writeSse(client: SseClient, data: Record<string, unknown>, seq?: number): void {
    try {
        if (seq !== undefined) client.res.write(`id: ${seq}\n`);
        client.res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
        sseClients.delete(client);
    }
}

function publishRunEvent(row: {
    run_id: number;
    seq: number;
    type: string;
    payload: unknown;
}): void {
    const payload =
        row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
            ? (row.payload as Record<string, unknown>)
            : { payload: row.payload };
    const data = { ...payload, type: row.type, runId: row.run_id, seq: row.seq };
    for (const client of sseClients) {
        if (client.runId === undefined || client.runId === row.run_id) {
            writeSse(client, data, row.seq);
        }
    }
}

function emitRunEvent(runId: number, event: Record<string, unknown>): void {
    publishRunEvent(store.appendRunEvent(runId, String(event.type ?? "event"), event));
}

function emitLatestRunEvent(runId: number): void {
    const event = store.listRunEvents(runId).at(-1);
    if (event) publishRunEvent(event);
}

function broadcastRun(event: Record<string, unknown>): void {
    for (const client of sseClients) {
        if (client.runId === undefined) writeSse(client, event);
    }
}

type StageRunTask = {
    runId: number;
    requirementId: number;
    workspaceId: number;
    stage: StageName;
    repoPath: string;
    repoId: string;
    requirementTitle: string;
    requirementDesc: string;
    upstream: string;
    feedback?: string;
    geneContext?: string;
    previousStatus: string;
    previousRefs: unknown[];
    evidenceArchitecture?: unknown;
    evidenceHeadSha?: string;
    sessionManager: ReturnType<typeof openPersistentSession>["manager"];
};

async function executeStageRun(task: StageRunTask): Promise<void> {
    try {
        store.setRunStatus(task.runId, "running");
        emitLatestRunEvent(task.runId);
        if (store.getRun(task.runId)?.status === "cancelled") return;
        if (task.evidenceArchitecture !== undefined && task.evidenceHeadSha !== undefined) {
            store.captureEvidenceSnapshot(
                task.requirementId,
                task.evidenceArchitecture,
                task.evidenceHeadSha,
                task.runId,
            );
        }
        const assets = await runStage(
            {
                repoPath: task.repoPath,
                repoId: task.repoId,
                requirementTitle: task.requirementTitle,
                requirementDesc: task.requirementDesc,
                upstream: task.upstream,
                stage: task.stage,
                feedback: task.feedback,
                geneContext: task.geneContext,
                sessionManager: task.sessionManager,
                onSession: (session) => {
                    activeRuns.set(task.runId, { session });
                    if (store.getRun(task.runId)?.status === "cancelled") {
                        void session.abort().catch(() => undefined);
                    }
                },
            },
            (event) =>
                emitRunEvent(task.runId, {
                    ...event,
                    requirementId: task.requirementId,
                    stage: STAGE_CN[task.stage],
                }),
        );
        if (store.getRun(task.runId)?.status === "cancelled") return;

        const refs = writeStageAssets(
            task.workspaceId,
            task.requirementId,
            task.stage,
            assets,
            task.previousRefs,
            task.runId,
        );
        store.setStage(task.requirementId, STAGE_CN[task.stage], "待审", refs);
        store.setRunStatus(task.runId, "completed");
        emitLatestRunEvent(task.runId);
        emitRunEvent(task.runId, {
            type: "done",
            requirementId: task.requirementId,
            stage: STAGE_CN[task.stage],
        });
    } catch (error) {
        if (store.getRun(task.runId)?.status === "cancelled") return;
        const message = String((error as Error)?.message ?? error);
        const retryStatus = task.previousStatus === "打回" ? "打回" : "未开始";
        store.setStage(
            task.requirementId,
            STAGE_CN[task.stage],
            retryStatus,
            task.previousRefs,
            task.feedback ?? "",
        );
        store.setRunStatus(task.runId, "failed", message);
        emitLatestRunEvent(task.runId);
        emitRunEvent(task.runId, {
            type: "error",
            requirementId: task.requirementId,
            stage: STAGE_CN[task.stage],
            error: message,
        });
    } finally {
        activeRuns.delete(task.runId);
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

		if (
			seg[1] === "api" &&
			seg[2] === "evidence" &&
			seg[3] === "generate" &&
			req.method === "POST"
		) {
			const b = (await readJson(req)) as { repoPath?: string; repoId?: string } | null;
			const repoPath = b?.repoPath ?? "";
			const repoId = b?.repoId || repoPath.split("/").filter(Boolean).pop() || "repo";
			void generateEvidence(repoPath, repoId);
			json(202, { ok: true, repoId });
			return;
		}

		const architectureRoute = url.pathname.match(/^\/api\/architecture\/([^/]+)\/(tree|c4)(?:\/generate)?$/);
		if (architectureRoute) {
			const repoId = decodeURIComponent(architectureRoute[1]);
			const kind = architectureRoute[2];
			const repoPath = await repoPathForId(repoId);
			if (!repoPath) {
				json(404, { error: `repository not found: ${repoId}` });
				return;
			}
			if (kind === "tree" && req.method === "GET") {
				json(200, { repositoryId: repoId, tree: await buildDirectoryTree(repoPath) });
				return;
			}
			if (kind === "c4" && req.method === "GET") {
				const cached = await readC4Cache(repoId);
				json(200, cached?.generation === C4_GENERATION ? cached : null);
				return;
			}
			if (kind === "c4" && req.method === "POST") {
				json(200, await generateC4(repoId, repoPath));
				return;
			}
			json(405, { error: "method not allowed" });
			return;
		}

		if (url.pathname === "/api/genes" && req.method === "GET") {
			json(200, await listGenes());
			return;
		}

		if (url.pathname === "/api/system/status" && req.method === "GET") {
			json(200, await systemStatus());
			return;
		}

		if (url.pathname === "/api/system/reindex" && req.method === "POST") {
			const body = await readJson(req);
			const workspaceId = Number(body?.workspaceId ?? url.searchParams.get("workspace") ?? 0);
			if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
				json(400, { error: "workspaceId required" });
				return;
			}
			const workspace = store.getWorkspace(workspaceId) as { repo_path?: string; name?: string } | undefined;
			if (!workspace?.repo_path) {
				json(404, { error: "workspace not found" });
				return;
			}
			const repoId = workspace.repo_path.split("/").filter(Boolean).pop() || workspace.name || `workspace-${workspaceId}`;
			void generateEvidence(workspace.repo_path, repoId);
			json(202, { ok: true, status: "started", repoId });
			return;
		}

		if (url.pathname === "/api/workspaces" && req.method === "GET") {
			json(200, store.listWorkspaces());
			return;
		}

		if (url.pathname === "/api/config" && req.method === "GET") {
			const c = currentModelConfig();
			json(200, { provider: c.provider, modelId: c.modelId, hasKey: !!c.apiKey });
			return;
		}
		if (url.pathname === "/api/config" && req.method === "PUT") {
			const b = (await readJson(req)) as { provider?: string; modelId?: string; apiKey?: string } | null;
			if (!b) {
				json(400, { error: "bad json" });
				return;
			}
			const cur = currentModelConfig();
			const cfg = {
				provider: b.provider || cur.provider,
				modelId: b.modelId || cur.modelId,
				apiKey: b.apiKey || cur.apiKey,
			};
			writeModelConfig(cfg);
			applyModelConfig(cfg);
			json(200, { ok: true });
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
			// 自动化:创建工作区时后台索引产证据(GitNexus)
			void generateEvidence(
				b.repoPath ?? "",
				(b.repoPath ?? "").split("/").filter(Boolean).pop() || (b.name ?? "repo"),
			);
			json(200, { id });
			return;
		}

		const wsAct = url.pathname.match(/^\/api\/workspaces\/(\d+)$/);
		if (wsAct && (req.method === "PUT" || req.method === "DELETE")) {
			const id = Number(wsAct[1]);
			if (req.method === "PUT") {
				const b = (await readJson(req)) as { name?: string } | null;
				if (!b?.name?.trim()) {
					json(400, { error: "name required" });
					return;
				}
				store.renameWorkspace(id, b.name.trim());
				json(200, { ok: true });
			} else {
				store.deleteWorkspace(id);
				json(200, { ok: true });
			}
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
				// 设计包落库(spec §2.2/2.3):归档时把本需求设计包存入资产库,闭环喂下次 prior
				const archWs = store.getWorkspace(requirement.workspace_id) as
					| { repo_path?: string }
					| undefined;
				const pkgRepoId = archWs?.repo_path?.split("/").pop() ?? "";
				const pkg = await latestDesignPackage(pkgRepoId);
				if (pkg)
					store.saveDesignPackage(
						reqId,
						requirement.workspace_id,
						pkg.title,
						pkg.content,
						"",
					);
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
			// 证据快照(spec §2.1):analysis 首阶段固化设计时架构事实,审核看 AI 当时看到的
			let evidenceArchitecture: unknown;
			let evidenceHeadSha: string | undefined;
			if (stage === "analysis") {
				const repoId = ws?.repo_path.split("/").pop() ?? "";
				const arch = await readEvidenceArchitecture(repoId);
				if (arch) {
					evidenceArchitecture = arch;
					evidenceHeadSha = await gitHeadSha(ws?.repo_path ?? ROOT);
				}
			}
			const archivedPrior = stage === "analysis"
				? (store.listDesignPackages(requirement.workspace_id) as Array<{ title?: string; content?: string }>)
					.slice(-5)
					.map((pkg) => `### ${pkg.title ?? "历史设计"}\n${pkg.content ?? ""}`)
					.join("\n\n")
				: "";
			const geneContext = await geneContextForRequirement(reqId, requirement as unknown as Record<string, unknown>, stage === "analysis");
            const existingSession = store.getDesignSession(reqId);
            let persistentSession: ReturnType<typeof openPersistentSession>;
            try {
                persistentSession = openPersistentSession(
                    ws?.repo_path ?? ROOT,
                    SESSION_DIR,
                    existingSession?.session_file,
                );
            } catch (error) {
                json(500, { error: `无法打开设计会话: ${String((error as Error)?.message ?? error)}` });
                return;
            }
            const designSession = store.createDesignSession(
                reqId,
                persistentSession.sessionFile,
                persistentSession.sessionId,
            );
            let run: ReturnType<typeof store.createRun>;
            try {
                run = store.createRun(
                    reqId,
                    designSession.id,
                    "stage",
                    STAGE_CN[stage],
                    JSON.stringify({ stage, requirementId: reqId }),
                );
            } catch (error) {
                if (error instanceof RunInProgressError) {
                    json(409, { error: "需求已有进行中的 Run", runId: error.runId });
                    return;
                }
                json(500, { error: String((error as Error)?.message ?? error) });
                return;
            }
            const queuedEvent = store.listRunEvents(run.id).at(-1);
            if (queuedEvent) publishRunEvent(queuedEvent);
            store.setStage(reqId, STAGE_CN[stage], "进行中", parseRefs(cur), cur?.feedback ?? "");
            emitRunEvent(run.id, {
                type: "start",
                requirementId: reqId,
                stage: STAGE_CN[stage],
                requirementTitle: requirement.title,
            });
            void executeStageRun({
                runId: run.id,
                requirementId: reqId,
                workspaceId: requirement.workspace_id,
                stage,
                repoPath: ws?.repo_path ?? ROOT,
                repoId: ws?.repo_path?.split("/").pop() ?? "",
                requirementTitle: requirement.title,
                requirementDesc: requirement.description,
                upstream: JSON.stringify({ stages: rows, archivedDecisions: archivedPrior || "(无已归档决策)" }),
                feedback: cur?.feedback || undefined,
                geneContext,
                previousStatus: curStatus,
                previousRefs: parseRefs(cur),
                evidenceArchitecture,
                evidenceHeadSha,
                sessionManager: persistentSession.manager,
            });
            json(202, {
                runId: run.id,
                status: "queued",
                sessionId: persistentSession.sessionId,
            });
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

		// —— 数据层读端点(spec §2)——
		const evSnap = url.pathname.match(
			/^\/api\/requirements\/(\d+)\/evidence-snapshot$/,
		);
		if (evSnap && req.method === "GET") {
			const snap = store.getEvidenceSnapshot(Number(evSnap[1])) as
				| { architecture?: string; head_sha?: string; captured_at?: string }
				| null;
			if (!snap) { json(200, null); return; }
			json(200, {
				...snap,
				architecture: snap.architecture ? JSON.parse(snap.architecture) : null,
			});
			return;
		}
		const dPkg = url.pathname.match(
			/^\/api\/requirements\/(\d+)\/design-package$/,
		);
		if (dPkg && req.method === "GET") {
			json(200, store.getDesignPackageByReq(Number(dPkg[1])) ?? null);
			return;
		}
		const rGenes = url.pathname.match(/^\/api\/requirements\/(\d+)\/genes$/);
		if (rGenes) {
			const rid = Number(rGenes[1]);
			if (req.method === "GET") {
				json(200, store.listRequirementGenes(rid));
				return;
			}
			if (req.method === "POST") {
				const b = (await readJson(req)) as {
					geneId?: string;
					source?: string;
				} | null;
				if (!b?.geneId) {
					json(400, { error: "geneId required" });
					return;
				}
				store.addRequirementGene(rid, b.geneId, b.source ?? "manual");
				json(200, { ok: true });
				return;
			}
			if (req.method === "DELETE") {
				const b = (await readJson(req)) as { geneId?: string } | null;
				if (!b?.geneId) {
					json(400, { error: "geneId required" });
					return;
				}
				store.removeRequirementGene(rid, b.geneId);
				json(200, { ok: true });
				return;
			}
		}
		if (url.pathname === "/api/sedimentation" && req.method === "GET") {
			const ws = Number(url.searchParams.get("workspace") ?? 0);
			json(200, { packages: store.listDesignPackages(ws) });
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

const runEventsRoute = url.pathname.match(/^\/api\/runs\/(\d+)\/events$/);
        if (runEventsRoute && req.method === "GET") {
            const runId = Number(runEventsRoute[1]);
            if (!store.getRun(runId)) {
                json(404, { error: "run not found" });
                return;
            }
            const after = Math.max(
                0,
                Number(url.searchParams.get("after") ?? req.headers["last-event-id"] ?? 0),
            );
            json(200, store.listRunEvents(runId, Number.isFinite(after) ? after : 0));
            return;
        }

        const runAction = url.pathname.match(/^\/api\/runs\/(\d+)\/(steer|cancel)$/);
        if (runAction && req.method === "POST") {
            const runId = Number(runAction[1]);
            const action = runAction[2];
            const run = store.getRun(runId);
            if (!run) {
                json(404, { error: "run not found" });
                return;
            }
            if (["completed", "failed", "cancelled"].includes(run.status)) {
                json(409, { error: `Run 已结束: ${run.status}` });
                return;
            }
            if (action === "steer") {
                const body = await readJson(req);
                const text = String(body?.text ?? body?.message ?? "").trim();
                if (!text) {
                    json(400, { error: "text required" });
                    return;
                }
                const active = activeRuns.get(runId);
                if (!active) {
                    json(409, { error: "Run 尚未绑定活动会话" });
                    return;
                }
                try {
                    await active.session.steer(text);
                } catch (error) {
                    json(409, { error: String((error as Error)?.message ?? error) });
                    return;
                }
                emitRunEvent(runId, { type: "steer", text });
                json(202, { ok: true, runId });
                return;
            }
            store.setRunStatus(runId, "cancelled", "Cancelled by user");
            emitLatestRunEvent(runId);
            const active = activeRuns.get(runId);
            if (active) {
                try {
                    await active.session.abort();
                } catch {
                    // 状态已先落库为 cancelled;中止失败不应恢复为 failed。
                }
            }
            emitRunEvent(runId, { type: "cancelled", runId });
            json(202, { ok: true, runId, status: "cancelled" });
            return;
        }

        const runRoute = url.pathname.match(/^\/api\/runs\/(\d+)$/);
        if (runRoute && req.method === "GET") {
            const run = store.getRun(Number(runRoute[1]));
            if (!run) {
                json(404, { error: "run not found" });
                return;
            }
            json(200, run);
            return;
        }

        if (url.pathname === "/api/runs/stream" && req.method === "GET") {
            const runIdValue = url.searchParams.get("runId");
            const runId = runIdValue ? Number(runIdValue) : undefined;
            if (runId !== undefined && (!Number.isInteger(runId) || !store.getRun(runId))) {
                json(404, { error: "run not found" });
                return;
            }
            const headerAfter = req.headers["last-event-id"];
            const after = Number(url.searchParams.get("after") ?? headerAfter ?? 0);
            const client: SseClient = { res, runId };
            res.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-cache",
                connection: "keep-alive",
            });
            res.write(": connected\n\n");
            sseClients.add(client);
            if (runId !== undefined) {
                for (const event of store.listRunEvents(
                    runId,
                    Number.isFinite(after) ? Math.max(0, after) : 0,
                )) {
                    const payload =
                        event.payload &&
                        typeof event.payload === "object" &&
                        !Array.isArray(event.payload)
                            ? (event.payload as Record<string, unknown>)
                            : { payload: event.payload };
                    writeSse(
                        client,
                        { ...payload, type: event.type, runId, seq: event.seq },
                        event.seq,
                    );
                }
            }
            req.on("close", () => sseClients.delete(client));
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
