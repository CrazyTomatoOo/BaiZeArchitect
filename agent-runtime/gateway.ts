/**
 * gateway.ts — BaiZe Web/UI Gateway and the sole long-running process.
 *
 * Requirements own persistent design sessions; each asynchronous Run is
 * persisted in SQLite and executed through the role-driven agent loop.
 */
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { openStore, RunInProgressError, type ArtifactKind } from "./store.js";
import type { AgentRole } from "./agent.js";
import { generateEvidence } from "./evidence.js";
import {
	C4_LAYERS,
	createC4ProjectionSnapshot,
	deriveVisibleGraph,
	type C4NodeKind,
	type C4ProjectionInput,
	type C4ProjectionSnapshot,
} from "./c4-projection.js";

process.env.BAIZE_GATEWAY = "1";
const {
	runAgentTurn,
	chatIntake,
	writeModelConfig,
	currentModelConfig,
	applyModelConfig,
	openPersistentSession,
} = await import("./agent.js");
const ROOT =
	process.env.BAIZE_PROJECT_ROOT ??
	join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.BAIZE_PORT ?? 18789);
const REPOS_ROOT = process.env.BAIZE_REPOS_ROOT ?? ROOT;
const EVIDENCE_DIR = process.env.BAIZE_EVIDENCE_DIR ?? join(ROOT, "evidence");
const DB_PATH = process.env.BAIZE_DB_PATH ?? join(ROOT, ".baize", "baize.db");
const SESSION_DIR = process.env.BAIZE_SESSION_DIR ?? join(ROOT, ".baize", "sessions");
// 生产部署:单进程服务 web/dist(SPA);dev 用 vite(:5173)代理 /api。
const WEB_DIST = process.env.BAIZE_WEB_DIST ?? join(ROOT, "web", "dist");
const C4_PROJECTION_VERSION = "c4-projection-v1";

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

	function c4SnapshotDirectory(repoId: string): string {
		return join(EVIDENCE_DIR, `${encodeURIComponent(repoId)}.c4-snapshots`);
	}

	async function readC4Snapshot(repoId: string, snapshotId: string): Promise<C4ProjectionSnapshot | null> {
		const snapshot = await readJsonIfExists(join(c4SnapshotDirectory(repoId), `${snapshotId}.json`));
		return snapshot?.id === snapshotId ? (snapshot as unknown as C4ProjectionSnapshot) : null;
	}

	function snapshotMetadata(snapshot: C4ProjectionSnapshot): Omit<C4ProjectionSnapshot, "nodes" | "edges"> & { nodeCount: number; edgeCount: number } {
		const { nodes, edges, ...metadata } = snapshot;
		return { ...metadata, nodeCount: nodes.length, edgeCount: edges.length };
	}

	async function buildC4ProjectionInput(repoId: string, repoPath: string): Promise<C4ProjectionInput> {
		const headSha = (await gitHeadSha(repoPath)) || "untracked";
		const architecture = (await readEvidenceArchitecture(repoId)) ?? {};
		const rootPackage = await readJsonIfExists(join(repoPath, "package.json"));
		const packageDirs = ["", "agent-runtime", "web"];
		const containers: C4ProjectionInput["containers"] = [];
		for (const dir of packageDirs) {
			const pkg = await readJsonIfExists(join(repoPath, dir, "package.json"));
			if (!pkg) continue;
			containers.push({
				id: dir ? dir.replace(/[^a-zA-Z0-9]/g, "-") : "app",
				name: String(pkg.name ?? (dir ? `${repoId}/${dir}` : repoId)),
				description: String(pkg.description ?? (dir ? `${dir} package` : "repository application")),
				technology: "Node.js / TypeScript",
				sourcePath: dir ? `${dir}/package.json` : "package.json",
			});
		}
		const composeFiles = ["compose.yaml", "compose.yml", "docker-compose.yml"];
		for (const file of composeFiles) {
			const text = await readTextIfExists(join(repoPath, file));
			if (!text) continue;
			for (const match of text.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)) {
				const name = match[1];
				if (name === "services" || containers.some((container) => container.name === name)) continue;
				containers.push({ id: `compose-${name}`, name, description: `compose service ${name}`, technology: "Docker", sourcePath: file });
			}
			break;
		}
		const architectureRecord = architecture as { clusters?: unknown; hotspots?: unknown };
		const clusters = Array.isArray(architectureRecord.clusters) ? architectureRecord.clusters as Array<Record<string, unknown>> : [];
		const components = clusters.map((cluster, index) => {
			const topNodes = Array.isArray(cluster.top_nodes) ? cluster.top_nodes.map(String) : [];
			return {
				id: `component-${index + 1}`,
				name: String(cluster.label ?? `Component ${index + 1}`),
				description: "Evidence-backed code community",
				parentId: containers[0]?.id,
				members: topNodes,
			};
		});
		const hotspots = Array.isArray(architectureRecord.hotspots) ? architectureRecord.hotspots as Array<Record<string, unknown>> : [];
		const code = hotspots.map((hotspot, index) => {
			const qualifiedName = String(hotspot.qualified_name ?? hotspot.name ?? `code-${index + 1}`);
			return {
				id: `code-${index + 1}`,
				name: qualifiedName,
				description: `Hotspot with ${Number(hotspot.fan_in ?? 0)} callers`,
				parentId: components[0]?.id,
				sourcePath: qualifiedName.split(":")[0] || "architecture evidence",
			};
		});
		const dependencies = Object.keys((rootPackage?.dependencies as Record<string, unknown>) ?? {}).slice(0, 12);
		const relationships: C4ProjectionInput["relationships"] = [
			...dependencies.flatMap((dependency) => containers[0] ? [{ source: containers[0].id, target: `external:${dependency}`, kind: "externalDependency" as const, evidence: ["package.json"] }] : []),
			...components.flatMap((component) => component.parentId ? [{ source: component.parentId, target: component.id, kind: "contains" as const, evidence: component.members?.length ? component.members : ["architecture evidence"] }] : []),
			...code.flatMap((node) => node.parentId ? [{ source: node.parentId, target: node.id, kind: "contains" as const, evidence: node.sourcePath ? [node.sourcePath] : ["architecture evidence"] }] : []),
		];
		return {
			repositoryId: repoId,
			headSha,
			projectionVersion: C4_PROJECTION_VERSION,
			system: {
				name: String(rootPackage?.name ?? repoId),
				description: String(rootPackage?.description ?? "Repository architecture"),
			},
			externalDependencies: dependencies.map((name) => ({ name, description: "Declared package dependency", evidence: ["package.json"] })),
			containers,
			components,
			code,
			relationships,
		};
	}

	async function resolveC4Snapshot(repoId: string, repoPath: string): Promise<C4ProjectionSnapshot> {
		const snapshot = createC4ProjectionSnapshot(await buildC4ProjectionInput(repoId, repoPath));
		const cached = await readC4Snapshot(repoId, snapshot.id);
		if (cached) return cached;
		await mkdir(c4SnapshotDirectory(repoId), { recursive: true });
		await writeFile(join(c4SnapshotDirectory(repoId), `${snapshot.id}.json`), JSON.stringify(snapshot, null, 2));
		return snapshot;
	}

	const store = openStore(DB_PATH);
	store.recoverActiveRuns();


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

// SSE: Run 事件流(单向推送,无新依赖;替代 ws)。
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


function openRequirementSession(requirementId: number, repoPath: string) {
	const existing = store.getDesignSession(requirementId);
	if (existing?.status === "archived") throw new Error("design session is archived");
	const persistent = openPersistentSession(repoPath, SESSION_DIR, existing?.session_file);
	const designSession = store.createDesignSession(
		requirementId,
		persistent.sessionFile,
		persistent.sessionId,
	);
	return { persistent, designSession };
}

type AgentRunTask = {
	runId: number;
	requirementId: number;
	workspaceId: number;
	repoPath: string;
	repoId: string;
	role: AgentRole;
	prompt: string;
	sessionManager: ReturnType<typeof openPersistentSession>["manager"];
};

async function executeAgentRun(task: AgentRunTask): Promise<void> {
	try {
		store.setRunStatus(task.runId, "running");
		emitLatestRunEvent(task.runId);
		if (store.getRun(task.runId)?.status === "cancelled") return;
		const result = await runAgentTurn(
			{
				repoPath: task.repoPath,
				repoId: task.repoId,
				role: task.role,
				prompt: task.prompt,
				sessionManager: task.sessionManager,
				domainContext: {
					store,
					requirementId: task.requirementId,
					runId: task.runId,
					workspaceId: task.workspaceId,
					repoPath: task.repoPath,
				},
				onSession: (session) => {
					activeRuns.set(task.runId, { session });
					if (store.getRun(task.runId)?.status === "cancelled") {
						void session.abort().catch(() => undefined);
					}
				},
			},
			(event) => emitRunEvent(task.runId, { ...event, requirementId: task.requirementId, role: task.role }),
		);
		if (store.getRun(task.runId)?.status === "cancelled") return;
		emitRunEvent(task.runId, {
			type: "result",
			requirementId: task.requirementId,
			role: task.role,
			text: result.slice(0, 12_000),
		});
		store.setRunStatus(task.runId, "completed");
		emitLatestRunEvent(task.runId);
		emitRunEvent(task.runId, { type: "done", requirementId: task.requirementId, role: task.role });
	} catch (error) {
		if (store.getRun(task.runId)?.status === "cancelled") return;
		const message = String((error as Error)?.message ?? error);
		store.setRunStatus(task.runId, "failed", message);
		emitLatestRunEvent(task.runId);
		emitRunEvent(task.runId, {
			type: "error",
			requirementId: task.requirementId,
			role: task.role,
			error: message,
		});
	} finally {
		activeRuns.delete(task.runId);
	}
	}
function designPackageSnapshot(requirementId: number): Record<string, unknown> {
	const requirement = store.getRequirement(requirementId);
	const artifacts = store.listArtifacts(requirementId).map((artifact) => ({
		artifact,
		revisions: store.listArtifactRevisions(artifact.id),
	}));
	const decisions = store.listDecisions(requirementId).map((decision) => ({
		decision,
		options: store.listDecisionOptions(decision.id),
	}));
	return {
		requirement,
		artifacts,
		decisions,
		findings: store.listFindings(requirementId),
		approvals: store.listApprovals(requirementId),
		evidence: store.getEvidenceSnapshot(requirementId),
		traceLinks: store.listTraceLinks(requirementId),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanImportedAsset(value: Record<string, unknown>): Record<string, unknown> {
	const { id, requirementId, created_at, createdAt, ...rest } = value;
	void id;
	void requirementId;
	void created_at;
	void createdAt;
	return rest;
}

function assetSnapshot(workspaceId: number): Record<string, unknown> {
	const scenarios: unknown[] = [];
	const usecases: unknown[] = [];
	const functions: unknown[] = [];
	for (const requirement of store.listRequirements(workspaceId) as Array<{ id: number }>) {
		for (const artifact of store.listArtifacts(requirement.id)) {
			const revision = store.listArtifactRevisions(artifact.id).at(-1);
			const content = (revision?.content ?? {}) as Record<string, unknown>;
			if (artifact.kind === "scenario") {
				scenarios.push({ ...content, id: artifact.id, requirementId: requirement.id, title: artifact.title });
			} else if (artifact.kind === "usecase") {
				usecases.push({ ...content, id: artifact.id, requirementId: requirement.id, title: artifact.title });
			} else if (artifact.kind === "function") {
				const items = Array.isArray(content.items) ? content.items : [];
				functions.push({
					domain: { ...content, id: artifact.id, requirementId: requirement.id, name: artifact.title },
					items: items.map((item, index) =>
						isRecord(item)
							? { ...item, id: item.id ?? `${artifact.id}:${index}`, artifactId: artifact.id }
							: { id: `${artifact.id}:${index}`, artifactId: artifact.id, title: String(item) },
					),
				});
			}
		}
	}
	return { scenarios, usecases, functions };
}

function createAsset(
	workspaceId: number,
	kind: ArtifactKind,
	title: string,
	content: Record<string, unknown>,
	requirementId?: number,
): ReturnType<typeof store.createArtifact> {
	const requirement = requirementId ? store.getRequirement(requirementId) as { workspace_id?: number } | undefined : undefined;
	if (requirementId && requirement?.workspace_id !== workspaceId) throw new Error("requirement not found in workspace");
	const targetRequirementId = requirementId ?? store.ensureAssetRequirement(workspaceId);
	const runId = store.ensureManualAssetRun(targetRequirementId);
	const artifact = store.createArtifact(targetRequirementId, kind, title);
	store.createArtifactRevision(artifact.id, runId, content, "approved");
	return artifact;
}

function importAssets(workspaceId: number, input: Record<string, unknown>): number {
	let count = 0;
	store.transaction(() => {
		const requirementId = store.ensureAssetRequirement(workspaceId);
		for (const item of Array.isArray(input.scenarios) ? input.scenarios : []) {
			if (!isRecord(item)) continue;
			const content = cleanImportedAsset(item);
			const title = String(item.title ?? "未命名场景").trim();
			createAsset(workspaceId, "scenario", title || "未命名场景", content, requirementId);
			count++;
		}
		for (const item of Array.isArray(input.usecases) ? input.usecases : []) {
			if (!isRecord(item)) continue;
			const content = cleanImportedAsset(item);
			const title = String(item.title ?? "未命名用例").trim();
			createAsset(workspaceId, "usecase", title || "未命名用例", content, requirementId);
			count++;
		}
		for (const item of Array.isArray(input.functions) ? input.functions : []) {
			if (!isRecord(item)) continue;
			const domain = isRecord(item.domain) ? cleanImportedAsset(item.domain) : cleanImportedAsset(item);
			const items = Array.isArray(item.items) ? item.items : [];
			const title = String(item.domain && isRecord(item.domain) ? item.domain.name ?? item.domain.title : item.name ?? item.title ?? "未命名功能域").trim();
			createAsset(workspaceId, "function", title || "未命名功能域", { ...domain, items }, requirementId);
			count++;
		}
	});
	return count;
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

		const treeRoute = url.pathname.match(/^\/api\/architecture\/([^/]+)\/tree$/);
		if (treeRoute) {
			if (req.method !== "GET") {
				json(405, { error: "method not allowed" });
				return;
			}
			const repoId = decodeURIComponent(treeRoute[1]);
			const repoPath = await repoPathForId(repoId);
			if (!repoPath) {
				json(404, { error: `repository not found: ${repoId}` });
				return;
			}
			json(200, { repositoryId: repoId, tree: await buildDirectoryTree(repoPath) });
			return;
		}

		const resolveSnapshotRoute = url.pathname.match(/^\/api\/architecture\/([^/]+)\/c4\/snapshots\/resolve$/);
		if (resolveSnapshotRoute) {
			if (req.method !== "POST") {
				json(405, { error: "method not allowed" });
				return;
			}
			const repoId = decodeURIComponent(resolveSnapshotRoute[1]);
			const repoPath = await repoPathForId(repoId);
			if (!repoPath) {
				json(404, { error: `repository not found: ${repoId}` });
				return;
			}
			json(200, snapshotMetadata(await resolveC4Snapshot(repoId, repoPath)));
			return;
		}

		const snapshotRoute = url.pathname.match(/^\/api\/architecture\/([^/]+)\/c4\/snapshots\/([^/]+)(?:\/(visible))?$/);
		if (snapshotRoute) {
			if (req.method !== "GET") {
				json(405, { error: "method not allowed" });
				return;
			}
			const repoId = decodeURIComponent(snapshotRoute[1]);
			const snapshotId = decodeURIComponent(snapshotRoute[2]);
			const snapshot = await readC4Snapshot(repoId, snapshotId);
			if (!snapshot) {
				json(404, { error: `snapshot not found: ${snapshotId}` });
				return;
			}
			if (snapshotRoute[3] !== "visible") {
				json(200, snapshotMetadata(snapshot));
				return;
			}
			const layer = url.searchParams.get("layer");
			if (!layer || !C4_LAYERS.includes(layer as (typeof C4_LAYERS)[number])) {
				json(400, { error: "a valid C4 layer is required" });
				return;
			}
			const allowedKinds = new Set<C4NodeKind>(["system", "externalSystem", "container", "component", "code", "aggregate"]);
			const kinds = (url.searchParams.get("kinds") ?? "").split(",").filter((kind): kind is C4NodeKind => allowedKinds.has(kind as C4NodeKind));
			const maxNodes = Number(url.searchParams.get("maxNodes"));
			try {
				json(200, deriveVisibleGraph(snapshot, {
					layer: layer as (typeof C4_LAYERS)[number],
					root: url.searchParams.get("root") || undefined,
					query: url.searchParams.get("query") || undefined,
					focus: url.searchParams.get("focus") || undefined,
					kinds: kinds.length ? kinds : undefined,
					maxNodes: Number.isFinite(maxNodes) ? maxNodes : undefined,
				}));
			} catch (error) {
				json(400, { error: error instanceof Error ? error.message : "visible graph request failed" });
			}
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
			const reqs = store.listRequirements(ws) as Array<Record<string, unknown> & { id: number }>;
			for (const requirement of reqs) {
				const session = store.getDesignSession(requirement.id);
				const latestRun = store.listRuns(requirement.id, 1)[0] ?? null;
				requirement.done = session?.status === "archived";
				requirement.current = requirement.done
					? ""
					: latestRun?.kind ?? "未开始";
				requirement.latestRun = latestRun;
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
			if (!b?.workspaceId || !b.title?.trim()) {
				json(400, { error: "workspaceId and title are required" });
				return;
			}
			const id = store.addRequirement(b.workspaceId, b.title.trim(), b.description ?? "");
			json(200, { id });
			return;
		}

		// Generic Agent Run API; role replaces the removed fixed-stage pipeline.
		const agentRunRoute = url.pathname.match(/^\/api\/requirements\/(\d+)\/runs$/);
		if (agentRunRoute && req.method === "GET") {
			const reqId = Number(agentRunRoute[1]);
			if (!store.getRequirement(reqId)) {
				json(404, { error: "requirement not found" });
				return;
			}
			json(200, store.listRuns(reqId));
			return;
		}
		if (agentRunRoute && req.method === "POST") {
			const reqId = Number(agentRunRoute[1]);
			const requirement = store.getRequirement(reqId) as
				| { workspace_id: number; title: string; description: string }
				| undefined;
			if (!requirement) {
				json(404, { error: "requirement not found" });
				return;
			}
			const body = (await readJson(req)) as {
				prompt?: string;
				role?: string;
				parentRunId?: number;
			} | null;
			const prompt = body?.prompt?.trim() ?? "";
			const role = body?.role ?? "orchestrator";
			const roles: AgentRole[] = ["orchestrator", "analyst", "architect", "critic", "reviewer"];
			if (!prompt || !roles.includes(role as AgentRole)) {
				json(400, { error: "prompt and a valid role are required" });
				return;
			}
			const parentRunId = body?.parentRunId;
			const parentRun = parentRunId === undefined ? undefined : store.getRun(parentRunId);
			if (parentRunId !== undefined && !parentRun) {
				json(404, { error: "parent Run not found" });
				return;
			}
			if (parentRun && (parentRun.requirement_id !== reqId || parentRun.status !== "completed")) {
				json(409, { error: "parent Run must be a completed Run for this requirement" });
				return;
			}
			const workspace = store.getWorkspace(requirement.workspace_id) as { repo_path?: string } | undefined;
			const repoPath = workspace?.repo_path ?? ROOT;
			let mainSession: ReturnType<typeof openPersistentSession>["manager"];
			let designSession: ReturnType<typeof store.createDesignSession>;
			try {
				const opened = openRequirementSession(reqId, repoPath);
				mainSession = opened.persistent.manager;
				designSession = opened.designSession;
			} catch (error) {
				json(409, { error: String((error as Error)?.message ?? error) });
				return;
			}
			const critic = role === "critic";
			const executionSession = critic ? openPersistentSession(repoPath, SESSION_DIR) : undefined;
			const sessionManager = executionSession?.manager ?? mainSession;
			const sessionFile = executionSession?.sessionFile ?? designSession.session_file;
			const rolePrompt = critic
				? `${prompt}\n请独立评审当前需求的 Artifact；先用 get_artifact 读取上游产物，再用 record_finding 记录风险。${parentRun ? `父 Run: ${parentRun.id}` : ""}`
				: `${prompt}\n如需历史方案，主动调用 search_prior_designs；所有仓库事实必须来自受限领域工具。`;
			let run: ReturnType<typeof store.createRun>;
			try {
				run = store.createRun(
					reqId,
					designSession.id,
					critic ? "critic" : "main",
					rolePrompt,
					sessionFile,
					parentRun?.id ?? null,
				);
			} catch (error) {
				json(error instanceof RunInProgressError ? 409 : 500, { error: String((error as Error)?.message ?? error) });
				return;
			}
			const queued = store.listRunEvents(run.id).at(-1);
			if (queued) publishRunEvent(queued);
			emitRunEvent(run.id, { type: "start", requirementId: reqId, role, requirementTitle: requirement.title });
			void executeAgentRun({
				runId: run.id,
				requirementId: reqId,
				workspaceId: requirement.workspace_id,
				repoPath,
				repoId: repoPath.split("/").filter(Boolean).pop() ?? "repo",
				role: role as AgentRole,
				prompt: rolePrompt,
				sessionManager,
			});
			json(202, { runId: run.id, status: "queued", role, sessionId: designSession.session_id });
			return;
		}

		const archiveRoute = url.pathname.match(/^\/api\/requirements\/(\d+)\/archive$/);
		if (archiveRoute && req.method === "POST") {
			const requirementId = Number(archiveRoute[1]);
			const requirement = store.getRequirement(requirementId) as
				| { workspace_id: number; title: string }
				| undefined;
			if (!requirement) {
				json(404, { error: "requirement not found" });
				return;
			}
			const session = store.getDesignSession(requirementId);
			if (!session) {
				json(409, { error: "design session has not started" });
				return;
			}
			if (session.status === "archived") {
				json(409, { error: "requirement is already archived" });
				return;
			}
			const activeRun = store.getActiveRun(requirementId);
			if (activeRun) {
				json(409, { error: "complete the active Run before archiving", runId: activeRun.id });
				return;
			}
			const snapshot = designPackageSnapshot(requirementId);
			const lastRun = store.listRuns(requirementId).find((run) => run.status === "completed");
			const packageId = store.transaction(() => {
				const id = store.saveDesignPackage(
					requirementId,
					requirement.workspace_id,
					requirement.title,
					JSON.stringify(snapshot, null, 2),
					"",
					lastRun?.id ?? null,
					snapshot,
					"approved",
				);
				store.archiveDesignSession(requirementId);
				return id;
			});
			json(200, { ok: true, packageId });
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
			let architecture: unknown = null;
			if (snap.architecture) {
				try {
					architecture = JSON.parse(snap.architecture);
				} catch {
					architecture = null;
				}
			}
			json(200, { ...snap, architecture });
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
			const ws = Number(url.searchParams.get("workspace") ?? 0);
			json(200, assetSnapshot(ws));
			return;
		}

		if (url.pathname === "/api/assets/export" && req.method === "GET") {
			const ws = Number(url.searchParams.get("workspace") ?? 0);
			const body = {
				version: 1,
				exportedAt: new Date().toISOString(),
				workspace: ws,
				...assetSnapshot(ws),
			};
			res.writeHead(200, {
				"content-type": "application/json",
				"content-disposition": `attachment; filename=baize-assets-${ws}.json`,
			});
			res.end(JSON.stringify(body, null, 2));
			return;
		}

		if (url.pathname === "/api/assets" && req.method === "POST") {
			const body = (await readJson(req)) as {
				workspaceId?: number;
				requirementId?: number;
				kind?: string;
				title?: string;
				content?: Record<string, unknown>;
			} | null;
			const kind = body?.kind as ArtifactKind | undefined;
			if (!body?.workspaceId || !["scenario", "usecase", "function"].includes(kind ?? "") || !body.title?.trim()) {
				json(400, { error: "workspaceId, kind, and title are required" });
				return;
			}
			try {
				const artifact = createAsset(body.workspaceId, kind as ArtifactKind, body.title.trim(), body.content ?? {}, body.requirementId);
				json(200, { ok: true, artifact });
			} catch (error) {
				json(400, { error: String((error as Error)?.message ?? error) });
			}
			return;
		}

		if (url.pathname === "/api/assets/import" && req.method === "POST") {
			const body = (await readJson(req)) as Record<string, unknown> | null;
			const workspaceId = Number(body?.workspaceId ?? 0);
			const assets = isRecord(body?.assets) ? body.assets : body;
			if (!workspaceId || !assets) {
				json(400, { error: "workspaceId and assets are required" });
				return;
			}
			try {
				const imported = importAssets(workspaceId, assets);
				json(200, { ok: true, imported });
			} catch (error) {
				json(400, { error: String((error as Error)?.message ?? error) });
			}
			return;
		}

		const assetRoute = url.pathname.match(/^\/api\/assets\/(\d+)$/);
		if (assetRoute && req.method === "DELETE") {
			const ok = store.deleteArtifact(Number(assetRoute[1]));
			json(ok ? 200 : 404, ok ? { ok: true } : { error: "asset not found" });
			return;
		}

		if (url.pathname === "/api/decisions" && req.method === "GET") {
			const ws = Number(url.searchParams.get("workspace") ?? 0);
			const out: Array<Record<string, unknown>> = [];
			for (const requirement of store.listRequirements(ws) as Array<Record<string, unknown> & { id: number; title: string }>) {
				for (const decision of store.listDecisions(requirement.id)) {
					if (decision.status !== "open") continue;
					out.push({
						requirementId: requirement.id,
						requirementTitle: requirement.title,
						decision,
						options: store.listDecisionOptions(decision.id),
					});
				}
			}
			out.sort((a, b) => String((b.decision as { created_at?: string }).created_at).localeCompare(String((a.decision as { created_at?: string }).created_at)));
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
		if (url.pathname.startsWith("/api/")) {
			json(404, { error: "not found" });
			return;
		}
		// Non-API GET serves the SPA; Gateway remains the sole runtime entrypoint.
		if (req.method === "GET") {
			await serveStatic(res, url.pathname);
			return;
		}

		json(404, { error: "not found" });
	},
);

server.listen(PORT, () => {
	console.log(`[baize-gateway] http://127.0.0.1:${PORT} (UI + generic Run API)`);
});
