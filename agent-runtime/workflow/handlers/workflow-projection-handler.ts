import type { IncomingMessage, ServerResponse } from "node:http";
import { requireWorkspace, sendJson, type HandlerContext } from "./shared.js";

export async function match(
	method: string,
	segments: readonly string[],
	url: URL,
	_request: IncomingMessage,
	response: ServerResponse,
	ctx: HandlerContext,
): Promise<boolean> {
	if (method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "workflows") {
		const projection = ctx.projectionReader.getBoundedProjection(Number(segments[2]));
		if (!projection) {
			sendJson(response, 404, { error: "unknown_workflow" });
			return true;
		}
		sendJson(response, 200, projection);
		return true;
	}

	if (method === "GET" && segments.length === 5 && segments[0] === "api" && segments[1] === "workflows" && segments[3] === "commands") {
		const receipt = ctx.projectionReader.getCommandReceiptDetail(Number(segments[2]), segments[4]);
		if (!receipt) {
			sendJson(response, 404, { error: "unknown_command_receipt" });
			return true;
		}
		sendJson(response, 200, receipt);
		return true;
	}

	if (method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "tasks") {
		const detail = ctx.projectionReader.getTaskDetail(Number(segments[2]));
		if (!detail) {
			sendJson(response, 404, { error: "unknown_task" });
			return true;
		}
		sendJson(response, 200, detail);
		return true;
	}

	if (method === "GET" && segments.length === 4 && segments[0] === "api" && segments[1] === "tasks" && segments[3] === "attempts") {
		const taskId = Number(segments[2]);
		if (!ctx.projectionReader.getTaskDetail(taskId)) {
			sendJson(response, 404, { error: "unknown_task" });
			return true;
		}
		sendJson(response, 200, { attempts: ctx.runtime.readModel.listTaskAttempts(taskId) });
		return true;
	}

	if (method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "attempts") {
		const detail = ctx.projectionReader.getAttemptDetail(Number(segments[2]));
		if (!detail) {
			sendJson(response, 404, { error: "unknown_attempt" });
			return true;
		}
		sendJson(response, 200, detail);
		return true;
	}

	if (method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "runs") {
		const detail = ctx.projectionReader.getRunDetail(Number(segments[2]));
		if (!detail) {
			sendJson(response, 404, { error: "unknown_run" });
			return true;
		}
		sendJson(response, 200, detail);
		return true;
	}

	if (method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "plan-revisions") {
		const detail = ctx.projectionReader.getPlanRevisionDetail(Number(segments[2]));
		if (!detail) {
			sendJson(response, 404, { error: "unknown_plan_revision" });
			return true;
		}
		sendJson(response, 200, detail);
		return true;
	}

	if (method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "approval-packets") {
		const detail = ctx.projectionReader.getApprovalPacketDetail(Number(segments[2]));
		if (!detail) {
			sendJson(response, 404, { error: "unknown_approval_packet" });
			return true;
		}
		sendJson(response, 200, detail);
		return true;
	}

	if (method === "GET" && url.pathname === "/api/search") {
		const workspaceId = Number(url.searchParams.get("workspaceId"));
		const query = url.searchParams.get("q") ?? "";
		if (!requireWorkspace(ctx.runtime, workspaceId)) {
			sendJson(response, 404, { error: "unknown_workspace" });
			return true;
		}
		sendJson(response, 200, { query, hits: ctx.planningContextReader.searchWorkspaceContent(workspaceId, query) });
		return true;
	}

	return false;
}
