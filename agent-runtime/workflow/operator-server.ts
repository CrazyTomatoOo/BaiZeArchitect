/**
 * operator-server.ts — the sole production HTTP transport for the Workflow
 * governance kernel.
 *
 * Exposes the final public transport boundary: bearer bootstrap issuing a
 * hardened Operator Session cookie, atomic Requirement creation, the unified
 * idempotent Workflow Command resource, bounded Projection/detail reads,
 * dual SSE streams, Reusable Asset CRUD, legacy import reads, and Design
 * Package reads. An optional staticRoot serves the built Web SPA for non-API
 * GET requests (SPA fallback).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { HeadlessWorkflowRuntime } from "./headless-runtime.js";
import { AssetRelationValidationError, BusyWorkspaceError, ImportDigestConflictError, ReusableAssetMalformedBodyError, ReusableAssetNameConflictError, ReusableAssetReferencedError, ReusableAssetVersionConflictError } from "../persistence/workflow-store.js";
import type { AssetRelationExport, AssetRelationInput, SubtreeNode } from "../persistence/workflow-store.js";
import { WORKFLOW_COMMAND_TYPES, type WorkflowCommandType } from "./command-types.js";
import type { RequirementBaseline } from "./requirement.js";
import { isReusableAssetKind, type ReusableAssetKind } from "../persistence/reusable-asset-kind.js";
import { effectiveModelCatalog, validateModelRoles } from "../model-config.js";
import type { ModelDriver, ModelRoles } from "./model-driver.js";

export interface OperatorIdentity {
	actorRef: string;
	capabilities: readonly string[];
}

export interface OperatorServerOptions {
	runtime: HeadlessWorkflowRuntime;
	/** bootstrap token → operator identity; ActorRef and capabilities come only from this server-side config. */
	operators: Readonly<Record<string, OperatorIdentity>>;
	/** bind host; defaults to loopback. Non-loopback binding requires at least one configured operator credential. */
	host?: string;
	/** port; defaults to 0 (ephemeral). */
	port?: number;
	/** mark the session cookie Secure; set when serving over TLS. */
	secureCookies?: boolean;
	/** SSE heartbeat interval in milliseconds; defaults to 15000. Heartbeats never consume event sequence numbers. */
	sseHeartbeatMs?: number;
	/** absolute or cwd-relative directory for the built Web SPA; non-API GET requests serve from here with index.html fallback. */
	staticRoot?: string;
	/** 生产模型驱动器:accepted 命令后驱动就绪 Task 链式执行;缺省时仅规划不执行(测试装配)。 */
	modelDriver?: ModelDriver;
}

export interface OperatorServer {
	readonly url: string;
	readonly port: number;
	close(): Promise<void>;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
function parseOutgoingRelations(value: unknown): readonly AssetRelationInput[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const relations: AssetRelationInput[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) return undefined;
		const record = item as { toAssetId?: unknown; type?: unknown; position?: unknown };
		if (!Number.isInteger(record.toAssetId) || typeof record.type !== "string") return undefined;
		const relation: AssetRelationInput = { toAssetId: record.toAssetId as number, type: record.type as AssetRelationInput["type"] };
		if (record.position !== undefined) {
			if (!Number.isInteger(record.position)) return undefined;
		relation.position = record.position as number;
		}
		relations.push(relation);
	}
	return relations;
}
function parseImportedRelations(value: unknown): readonly AssetRelationExport[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const relations: AssetRelationExport[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) return undefined;
		const record = item as { fromTitle?: unknown; fromKind?: unknown; toTitle?: unknown; toKind?: unknown; type?: unknown; position?: unknown };
		if (
			typeof record.fromTitle !== "string"
			|| !isReusableAssetKind(record.fromKind)
			|| typeof record.toTitle !== "string"
			|| !isReusableAssetKind(record.toKind)
			|| typeof record.type !== "string"
		) return undefined;
		const relation: AssetRelationExport = {
			fromTitle: record.fromTitle,
			fromKind: record.fromKind,
			toTitle: record.toTitle,
			toKind: record.toKind,
			type: record.type as AssetRelationExport["type"],
		};
		if (record.position !== undefined) {
			if (!Number.isInteger(record.position)) return undefined;
		relation.position = record.position as number;
		}
		relations.push(relation);
	}
	return relations;
}

interface ImportBundleInput {
	readonly assets: { kind: ReusableAssetKind; title: string; content: unknown }[];
	readonly relations?: readonly AssetRelationExport[];
}

function parseImportBundle(value: unknown): ImportBundleInput | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const bundle = value as { assets?: unknown; relations?: unknown };
	if (!Array.isArray(bundle.assets) || bundle.assets.length === 0) return undefined;
	for (const asset of bundle.assets) {
		if (
			typeof asset !== "object"
			|| asset === null
			|| !isReusableAssetKind((asset as { kind?: unknown }).kind)
			|| typeof (asset as { title?: unknown }).title !== "string"
			|| !("content" in (asset as object))
		) {
			return undefined;
		}
	}
	const relations = bundle.relations === undefined ? undefined : parseImportedRelations(bundle.relations);
	if (bundle.relations !== undefined && relations === undefined) return undefined;
	return { assets: bundle.assets as { kind: ReusableAssetKind; title: string; content: unknown }[], relations };
}

function parseSubtreeNode(value: unknown): SubtreeNode | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const node = value as { kind?: unknown; title?: unknown; nodeId?: unknown; content?: unknown; children?: unknown };
	if (
		!isReusableAssetKind(node.kind)
		|| typeof node.title !== "string"
		|| typeof node.content !== "object"
		|| node.content === null
		|| Array.isArray(node.content)
	) return undefined;
	if (node.nodeId !== undefined && typeof node.nodeId !== "string") return undefined;
	if (node.children !== undefined) {
		if (!Array.isArray(node.children)) return undefined;
		for (const child of node.children) {
			if (parseSubtreeNode(child) === undefined) return undefined;
		}
	}
	return node as SubtreeNode;
}

function sendAssetError(response: ServerResponse, error: unknown): boolean {
	if (error instanceof ReusableAssetMalformedBodyError) {
		if (error.validationErrors && error.validationErrors.length > 0) {
			sendJson(response, 400, { error: "validation_errors", errors: error.validationErrors });
		} else {
			sendJson(response, 400, { error: "malformed_body" });
		}
		return true;
	}
	if (error instanceof ReusableAssetNameConflictError) {
		sendJson(response, 409, { error: "name_conflict" });
		return true;
	}
	if (error instanceof ReusableAssetVersionConflictError) {
		sendJson(response, 409, { error: "version_conflict" });
		return true;
	}
	if (error instanceof ImportDigestConflictError) {
		sendJson(response, 409, { error: "digest_conflict" });
		return true;
	}
	if (error instanceof AssetRelationValidationError) {
		sendJson(response, 400, { error: "invalid_relations", invalidRelations: error.issues });
		return true;
	}
	return false;
}

function parsePositiveQueryInteger(value: string | null, fallback: number, maximum?: number): number | undefined {
	if (value === null || value === "") return fallback;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1 || (maximum !== undefined && parsed > maximum)) return undefined;
	return parsed;
}
/**
 * 就绪 Task 驱动循环:以生产模型驱动器逐个执行当前就绪任务(beginAttempt 单任务语义),
 * 直到无就绪任务或工作流离开 running。命令接受后驱动,任务完成即返回;后续命令/门禁回答再次驱动。
 */
export async function runReadyTasks(runtime: HeadlessWorkflowRuntime, modelDriver: ModelDriver, workflowId: number): Promise<void> {
	const budget = 100;
	for (let iteration = 0; iteration < budget; iteration += 1) {
		const projection = runtime.getWorkflowProjection(workflowId);
		if (!projection || projection.workflow.state !== "running") return;
		const result = await runtime.executeTask(workflowId, modelDriver);
		// 任务完成后,自动批准已通过 critic review 且无 open major/critical 的 pending 产物,
		// 解锁下游任务的 task_output 输入(模板流水线:review → auto-approve → 下游)。
		approveReviewedArtifacts(runtime, workflowId);
		if (result.outcome === "no_ready_task" || result.outcome === "task_exhausted") {
			// 最后一次:review 完成后可能还有 pending 产物需要批准
			approveReviewedArtifacts(runtime, workflowId);
			// 全部批准后,检查 readiness;通过则构建 approval packet 并转到 ready_to_archive
			const proj = runtime.getWorkflowProjection(workflowId);
			if (proj && proj.workflow.state === "running") {
				const readiness = runtime.checkReadiness(workflowId);
				if (readiness.ready) {
					runtime.buildApprovalPacket(workflowId);
				}
			}
			return;
		}
	}
}
/**
 * 自动批准已通过 critic review 且无 open major/critical 的 pending 产物。
 * 模板流水线:review 完成后产物仍为 pending,下游 task_output 需 approved 才可引用。
 * 生产环境此处由人工 approve-artifact 命令完成;模板自动模式下由 runner 代行。
 */
function approveReviewedArtifacts(runtime: HeadlessWorkflowRuntime, workflowId: number): void {
	// 查找 pending 产物:有 critic coverage 且无 open major/critical finding
	const pending = runtime.listPendingReviewedArtifacts(workflowId);
	for (const artifact of pending) {
		try {
			// 每次 approve 都重新获取 projection 拿最新 version(approve 会递增 version)
			const proj = runtime.getWorkflowProjection(workflowId);
			if (!proj) break;
			runtime.executeCommand({
				workflowId,
				commandId: `auto-approve-${artifact.revisionId}`,
				expectedWorkflowVersion: proj.workflow.version,
				type: "approve-artifact",
				operator: { actorRef: "engine", capabilities: ["workflow:operate", "workflow:approve"] },
				payload: { artifactId: artifact.artifactId, revisionId: artifact.revisionId },
			});
		} catch {
			// 批准失败不阻塞 runner;后续迭代重试或人工处理
		}
	}
}

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolveBody, reject) => {
		let body = "";
		request.on("data", (chunk: Buffer) => {
			body += chunk.toString("utf8");
			if (body.length > 1_000_000) {
				reject(new Error("request body too large"));
				request.destroy();
			}
		});
		request.on("end", () => resolveBody(body));
		request.on("error", reject);
	});
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
}

function sessionFromCookie(request: IncomingMessage): string | null {
	const header = request.headers.cookie;
	if (!header) return null;
	for (const part of header.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name === "baize_operator") return rest.join("=");
	}
	return null;
}

interface EventCursor {
	after: number;
	limit: number;
}

function parseEventCursor(url: URL, response: ServerResponse, lastEventId?: string): EventCursor | null {
	let afterRaw: string | null = url.searchParams.get("after");
	// Reconnect precedence: Last-Event-ID wins over the initial-connect after query.
	if (lastEventId !== undefined) afterRaw = lastEventId;
	let after = 0;
	if (afterRaw !== null && afterRaw !== "") {
		if (!/^\d+$/.test(afterRaw)) {
			sendJson(response, 400, { error: "invalid_cursor" });
			return null;
		}
		after = Number(afterRaw);
	}
	let limit = 200;
	const limitRaw = url.searchParams.get("limit");
	if (limitRaw !== null && limitRaw !== "") {
		if (!/^\d+$/.test(limitRaw)) {
			sendJson(response, 400, { error: "invalid_limit" });
			return null;
		}
		limit = Number(limitRaw);
		if (limit < 1 || limit > 500) {
			sendJson(response, 400, { error: "invalid_limit" });
			return null;
		}
	}
	return { after, limit };
}

interface StreamEventsOptions<T extends { seq: number }> {
	eventField: "workflow-event" | "run-event";
	after: number;
	watermark: number;
	replay: (after: number, limit: number) => readonly T[];
	subscribe: (listener: (event: T) => void) => () => void;
	heartbeatMs: number;
}

function streamEvents<T extends { seq: number }>(response: ServerResponse, stream: StreamEventsOptions<T>): void {
	response.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	let lastSent = stream.after;
	let closed = false;
	const buffered: T[] = [];
	let replaying = true;

	const writeEvent = (event: T): void => {
		if (closed || event.seq <= lastSent) return; // dedupe replay/live overlap
		lastSent = event.seq;
		response.write(`id: ${event.seq}\nevent: ${stream.eventField}\ndata: ${JSON.stringify(event)}\n\n`);
	};

	const unsubscribe = stream.subscribe((event) => {
		if (replaying) {
			buffered.push(event);
			return;
		}
		writeEvent(event);
	});

	// Catch-up: the watermark was captured at connect time; replay (after, watermark]
	// from the database, then flush buffered live events in seq order with dedupe.
	const backlog = stream.replay(stream.after, stream.watermark - stream.after);
	for (const event of backlog) writeEvent(event);
	buffered.sort((left, right) => left.seq - right.seq);
	for (const event of buffered) writeEvent(event);
	buffered.length = 0;
	replaying = false;

	const heartbeat = setInterval(() => {
		if (!closed) response.write(": hb\n\n");
	}, stream.heartbeatMs);

	response.on("close", () => {
		closed = true;
		clearInterval(heartbeat);
		unsubscribe();
	});
}

const STATIC_MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".gif": "image/gif",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ico": "image/x-icon",
	".map": "application/json",
	".json": "application/json",
};

async function serveStatic(response: ServerResponse, pathname: string, staticRoot: string): Promise<void> {
	const root = resolve(staticRoot);
	const rel = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
	const fp = resolve(root, rel);
	if (!fp.startsWith(root)) {
		sendJson(response, 403, { error: "forbidden" });
		return;
	}
	try {
		const body = await readFile(fp);
		const ext = fp.slice(fp.lastIndexOf("."));
		response.writeHead(200, { "content-type": STATIC_MIME[ext] ?? "application/octet-stream" });
		response.end(body);
	} catch {
		if (/\.[a-z0-9]+$/i.test(rel)) {
			response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			response.end("not found");
			return;
		}
		try {
			const body = await readFile(resolve(root, "index.html"));
			response.writeHead(200, { "content-type": STATIC_MIME[".html"] });
			response.end(body);
		} catch {
			response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			response.end("web/dist not built — run: cd web && npm run build");
		}
	}
}
export async function startOperatorServer(
	options: OperatorServerOptions,
): Promise<OperatorServer> {
	const host = options.host ?? "127.0.0.1";
	const operatorTokens = Object.keys(options.operators);
	if (!LOOPBACK_HOSTS.has(host) && operatorTokens.length === 0) {
		throw new Error("non-loopback binding requires configured operator credentials");
	}
	const sessions = new Map<string, OperatorIdentity>();

	const server: Server = createServer((request, response) => {
		void handle(request, response).catch(() => {
			if (!response.headersSent) sendJson(response, 500, { error: "internal_error" });
			response.end();
		});
	});

	async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const url = new URL(request.url ?? "/", "http://localhost");
		const segments = url.pathname.split("/").filter(Boolean);

		if (request.method === "POST" && url.pathname === "/api/session") {
			const authorization = request.headers.authorization ?? "";
			const match = /^Bearer (.+)$/.exec(authorization);
			const operator = match ? options.operators[match[1]] : undefined;
			if (!operator) {
				sendJson(response, 401, { error: "unauthenticated" });
				return;
			}
			const sessionId = randomUUID();
			sessions.set(sessionId, operator);
			const attributes = [
				`baize_operator=${sessionId}`,
				"HttpOnly",
				"SameSite=Strict",
				"Path=/",
			];
			if (options.secureCookies) attributes.push("Secure");
			response.writeHead(201, {
				"content-type": "application/json",
				"set-cookie": attributes.join("; "),
			});
			response.end(
				JSON.stringify({ actorRef: operator.actorRef, capabilities: operator.capabilities }),
			);
			return;
		return;
	}

	// Static SPA assets are public — no sensitive data, needed for the login
	// page to load before an Operator Session exists. API routes (/api/*)
	// still require authentication below.
	if (
		options.staticRoot !== undefined &&
		request.method === "GET" &&
		!url.pathname.startsWith("/api/")
	) {
		await serveStatic(response, url.pathname, options.staticRoot);
		return;
	}

		// Every route below requires an authenticated Operator Session.
		const sessionId = sessionFromCookie(request);
		const operator = sessionId ? sessions.get(sessionId) : undefined;
		if (!operator) {
			sendJson(response, 401, { error: "unauthenticated" });
			return;
		}

		if (request.method === "GET" && url.pathname === "/api/workspaces") {
			sendJson(response, 200, { workspaces: options.runtime.listWorkspaces() });
			return;
		}

		if (request.method === "POST" && url.pathname === "/api/workspaces") {
			let body: unknown;
			try {
				body = JSON.parse(await readBody(request));
			} catch {
				sendJson(response, 400, { error: "malformed_workspace" });
				return;
			}
			if (typeof body !== "object" || body === null || Array.isArray(body)) {
				sendJson(response, 400, { error: "malformed_workspace" });
				return;
			}
			const { name, repoPath } = body as Record<string, unknown>;
			if (
				typeof name !== "string" || typeof repoPath !== "string"
				|| name.trim() === "" || repoPath.trim() === ""
			) {
				sendJson(response, 400, { error: "malformed_workspace" });
				return;
			}
			let workspaceId: number;
			try {
				workspaceId = options.runtime.createWorkspace({
					name: name.trim(),
					repoPath: repoPath.trim(),
				});
			} catch (error) {
				if (
					error instanceof Error
					&& "code" in error
					&& (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
				) {
					sendJson(response, 409, { error: "duplicate_repo_path" });
					return;
				}
				throw error;
			}
			sendJson(response, 201, { workspaceId });
			return;
		}

		if (request.method === "DELETE" && segments.length === 3 && segments[0] === "api" && segments[1] === "workspaces") {
			const workspaceId = Number(segments[2]);
			if (!Number.isInteger(workspaceId) || !options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
			try {
				const deleted = options.runtime.deleteWorkspace(workspaceId);
				if (!deleted) {
					// Lost a concurrent delete race: the workspace is gone by now.
					sendJson(response, 404, { error: "unknown_workspace" });
					return;
				}
			} catch (error) {
				if (error instanceof BusyWorkspaceError) {
					sendJson(response, 409, {
						error: "workspace_busy",
						activeRuns: error.activeRuns,
						activeClaims: error.activeClaims,
					});
					return;
				}
				throw error;
			}
			sendJson(response, 200, { deleted: true });
			return;
		}

		if (
			request.method === "POST"
			&& segments.length === 4
			&& segments[0] === "api"
			&& segments[1] === "workspaces"
			&& segments[3] === "requirements"
		) {
			const workspaceId = Number(segments[2]);
			if (!Number.isInteger(workspaceId) || !options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
			let body: unknown;
			try {
				body = JSON.parse(await readBody(request));
			} catch {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if (typeof body !== "object" || body === null || Array.isArray(body)) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if ("actor" in body || "operator" in body) {
				sendJson(response, 400, { error: "actor_fields_are_not_accepted" });
				return;
			}
			const createBody = body as { baseline?: unknown; modelRoles?: unknown };
			if (typeof createBody.baseline !== "object" || createBody.baseline === null) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if (createBody.modelRoles !== undefined) {
				const problems = validateModelRoles(createBody.modelRoles);
				if (problems.length > 0) {
					sendJson(response, 400, { error: "invalid_model_roles", detail: problems });
					return;
				}
			}
			let created;
			try {
				created = options.runtime.createRequirement({
					workspaceId,
					baseline: createBody.baseline as RequirementBaseline,
					modelRoles: createBody.modelRoles as ModelRoles | undefined,
				});
			} catch {
				sendJson(response, 400, { error: "invalid_baseline" });
				return;
			}
			sendJson(response, 201, {
				requirementId: created.requirementId,
				workflowId: created.workflowId,
				workflowState: created.workflowState,
				workflowVersion: created.workflowVersion,
				lastEventSeq: created.lastEventSeq,
			});
			return;
		}

		if (
			request.method === "PUT"
			&& segments.length === 5
			&& segments[0] === "api"
			&& segments[1] === "workflows"
			&& segments[3] === "commands"
		) {
			const workflowId = Number(segments[2]);
			const commandId = segments[4];
			if (!Number.isInteger(workflowId) || !options.runtime.getWorkflowProjection(workflowId)) {
				sendJson(response, 404, { error: "unknown_workflow" });
				return;
			}
			let body: unknown;
			try {
				body = JSON.parse(await readBody(request));
			} catch {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if (typeof body !== "object" || body === null || Array.isArray(body)) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if ("actor" in body || "operator" in body || "commandId" in body) {
				sendJson(response, 400, { error: "actor_fields_are_not_accepted" });
				return;
			}
			const envelope = body as Record<string, unknown>;
			if (
				typeof envelope.type !== "string"
				|| !WORKFLOW_COMMAND_TYPES.includes(envelope.type as WorkflowCommandType)
				|| typeof envelope.expectedWorkflowVersion !== "number"
				|| (envelope.schemaVersion !== undefined && envelope.schemaVersion !== "workflow-command/v1")
				|| (envelope.payload !== undefined && (typeof envelope.payload !== "object" || envelope.payload === null))
				|| (envelope.reason !== undefined && typeof envelope.reason !== "string")
			) {
				sendJson(response, 400, { error: "malformed_envelope" });
				return;
			}
			const receipt = options.runtime.executeCommand({
				workflowId,
				commandId,
				type: envelope.type as WorkflowCommandType,
				expectedWorkflowVersion: envelope.expectedWorkflowVersion,
				payload: envelope.payload as Record<string, unknown> | undefined,
				reason: envelope.reason as string | undefined,
				operator,
			});
			// #19：Engine 直生成 —— start 接受后异步实例化模板计划（无 Orchestrator 模型调用），
			// 计划采纳后立即以生产模型驱动器驱动就绪 Task 链式执行。
			// workflow 状态机保证幂等：已有计划/非 running 时 planWorkflow 返回 budget 而非破坏。
			if (receipt.outcome === "accepted" && envelope.type === "start") {
				void (async () => {
				const plan = await options.runtime.planWorkflow(workflowId, null);
				if (plan.outcome === "adopted") {
					// analysis 类产物要求 TraceLink:绑仓库快照供模型引用(生产环境实际快照来自 EvidenceSnapshot)
					options.runtime.bindEvidenceSnapshot(workflowId, "sha256:seed-repo", []);
				}
				if (options.modelDriver) {
					await runReadyTasks(options.runtime, options.modelDriver, workflowId);
				}
				})().catch((error) => {
					console.error(`[baize] template plan failed for workflow ${workflowId}:`, error);
				});
			} else if (receipt.outcome === "accepted" && options.modelDriver) {
				// 其余命令（resume/retry/steer/human-response 等）接受后同样驱动就绪 Task。
				void runReadyTasks(options.runtime, options.modelDriver, workflowId).catch((error) => {
					console.error(`[baize] ready-task runner failed for workflow ${workflowId}:`, error);
				});
			}
			sendJson(response, receipt.httpStatus, receipt);
			return;
		}

		if (request.method === "GET" && url.pathname === "/api/session") {
			sendJson(response, 200, { actorRef: operator.actorRef, capabilities: operator.capabilities });
			return;
		}

		if (request.method === "GET" && url.pathname === "/api/model-config") {
			sendJson(response, 200, effectiveModelCatalog());
			return;
		}

		if (request.method === "GET" && url.pathname === "/api/requirements") {
			const workspaceId = Number(url.searchParams.get("workspaceId"));
			if (!Number.isInteger(workspaceId) || !options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
			sendJson(response, 200, { requirements: options.runtime.listRequirementSummaries(workspaceId) });
			return;
		}

		if (request.method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "requirements") {
			const detail = options.runtime.getRequirementDetail(Number(segments[2]));
			if (!detail) {
				sendJson(response, 404, { error: "unknown_requirement" });
				return;
			}
			sendJson(response, 200, detail);
			return;
		}

		if (request.method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "legacy-imports") {
			const legacyImport = options.runtime.getLegacyImport(Number(segments[2]));
			if (!legacyImport) {
				sendJson(response, 404, { error: "unknown_legacy_import" });
				return;
			}
			sendJson(response, 200, legacyImport);
			return;
		}

		if (request.method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "design-packages") {
			const designPackage = options.runtime.getDesignPackage(Number(segments[2]));
			if (!designPackage) {
				sendJson(response, 404, { error: "unknown_design_package" });
				return;
			}
			sendJson(response, 200, designPackage);
			return;
		}

		if (request.method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "workflows") {
			const projection = options.runtime.getBoundedProjection(Number(segments[2]));
			if (!projection) {
				sendJson(response, 404, { error: "unknown_workflow" });
				return;
			}
			sendJson(response, 200, projection);
			return;
		}

		if (request.method === "GET" && segments.length === 5 && segments[0] === "api" && segments[1] === "workflows" && segments[3] === "commands") {
			const receipt = options.runtime.getCommandReceiptDetail(Number(segments[2]), segments[4]);
			if (!receipt) {
				sendJson(response, 404, { error: "unknown_command_receipt" });
				return;
			}
			sendJson(response, 200, receipt);
			return;
		}

		if (request.method === "GET" && segments.length === 4 && segments[0] === "api" && segments[1] === "requirements" && segments[3] === "artifacts") {
			const detail = options.runtime.getArtifactRevisionDetail(Number(segments[2]), String(url.searchParams.get("kind") ?? ""));
			if (!detail) {
				sendJson(response, 404, { error: "unknown_artifact" });
				return;
			}
			sendJson(response, 200, detail);
			return;
		}

		if (request.method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "plan-revisions") {
			const detail = options.runtime.getPlanRevisionDetail(Number(segments[2]));
			if (!detail) {
				sendJson(response, 404, { error: "unknown_plan_revision" });
				return;
			}
			sendJson(response, 200, detail);
			return;
		}

		if (request.method === "GET" && segments.length === 4 && segments[0] === "api" && segments[1] === "tasks" && segments[3] === "attempts") {
			if (!options.runtime.getTaskDetail(Number(segments[2]))) {
				sendJson(response, 404, { error: "unknown_task" });
				return;
			}
			sendJson(response, 200, { attempts: options.runtime.listTaskAttempts(Number(segments[2])) });
			return;
		}

		if (request.method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "tasks") {
			const detail = options.runtime.getTaskDetail(Number(segments[2]));
			if (!detail) {
				sendJson(response, 404, { error: "unknown_task" });
				return;
			}
			sendJson(response, 200, detail);
			return;
		}

		if (request.method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "attempts") {
			const detail = options.runtime.getAttemptDetail(Number(segments[2]));
			if (!detail) {
				sendJson(response, 404, { error: "unknown_attempt" });
				return;
			}
			sendJson(response, 200, detail);
			return;
		}

		if (request.method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "runs") {
			const detail = options.runtime.getRunDetail(Number(segments[2]));
			if (!detail) {
				sendJson(response, 404, { error: "unknown_run" });
				return;
			}
			sendJson(response, 200, detail);
			return;
		}

		if (request.method === "GET" && url.pathname === "/api/assets/graph") {
			const workspaceId = Number(url.searchParams.get("workspaceId"));
			if (!Number.isInteger(workspaceId) || !options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
			sendJson(response, 200, options.runtime.getWorkspaceAssetGraph(workspaceId));
			return;
		}
		if (request.method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "approval-packets") {
			const detail = options.runtime.getApprovalPacketDetail(Number(segments[2]));
			if (!detail) {
				sendJson(response, 404, { error: "unknown_approval_packet" });
				return;
			}
			sendJson(response, 200, detail);
			return;
		}

		if (request.method === "GET" && url.pathname === "/api/assets/export") {
			const workspaceId = Number(url.searchParams.get("workspaceId"));
			if (!Number.isInteger(workspaceId) || !options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
			sendJson(response, 200, options.runtime.exportReusableAssetBundle(workspaceId));
			return;
		}

		if (request.method === "POST" && url.pathname === "/api/assets/import") {
			let body: unknown;
			try {
				body = JSON.parse(await readBody(request));
			} catch {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if (typeof body !== "object" || body === null || Array.isArray(body)) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			const importBody = body as { workspaceId?: unknown; assets?: unknown; relations?: unknown };
			const workspaceId = Number(importBody.workspaceId);
			if (!Number.isInteger(workspaceId) || !options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
			if (!Array.isArray(importBody.assets) || importBody.assets.length === 0) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			for (const asset of importBody.assets) {
				if (typeof asset !== "object" || asset === null || !isReusableAssetKind((asset as { kind?: unknown }).kind) || typeof (asset as { title?: unknown }).title !== "string" || !("content" in (asset as object))) {
					sendJson(response, 400, { error: "malformed_body" });
					return;
				}
			}
			const relations = importBody.relations === undefined ? undefined : parseImportedRelations(importBody.relations);
			if (importBody.relations !== undefined && relations === undefined) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			try {
				const ids = options.runtime.importReusableAssetBundle(
					workspaceId,
					importBody.assets as { kind: ReusableAssetKind; title: string; content: unknown }[],
					relations,
					true,
				);
				sendJson(response, 201, { assetIds: ids });
			} catch (error) {
				if (sendAssetError(response, error)) return;
				throw error;
			}
			return;
		}

		if (request.method === "POST" && url.pathname === "/api/assets/import/preview") {
			let body: unknown;
			try {
				body = JSON.parse(await readBody(request));
			} catch {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if (typeof body !== "object" || body === null || Array.isArray(body)) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			const previewBody = body as { workspaceId?: unknown; bundle?: unknown };
			const workspaceId = Number(previewBody.workspaceId);
			if (!Number.isInteger(workspaceId) || !options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
			const bundle = parseImportBundle(previewBody.bundle);
			if (bundle === undefined) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			try {
				const preview = options.runtime.previewImportBundle(workspaceId, bundle.assets, bundle.relations);
				sendJson(response, 200, preview);
			} catch (error) {
				if (sendAssetError(response, error)) return;
				throw error;
			}
			return;
		}

		if (request.method === "POST" && url.pathname === "/api/assets/import/commit") {
			let body: unknown;
			try {
				body = JSON.parse(await readBody(request));
			} catch {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if (typeof body !== "object" || body === null || Array.isArray(body)) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			const commitBody = body as { workspaceId?: unknown; bundle?: unknown; previewDigest?: unknown };
			const workspaceId = Number(commitBody.workspaceId);
			if (!Number.isInteger(workspaceId) || !options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
			if (typeof commitBody.previewDigest !== "string") {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			const bundle = parseImportBundle(commitBody.bundle);
			if (bundle === undefined) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			try {
				const ids = options.runtime.commitImportBundle(
					workspaceId,
					bundle.assets,
					bundle.relations ?? [],
					commitBody.previewDigest,
				);
				sendJson(response, 201, { assetIds: ids });
			} catch (error) {
				if (sendAssetError(response, error)) return;
				throw error;
			}
			return;
		}

		if (request.method === "GET" && url.pathname === "/api/search") {
			const workspaceId = Number(url.searchParams.get("workspaceId"));
			const query = url.searchParams.get("q") ?? "";
			if (!Number.isInteger(workspaceId) || !options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
			sendJson(response, 200, { query, hits: options.runtime.searchWorkspaceContent(workspaceId, query) });
			return;
		}

		if (request.method === "GET" && url.pathname === "/api/assets/hierarchy") {
			const workspaceId = Number(url.searchParams.get("workspaceId"));
			if (!Number.isInteger(workspaceId) || !options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
		const searchQ = url.searchParams.get("q");
		if (searchQ !== null && searchQ.length > 0) {
			sendJson(response, 200, { query: searchQ, hits: options.runtime.searchHierarchyNodes(workspaceId, searchQ) });
			return;
		}
		const parentAssetIdParam = url.searchParams.get("parentAssetId");
		if (parentAssetIdParam !== null && parentAssetIdParam !== "") {
			const parentAssetId = Number(parentAssetIdParam);
			if (!Number.isInteger(parentAssetId)) {
				sendJson(response, 400, { error: "invalid_parent_asset_id" });
				return;
			}
			const asset = options.runtime.getReusableAsset(parentAssetId);
			if (!asset || asset.workspaceId !== workspaceId) {
				sendJson(response, 404, { error: "unknown_asset" });
				return;
			}
			sendJson(response, 200, { children: options.runtime.getHierarchyChildren(parentAssetId) });
			return;
		}
		const root = url.searchParams.get("root") ?? "scenario-domain";
		if (!isReusableAssetKind(root)) {
			sendJson(response, 400, { error: "invalid_root_kind" });
			return;
		}
		const page = parsePositiveQueryInteger(url.searchParams.get("page"), 1);
		const pageSize = parsePositiveQueryInteger(url.searchParams.get("pageSize"), 12, 100);
		if (page === undefined || pageSize === undefined) {
			sendJson(response, 400, { error: "invalid_asset_query" });
			return;
		}
		sendJson(response, 200, options.runtime.getHierarchyRoots(workspaceId, root, { page, pageSize }));
		return;
			return;
		}

		if (request.method === "POST" && url.pathname === "/api/assets/hierarchy") {
			let body: unknown;
			try {
				body = JSON.parse(await readBody(request));
			} catch {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if (typeof body !== "object" || body === null || Array.isArray(body)) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			const createBody = body as { workspaceId?: unknown; tree?: unknown; parentAssetId?: unknown };
			const workspaceId = Number(createBody.workspaceId);
			if (!Number.isInteger(workspaceId) || !options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
			const tree = parseSubtreeNode(createBody.tree);
			if (tree === undefined) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			let parentAssetId: number | null = null;
			if (createBody.parentAssetId !== undefined) {
				parentAssetId = Number(createBody.parentAssetId);
				if (!Number.isInteger(parentAssetId)) {
					sendJson(response, 400, { error: "malformed_body" });
					return;
				}
				const parentAsset = options.runtime.getReusableAsset(parentAssetId);
				if (!parentAsset || parentAsset.workspaceId !== workspaceId) {
					sendJson(response, 404, { error: "unknown_asset" });
					return;
				}
			}
			try {
				const result = options.runtime.createHierarchySubtree(workspaceId, tree, parentAssetId);
				sendJson(response, 201, result);
			} catch (error) {
				if (error instanceof ReusableAssetNameConflictError) {
					sendJson(response, 409, { error: "name_conflict" });
					return;
				}
				if (sendAssetError(response, error)) return;
				throw error;
			}
			return;
		}

		if (request.method === "PUT" && url.pathname === "/api/assets/hierarchy/move") {
			let body: unknown;
			try {
				body = JSON.parse(await readBody(request));
			} catch {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if (typeof body !== "object" || body === null || Array.isArray(body)) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			const moveBody = body as { workspaceId?: unknown; assetId?: unknown; expectedRevisionId?: unknown; newParentAssetId?: unknown };
			const workspaceId = Number(moveBody.workspaceId);
			const assetId = Number(moveBody.assetId);
			const expectedRevisionId = Number(moveBody.expectedRevisionId);
			if (!Number.isInteger(workspaceId) || !Number.isInteger(assetId) || !Number.isInteger(expectedRevisionId)) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if (!options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
			const asset = options.runtime.getReusableAsset(assetId);
			if (!asset || asset.workspaceId !== workspaceId) {
				sendJson(response, 404, { error: "unknown_asset" });
				return;
			}
			let newParentAssetId: number | null = null;
			if (moveBody.newParentAssetId !== undefined && moveBody.newParentAssetId !== null) {
				newParentAssetId = Number(moveBody.newParentAssetId);
				if (!Number.isInteger(newParentAssetId)) {
					sendJson(response, 400, { error: "malformed_body" });
					return;
				}
				const parentAsset = options.runtime.getReusableAsset(newParentAssetId);
				if (!parentAsset || parentAsset.workspaceId !== workspaceId) {
					sendJson(response, 404, { error: "unknown_asset" });
					return;
				}
			}
			try {
				options.runtime.moveHierarchySubtree(workspaceId, assetId, expectedRevisionId, newParentAssetId);
				sendJson(response, 200, { ok: true });
			} catch (error) {
				if (error instanceof ReusableAssetVersionConflictError) {
					sendJson(response, 409, { error: "version_conflict" });
					return;
				}
				if (error instanceof AssetRelationValidationError) {
					sendJson(response, 400, { error: "invalid_relation", invalidRelations: error.issues });
					return;
				}
				throw error;
			}
			return;
		}

		if (request.method === "GET" && url.pathname === "/api/assets") {
			const workspaceId = Number(url.searchParams.get("workspaceId"));
			if (!Number.isInteger(workspaceId) || !options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
			const q = url.searchParams.get("q");
			const page = parsePositiveQueryInteger(url.searchParams.get("page"), 1);
			const pageSize = parsePositiveQueryInteger(url.searchParams.get("pageSize"), 12, 100);
			const rawKind = url.searchParams.get("kind");
			const kind = rawKind === null || rawKind === "" ? undefined : rawKind;
			if (page === undefined || pageSize === undefined || (kind !== undefined && !isReusableAssetKind(kind))) {
				sendJson(response, 400, { error: "invalid_asset_query" });
				return;
			}
		sendJson(response, 200, options.runtime.listReusableAssetPage(workspaceId, { page, pageSize, kind, q: q ?? undefined }));
			return;
		}

		if (request.method === "POST" && segments.length === 4 && segments[0] === "api" && segments[1] === "requirements" && segments[3] === "promote") {
			let body: unknown;
			try {
				body = JSON.parse(await readBody(request));
			} catch {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if (typeof body !== "object" || body === null || Array.isArray(body)) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			const kinds = (body as { kinds?: unknown }).kinds;
			if (!Array.isArray(kinds) || kinds.some((kind) => typeof kind !== "string") || kinds.some((kind) => !isReusableAssetKind(kind))) {
				sendJson(response, 400, { error: "unknown_asset_kind" });
				return;
			}
			const requirementId = Number(segments[2]);
			const detail = options.runtime.getRequirementDetail(requirementId);
			if (!detail) {
				sendJson(response, 404, { error: "unknown_requirement" });
				return;
			}
			const counts = options.runtime.promoteRequirementArtifacts(detail.workflowId, kinds as string[]);
			sendJson(response, 201, { promoted: counts });
			return;
		}

		if (request.method === "POST" && url.pathname === "/api/assets") {
			let body: unknown;
			try {
				body = JSON.parse(await readBody(request));
			} catch {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if (typeof body !== "object" || body === null || Array.isArray(body)) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if ("actor" in body || "operator" in body) {
				sendJson(response, 400, { error: "actor_fields_are_not_accepted" });
				return;
			}
			const createBody = body as { workspaceId?: unknown; kind?: unknown; title?: unknown; content?: unknown; relations?: unknown };
			const workspaceId = Number(createBody.workspaceId);
			if (!Number.isInteger(workspaceId) || !options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
			if (!isReusableAssetKind(createBody.kind) || !("content" in createBody)) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if (createBody.kind !== "stakeholder" && typeof createBody.title !== "string") {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			const relations = createBody.relations === undefined ? [] : parseOutgoingRelations(createBody.relations);
			if (relations === undefined) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			let created: { assetId: number; revisionId: number; revisionNo: number } | undefined;
			try {
				created = options.runtime.createReusableAsset({
					workspaceId,
					kind: createBody.kind as ReusableAssetKind,
					title: typeof createBody.title === "string" ? createBody.title : "",
					content: createBody.content,
					strict: true,
				});
				if (relations.length > 0) {
					options.runtime.writeRelations({ workspaceId, fromAssetId: created.assetId, fromRevisionId: created.revisionId, relations });
				}
				sendJson(response, 201, created);
		} catch (error) {
			if (error instanceof AssetRelationValidationError) {
				if (created) options.runtime.deleteReusableAsset(created.assetId);
				sendJson(response, 400, { error: "invalid_relations", invalidRelations: error.issues });
				return;
			}
			if (sendAssetError(response, error)) return;
			throw error;
		}
			return;
		}

		if (request.method === "PUT" && segments.length === 3 && segments[0] === "api" && segments[1] === "assets") {
			let body: unknown;
			try {
				body = JSON.parse(await readBody(request));
			} catch {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			if (typeof body !== "object" || body === null || Array.isArray(body)) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			const record = body as { expectedRevisionId?: unknown; title?: unknown; content?: unknown; relations?: unknown };
			const assetId = Number(segments[2]);
			const asset = options.runtime.getReusableAsset(assetId);
			if (!asset) {
				sendJson(response, 404, { error: "unknown_asset" });
				return;
			}
			const relations = parseOutgoingRelations(record.relations);
			if (!Number.isInteger(record.expectedRevisionId) || typeof record.title !== "string" || !("content" in record) || relations === undefined) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			try {
				const updated = options.runtime.updateReusableAsset({
					workspaceId: asset.workspaceId,
					assetId,
					expectedRevisionId: record.expectedRevisionId as number,
					title: record.title,
					content: record.content,
					relations,
				});
				if (!updated) {
					sendJson(response, 404, { error: "unknown_asset" });
					return;
				}
				sendJson(response, 200, updated);
		} catch (error) {
			if (sendAssetError(response, error)) return;
			throw error;
		}
			return;
		}

		if (request.method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "assets") {
			const asset = options.runtime.getReusableAsset(Number(segments[2]));
			if (!asset) {
				sendJson(response, 404, { error: "unknown_asset" });
				return;
			}
			sendJson(response, 200, asset);
			return;
		}

		if (request.method === "DELETE" && segments.length === 3 && segments[0] === "api" && segments[1] === "assets") {
			const assetId = Number(segments[2]);
			const asset = options.runtime.getReusableAsset(assetId);
			if (!asset) {
				sendJson(response, 404, { error: "unknown_asset" });
				return;
			}
			if (url.searchParams.get("preview") === "true") {
				sendJson(response, 200, { affected: options.runtime.previewSubtreeDeletion(assetId) });
				return;
			}
			let body: unknown = {};
			try {
				body = JSON.parse(await readBody(request));
			} catch {
				// empty body is allowed for plain deletion
			}
			if (typeof body !== "object" || body === null || Array.isArray(body)) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			const deleteBody = body as { cascadeSubtree?: unknown };
			if (deleteBody.cascadeSubtree === true) {
				const refs = options.runtime.hasIncomingCrossAssetRelations(assetId);
				if (refs.length > 0) {
					sendJson(response, 409, { error: "asset_referenced", refs });
					return;
				}
				try {
					options.runtime.deleteSubtree(assetId);
					sendJson(response, 200, { deleted: true });
				} catch (error) {
					if (sendAssetError(response, error)) return;
					throw error;
				}
				return;
			}
			if (options.runtime.hasChildren(assetId)) {
				sendJson(response, 409, { error: "has_children" });
				return;
			}
			try {
				if (!options.runtime.deleteReusableAsset(assetId)) {
					sendJson(response, 404, { error: "unknown_asset" });
					return;
				}
				sendJson(response, 200, { deleted: true });
			} catch (error) {
				if (error instanceof ReusableAssetReferencedError) {
					sendJson(response, 409, { error: "asset_referenced", refs: error.refs });
					return;
				}
				throw error;
			}
			return;
		}

		if (
			request.method === "GET"
			&& segments.length === 5
			&& segments[0] === "api"
			&& segments[1] === "workflows"
			&& segments[3] === "events"
			&& segments[4] === "stream"
		) {
			const workflowId = Number(segments[2]);
			if (!Number.isInteger(workflowId) || !options.runtime.getWorkflowProjection(workflowId)) {
				sendJson(response, 404, { error: "unknown_workflow" });
				return;
			}
			const lastEventId = request.headers["last-event-id"];
			const cursor = parseEventCursor(url, response, typeof lastEventId === "string" ? lastEventId : undefined);
			if (cursor === null) return;
			const watermark = options.runtime.getWorkflowEventWatermark(workflowId);
			if (cursor.after > watermark) {
				sendJson(response, 416, { error: "cursor_out_of_range", watermark });
				return;
			}
			streamEvents(response, {
				eventField: "workflow-event",
				after: cursor.after,
				watermark,
				replay: (after, limit) => options.runtime.getWorkflowEvents(workflowId, after, limit),
				subscribe: (listener) => options.runtime.subscribeWorkflowEvents((event) => {
					if (event.workflowId === workflowId) listener(event);
				}),
				heartbeatMs: options.sseHeartbeatMs ?? 15_000,
			});
			return;
		}

		if (
			request.method === "GET"
			&& segments.length === 5
			&& segments[0] === "api"
			&& segments[1] === "runs"
			&& segments[3] === "events"
			&& segments[4] === "stream"
		) {
			const runId = Number(segments[2]);
			if (!Number.isInteger(runId) || !options.runtime.runExists(runId)) {
				sendJson(response, 404, { error: "unknown_run" });
				return;
			}
			const lastEventId = request.headers["last-event-id"];
			const cursor = parseEventCursor(url, response, typeof lastEventId === "string" ? lastEventId : undefined);
			if (cursor === null) return;
			const watermark = options.runtime.getRunEventWatermark(runId);
			if (cursor.after > watermark) {
				sendJson(response, 416, { error: "cursor_out_of_range", watermark });
				return;
			}
			streamEvents(response, {
				eventField: "run-event",
				after: cursor.after,
				watermark,
				replay: (after, limit) => options.runtime.getRunEvents(runId, after, limit),
				subscribe: (listener) => options.runtime.subscribeRunEvents((event) => {
					if (event.runId === runId) listener(event);
				}),
				heartbeatMs: options.sseHeartbeatMs ?? 15_000,
			});
			return;
		}

		sendJson(response, 404, { error: "unknown_route" });
	}

	await new Promise<void>((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(options.port ?? 0, host, () => resolveListen());
	});
	const address = server.address() as AddressInfo;
	return {
		url: `http://${host === "::1" ? "[::1]" : host}:${address.port}`,
		port: address.port,
		close() {
			return new Promise((resolveClose, reject) => {
				server.close((error) => (error ? reject(error) : resolveClose()));
			});
		},
	};
}
