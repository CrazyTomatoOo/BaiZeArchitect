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
import type { AddressInfo } from "node:net";
import type { HeadlessWorkflowRuntime } from "./headless-runtime.js";
import type { ModelDriver } from "./model-driver.js";
import * as sessionHandler from "./handlers/session-handler.js";
import * as workspaceHandler from "./handlers/workspace-handler.js";
import * as workflowCommandHandler from "./handlers/workflow-command-handler.js";
import * as workflowProjectionHandler from "./handlers/workflow-projection-handler.js";
import * as assetHandler from "./handlers/asset-handler.js";
import * as sseHandler from "./handlers/sse-handler.js";
import { runReadyTasks } from "./handlers/workflow-command-orchestration.js";
import { sendJson, sessionFromCookie, serveStatic, type HandlerContext, type OperatorContext } from "./handlers/shared.js";

export { runReadyTasks };

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

const LOOPBACK_HOSTS: Record<string, true> = {
	"127.0.0.1": true,
	"::1": true,
	"localhost": true,
};

export async function startOperatorServer(
	options: OperatorServerOptions,
): Promise<OperatorServer> {
	const host = options.host ?? "127.0.0.1";
	const operatorTokens = Object.keys(options.operators);
	if (!LOOPBACK_HOSTS[host] && operatorTokens.length === 0) {
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
		const method = request.method ?? "";

		const ctx: HandlerContext = {
			runtime: options.runtime,
			operator: undefined as unknown as OperatorContext,
			operators: options.operators as Readonly<Record<string, OperatorContext>>,
			sessions: sessions as Map<string, OperatorContext>,
			modelDriver: options.modelDriver,
			sseHeartbeatMs: options.sseHeartbeatMs,
			staticRoot: options.staticRoot,
			secureCookies: options.secureCookies,
			projectionReader: options.runtime.readModel,
			eventStreamReader: options.runtime.readModel,
			planningContextReader: options.runtime.readModel,
		};

		// Public bootstrap route: must run before authentication.
		if (method === "POST" && url.pathname === "/api/session" && await sessionHandler.match(method, segments, url, request, response, ctx)) return;

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
		ctx.operator = operator as OperatorContext;

		const handlers = [
			sessionHandler,
			workspaceHandler,
			workflowCommandHandler,
			workflowProjectionHandler,
			assetHandler,
			sseHandler,
		];
		for (const handler of handlers) {
			if (await handler.match(method, segments, url, request, response, ctx)) return;
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
