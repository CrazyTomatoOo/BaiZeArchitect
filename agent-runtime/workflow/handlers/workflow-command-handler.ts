import type { IncomingMessage, ServerResponse } from "node:http";
import { WORKFLOW_COMMAND_TYPES, type WorkflowCommandType } from "../command-types.js";
import { isReusableAssetKind } from "../../persistence/reusable-asset-kind.js";
import {
	parseJsonBody,
	rejectReservedFields,
	runReadyTasks,
	sendJson,
	type HandlerContext,
} from "./shared.js";

export async function match(
	method: string,
	segments: readonly string[],
	url: URL,
	request: IncomingMessage,
	response: ServerResponse,
	ctx: HandlerContext,
): Promise<boolean> {
	if (
		method === "PUT"
		&& segments.length === 5
		&& segments[0] === "api"
		&& segments[1] === "workflows"
		&& segments[3] === "commands"
	) {
		const workflowId = Number(segments[2]);
		const commandId = segments[4];
		if (!Number.isInteger(workflowId) || !ctx.runtime.readModel.getWorkflowProjection(workflowId)) {
			sendJson(response, 404, { error: "unknown_workflow" });
			return true;
		}
		const body = await parseJsonBody(request, response);
		if (body === null) return true;
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		const reserved = rejectReservedFields(body as Record<string, unknown>, ["actor", "operator", "commandId"]);
		if (reserved.length > 0) {
			sendJson(response, 400, { error: "actor_fields_are_not_accepted" });
			return true;
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
			return true;
		}
		const receipt = ctx.runtime.kernel.executeCommand({
			workflowId,
			commandId,
			type: envelope.type as WorkflowCommandType,
			expectedWorkflowVersion: envelope.expectedWorkflowVersion,
			payload: envelope.payload as Record<string, unknown> | undefined,
			reason: envelope.reason as string | undefined,
			operator: ctx.operator,
		});
		// #19：Engine 直生成 —— start 接受后异步实例化模板计划（无 Orchestrator 模型调用），
		// 计划采纳后立即以生产模型驱动器驱动就绪 Task 链式执行。
		// workflow 状态机保证幂等：已有计划/非 running 时 planWorkflow 返回 budget 而非破坏。
		if (receipt.outcome === "accepted" && envelope.type === "start") {
			void (async () => {
				const plan = await ctx.runtime.planWorkflow(workflowId, null);
				if (plan.outcome === "adopted") {
					// analysis 类产物要求 TraceLink:绑仓库快照供模型引用(生产环境实际快照来自 EvidenceSnapshot)
					ctx.runtime.bindEvidenceSnapshot(workflowId, "sha256:seed-repo", []);
				}
				if (ctx.modelDriver) {
					await runReadyTasks(ctx.runtime, ctx.modelDriver, workflowId);
				}
			})().catch((error) => {
				console.error(`[baize] template plan failed for workflow ${workflowId}:`, error);
			});
		} else if (receipt.outcome === "accepted" && ctx.modelDriver) {
			// 其余命令（resume/retry/steer/human-response 等）接受后同样驱动就绪 Task。
			void runReadyTasks(ctx.runtime, ctx.modelDriver, workflowId).catch((error) => {
				console.error(`[baize] ready-task runner failed for workflow ${workflowId}:`, error);
			});
		}
		sendJson(response, receipt.httpStatus, receipt);
		return true;
	}

	if (method === "POST" && segments.length === 4 && segments[0] === "api" && segments[1] === "requirements" && segments[3] === "promote") {
		const body = await parseJsonBody(request, response);
		if (body === null) return true;
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		const kinds = (body as { kinds?: unknown }).kinds;
		if (!Array.isArray(kinds) || kinds.some((kind) => typeof kind !== "string" || !isReusableAssetKind(kind))) {
			sendJson(response, 400, { error: "unknown_asset_kind" });
			return true;
		}
		const requirementId = Number(segments[2]);
		const detail = ctx.runtime.readModel.getRequirementDetail(requirementId);
		if (!detail) {
			sendJson(response, 404, { error: "unknown_requirement" });
			return true;
		}
		const counts = ctx.runtime.kernel.promoteRequirementArtifacts(detail.workflowId, kinds as string[]);
		sendJson(response, 201, { promoted: counts });
		return true;
	}

	return false;
}
