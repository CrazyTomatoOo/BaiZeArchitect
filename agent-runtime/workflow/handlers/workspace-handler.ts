import type { IncomingMessage, ServerResponse } from "node:http";
import { validateModelRoles } from "../../model-config.js";
import type { RequirementBaseline } from "../requirement.js";
import { BusyWorkspaceError } from "../../persistence/workflow-store.js";
import {
	parseJsonBody,
	isParseError,
	requireWorkspace,
	rejectReservedFields,
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
	if (method === "GET" && url.pathname === "/api/workspaces") {
		sendJson(response, 200, { workspaces: ctx.runtime.listWorkspaces() });
		return true;
	}

	if (method === "POST" && url.pathname === "/api/workspaces") {
		const body = await parseJsonBody(request, response, "malformed_workspace");
		if (isParseError(body)) return true;
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			sendJson(response, 400, { error: "malformed_workspace" });
			return true;
		}
		const { name, repoPath } = body as Record<string, unknown>;
		if (
			typeof name !== "string" || typeof repoPath !== "string"
			|| name.trim() === "" || repoPath.trim() === ""
		) {
			sendJson(response, 400, { error: "malformed_workspace" });
			return true;
		}
		let workspaceId: number;
		try {
			workspaceId = ctx.runtime.createWorkspace({
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
				return true;
			}
			throw error;
		}
		sendJson(response, 201, { workspaceId });
		return true;
	}

	if (method === "DELETE" && segments.length === 3 && segments[0] === "api" && segments[1] === "workspaces") {
		const workspaceId = Number(segments[2]);
		if (!Number.isInteger(workspaceId) || !ctx.runtime.workspaceExists(workspaceId)) {
			sendJson(response, 404, { error: "unknown_workspace" });
			return true;
		}
		try {
			const deleted = ctx.runtime.deleteWorkspace(workspaceId);
			if (!deleted) {
				sendJson(response, 404, { error: "unknown_workspace" });
				return true;
			}
		} catch (error) {
			if (error instanceof BusyWorkspaceError) {
				sendJson(response, 409, {
					error: "workspace_busy",
					activeRuns: error.activeRuns,
					activeClaims: error.activeClaims,
				});
				return true;
			}
			throw error;
		}
		sendJson(response, 200, { deleted: true });
		return true;
	}

	if (method === "GET" && url.pathname === "/api/requirements") {
		const workspaceId = Number(url.searchParams.get("workspaceId"));
		if (!requireWorkspace(ctx.runtime, workspaceId, response)) return true;
		sendJson(response, 200, { requirements: ctx.runtime.readModel.listRequirementSummaries(workspaceId) });
		return true;
	}

	if (method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "requirements") {
		const detail = ctx.runtime.readModel.getRequirementDetail(Number(segments[2]));
		if (!detail) {
			sendJson(response, 404, { error: "unknown_requirement" });
			return true;
		}
		sendJson(response, 200, detail);
		return true;
	}

	if (method === "GET" && segments.length === 4 && segments[0] === "api" && segments[1] === "requirements" && segments[3] === "artifacts") {
		const detail = ctx.runtime.readModel.getArtifactRevisionDetail(Number(segments[2]), String(url.searchParams.get("kind") ?? ""));
		if (!detail) {
			sendJson(response, 404, { error: "unknown_artifact" });
			return true;
		}
		sendJson(response, 200, detail);
		return true;
	}

	if (method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "design-packages") {
		const designPackage = ctx.runtime.readModel.getDesignPackage(Number(segments[2]));
		if (!designPackage) {
			sendJson(response, 404, { error: "unknown_design_package" });
			return true;
		}
		sendJson(response, 200, designPackage);
		return true;
	}

	if (method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "legacy-imports") {
		const legacyImport = ctx.runtime.readModel.getLegacyImport(Number(segments[2]));
		if (!legacyImport) {
			sendJson(response, 404, { error: "unknown_legacy_import" });
			return true;
		}
		sendJson(response, 200, legacyImport);
		return true;
	}

	if (
		method === "POST"
		&& segments.length === 4
		&& segments[0] === "api"
		&& segments[1] === "workspaces"
		&& segments[3] === "requirements"
	) {
		const workspaceId = Number(segments[2]);
		if (!requireWorkspace(ctx.runtime, workspaceId, response)) return true;
		const body = await parseJsonBody(request, response);
		if (isParseError(body)) return true;
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		const reserved = rejectReservedFields(body as Record<string, unknown>, ["actor", "operator"]);
		if (reserved.length > 0) {
			sendJson(response, 400, { error: "actor_fields_are_not_accepted" });
			return true;
		}
		const createBody = body as { baseline?: unknown; modelRoles?: unknown };
		if (typeof createBody.baseline !== "object" || createBody.baseline === null) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		if (createBody.modelRoles !== undefined) {
			const problems = validateModelRoles(createBody.modelRoles);
			if (problems.length > 0) {
				sendJson(response, 400, { error: "invalid_model_roles", detail: problems });
				return true;
			}
		}
		let created;
		try {
			created = ctx.runtime.createRequirement({
				workspaceId,
				baseline: createBody.baseline as RequirementBaseline,
				modelRoles: createBody.modelRoles as Record<string, unknown> | undefined,
			});
		} catch {
			sendJson(response, 400, { error: "invalid_baseline" });
			return true;
		}
		sendJson(response, 201, {
			requirementId: created.requirementId,
			workflowId: created.workflowId,
			workflowState: created.workflowState,
			workflowVersion: created.workflowVersion,
			lastEventSeq: created.lastEventSeq,
		});
		return true;
	}

	return false;
}
