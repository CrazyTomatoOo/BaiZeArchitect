/**
 * operator-server.ts — test-only HTTP transport assembly for the Workflow
 * governance kernel.
 *
 * Exposes the final public transport boundary: bearer bootstrap issuing a
 * hardened Operator Session cookie, atomic Requirement creation, and the
 * unified idempotent Workflow Command resource. The production Gateway main
 * does not register these routes until the S7 cutover.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
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
