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
import type { WorkflowCommandType } from "../persistence/workflow-store.js";
import type { RequirementBaseline } from "./requirement.js";

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
}

export interface OperatorServer {
	readonly url: string;
	readonly port: number;
	close(): Promise<void>;
}

const COMMAND_TYPES: readonly WorkflowCommandType[] = [
	"start",
	"pause",
	"resume",
	"retry-recovery",
	"cancel-run",
	"dispose-decision",
	"steer",
	"retry-task",
	"retry-planning",
	"replace-plan",
	"diagnostic-run",
	"provide-human-input",
	"revise-requirement",
	"approve-artifact",
	"reject-artifact",
	"accept-finding-risk",
	"revoke-approval",
	"approve-packet",
	"reject-packet",
];

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

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
		}

		// Every route below requires an authenticated Operator Session.
		const sessionId = sessionFromCookie(request);
		const operator = sessionId ? sessions.get(sessionId) : undefined;
		if (!operator) {
			sendJson(response, 401, { error: "unauthenticated" });
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
			let created;
			try {
				created = options.runtime.createRequirement({
					workspaceId,
					baseline: body as RequirementBaseline,
				});
			} catch {
				sendJson(response, 400, { error: "invalid_baseline" });
				return;
			}
			sendJson(response, 201, {
				requirementId: created.requirementId,
				workflowId: created.workflowId,
				state: created.workflowState,
				version: created.workflowVersion,
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
				|| !COMMAND_TYPES.includes(envelope.type as WorkflowCommandType)
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
			sendJson(response, receipt.httpStatus, receipt);
			return;
		}

		if (request.method === "GET" && url.pathname === "/api/session") {
			sendJson(response, 200, { actorRef: operator.actorRef, capabilities: operator.capabilities });
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

		if (request.method === "GET" && segments.length === 4 && segments[0] === "api" && segments[1] === "workflows" && segments[3] === "receipts") {
			if (!options.runtime.getBoundedProjection(Number(segments[2]))) {
				sendJson(response, 404, { error: "unknown_workflow" });
				return;
			}
			const limitParam = url.searchParams.get("limit");
			const limit = limitParam === null ? 200 : Number(limitParam);
			if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
				sendJson(response, 400, { error: "invalid_limit" });
				return;
			}
			sendJson(response, 200, { receipts: options.runtime.listCommandReceipts(Number(segments[2]), limit) });
			return;
		}

		if (request.method === "GET" && segments.length === 4 && segments[0] === "api" && segments[1] === "workflows" && segments[3] === "incidents") {
			if (!options.runtime.getBoundedProjection(Number(segments[2]))) {
				sendJson(response, 404, { error: "unknown_workflow" });
				return;
			}
			sendJson(response, 200, { incidents: options.runtime.listWorkflowIncidents(Number(segments[2])) });
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
			sendJson(response, 200, { assets: options.runtime.exportReusableAssets(workspaceId) });
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
			const importBody = body as { workspaceId?: unknown; assets?: unknown };
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
				if (typeof asset !== "object" || asset === null || !["scenario", "usecase", "function"].includes((asset as { kind?: unknown }).kind as string) || typeof (asset as { title?: unknown }).title !== "string" || !("content" in (asset as object))) {
					sendJson(response, 400, { error: "malformed_body" });
					return;
				}
			}
			const ids = options.runtime.importReusableAssets(workspaceId, importBody.assets as { kind: "scenario" | "usecase" | "function"; title: string; content: unknown }[]);
			sendJson(response, 201, { assetIds: ids });
			return;
		}

		if (request.method === "GET" && url.pathname === "/api/assets") {
			const workspaceId = Number(url.searchParams.get("workspaceId"));
			if (!Number.isInteger(workspaceId) || !options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
			sendJson(response, 200, { assets: options.runtime.listReusableAssets(workspaceId) });
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
			const createBody = body as { workspaceId?: unknown; kind?: unknown; title?: unknown; content?: unknown };
			const workspaceId = Number(createBody.workspaceId);
			if (!Number.isInteger(workspaceId) || !options.runtime.workspaceExists(workspaceId)) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return;
			}
			if (!["scenario", "usecase", "function"].includes(createBody.kind as string) || typeof createBody.title !== "string" || !("content" in createBody)) {
				sendJson(response, 400, { error: "malformed_body" });
				return;
			}
			const created = options.runtime.createReusableAsset({
				workspaceId,
				kind: createBody.kind as "scenario" | "usecase" | "function",
				title: createBody.title,
				content: createBody.content,
			});
			sendJson(response, 201, created);
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
			if (!options.runtime.deleteReusableAsset(Number(segments[2]))) {
				sendJson(response, 404, { error: "unknown_asset" });
				return;
			}
			sendJson(response, 200, { deleted: true });
			return;
		}

		if (
			request.method === "GET"
			&& segments.length === 4
			&& segments[0] === "api"
			&& segments[1] === "workflows"
			&& segments[3] === "events"
		) {
			const workflowId = Number(segments[2]);
			if (!Number.isInteger(workflowId) || !options.runtime.getWorkflowProjection(workflowId)) {
				sendJson(response, 404, { error: "unknown_workflow" });
				return;
			}
			const cursor = parseEventCursor(url, response);
			if (cursor === null) return;
			const watermark = options.runtime.getWorkflowEventWatermark(workflowId);
			if (cursor.after > watermark) {
				sendJson(response, 416, { error: "cursor_out_of_range", watermark });
				return;
			}
			sendJson(response, 200, { events: options.runtime.getWorkflowEvents(workflowId, cursor.after, cursor.limit), watermark });
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
			&& segments.length === 4
			&& segments[0] === "api"
			&& segments[1] === "runs"
			&& segments[3] === "events"
		) {
			const runId = Number(segments[2]);
			if (!Number.isInteger(runId) || !options.runtime.runExists(runId)) {
				sendJson(response, 404, { error: "unknown_run" });
				return;
			}
			const cursor = parseEventCursor(url, response);
			if (cursor === null) return;
			const watermark = options.runtime.getRunEventWatermark(runId);
			if (cursor.after > watermark) {
				sendJson(response, 416, { error: "cursor_out_of_range", watermark });
				return;
			}
			sendJson(response, 200, { events: options.runtime.getRunEvents(runId, cursor.after, cursor.limit), watermark });
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

		if (options.staticRoot !== undefined && request.method === "GET") {
			await serveStatic(response, url.pathname, options.staticRoot);
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
