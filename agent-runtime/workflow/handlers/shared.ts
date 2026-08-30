import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { HeadlessWorkflowRuntime } from "../headless-runtime.js";
import type { ModelDriver } from "../model-driver.js";
import {
	AssetRelationValidationError,
	ImportDigestConflictError,
	ReusableAssetMalformedBodyError,
	ReusableAssetNameConflictError,
	ReusableAssetVersionConflictError,
} from "../../persistence/workflow-store.js";
import type { AssetRelationExport, AssetRelationInput, SubtreeNode } from "../../persistence/workflow-store.js";
import { isReusableAssetKind } from "../../persistence/reusable-asset-kind.js";

export interface OperatorContext {
	actorRef: string;
	capabilities: readonly string[];
}

export interface HandlerContext {
	runtime: HeadlessWorkflowRuntime;
	operator: OperatorContext;
	operators: Readonly<Record<string, OperatorContext>>;
	sessions: Map<string, OperatorContext>;
	modelDriver?: ModelDriver;
	sseHeartbeatMs?: number;
	staticRoot?: string;
	secureCookies?: boolean;
}

const PARSE_ERROR = Symbol("parse_error");
export async function parseJsonBody(request: IncomingMessage, response: ServerResponse, errorKey = "malformed_body"): Promise<unknown | typeof PARSE_ERROR> {
	let raw: string;
	try {
		raw = await readBody(request);
	} catch {
		sendJson(response, 400, { error: errorKey });
		return PARSE_ERROR;
	}
	try {
		return JSON.parse(raw);
	} catch {
		sendJson(response, 400, { error: errorKey });
		return PARSE_ERROR;
	}
}
export function isParseError(body: unknown): body is typeof PARSE_ERROR {
	return body === PARSE_ERROR;
}

export function requireWorkspace(runtime: HeadlessWorkflowRuntime, workspaceId: number, response: ServerResponse): boolean {
	if (!Number.isInteger(workspaceId) || !runtime.workspaceExists(workspaceId)) {
		sendJson(response, 404, { error: "unknown_workspace" });
		return false;
	}
	return true;
}

export function rejectReservedFields(body: Record<string, unknown>, fields: readonly string[]): string[] {
	return fields.filter((field) => field in body);
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
}

export function readBody(request: IncomingMessage): Promise<string> {
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

export function sessionFromCookie(request: IncomingMessage): string | null {
	const header = request.headers.cookie;
	if (!header) return null;
	for (const part of header.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name === "baize_operator") return rest.join("=");
	}
	return null;
}

export interface EventCursor {
	after: number;
	limit: number;
}

export function parseEventCursor(url: URL, response: ServerResponse, lastEventId?: string): EventCursor | null {
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

export interface StreamEventsOptions<T extends { seq: number }> {
	eventField: "workflow-event" | "run-event";
	after: number;
	watermark: number;
	replay: (after: number, limit: number) => readonly T[];
	subscribe: (listener: (event: T) => void) => () => void;
	heartbeatMs: number;
}

export function streamEvents<T extends { seq: number }>(response: ServerResponse, stream: StreamEventsOptions<T>): void {
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

export async function serveStatic(response: ServerResponse, pathname: string, staticRoot: string): Promise<void> {
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

export function parseOutgoingRelations(value: unknown): readonly AssetRelationInput[] | undefined {
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

export function parseImportedRelations(value: unknown): readonly AssetRelationExport[] | undefined {
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

export function sendAssetError(response: ServerResponse, error: unknown): boolean {
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

export function parsePositiveQueryInteger(value: string | null, fallback: number, maximum?: number): number | undefined {
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
export function approveReviewedArtifacts(runtime: HeadlessWorkflowRuntime, workflowId: number): void {
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
