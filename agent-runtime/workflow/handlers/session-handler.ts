import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { effectiveModelCatalog } from "../../model-config.js";
import { sendJson, type HandlerContext } from "./shared.js";

export async function match(
	method: string,
	_segments: readonly string[],
	url: URL,
	request: IncomingMessage,
	response: ServerResponse,
	ctx: HandlerContext,
): Promise<boolean> {
	if (method === "POST" && url.pathname === "/api/session") {
		const authorization = request.headers.authorization ?? "";
		const tokenMatch = /^Bearer (.+)$/.exec(authorization);
		const operator = tokenMatch ? ctx.operators[tokenMatch[1]] : undefined;
		if (!operator) {
			sendJson(response, 401, { error: "unauthenticated" });
			return true;
		}
		const sessionId = randomUUID();
		ctx.sessions.set(sessionId, operator);
		const attributes = [
			`baize_operator=${sessionId}`,
			"HttpOnly",
			"SameSite=Strict",
			"Path=/",
		];
		if (ctx.secureCookies) attributes.push("Secure");
		response.writeHead(201, {
			"content-type": "application/json",
			"set-cookie": attributes.join("; "),
		});
		response.end(JSON.stringify({ actorRef: operator.actorRef, capabilities: operator.capabilities }));
		return true;
	}

	if (method === "GET" && url.pathname === "/api/session") {
		sendJson(response, 200, { actorRef: ctx.operator.actorRef, capabilities: ctx.operator.capabilities });
		return true;
	}

	if (method === "GET" && url.pathname === "/api/model-config") {
		sendJson(response, 200, effectiveModelCatalog());
		return true;
	}

	return false;
}
