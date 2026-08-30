import type { IncomingMessage, ServerResponse } from "node:http";
import {
	AssetRelationValidationError,
	ReusableAssetNameConflictError,
	ReusableAssetReferencedError,
	ReusableAssetVersionConflictError,
} from "../../persistence/workflow-store.js";
import type { AssetRelationExport, SubtreeNode } from "../../persistence/workflow-store.js";
import { isReusableAssetKind, type ReusableAssetKind } from "../../persistence/reusable-asset-kind.js";
import {
	parseImportedRelations,
	parseOutgoingRelations,
	parsePositiveQueryInteger,
	readBody,
	requireWorkspace,
	sendAssetError,
	sendJson,
	parseJsonBody,
	type HandlerContext,
} from "./shared.js";

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

export async function match(
	method: string,
	segments: readonly string[],
	url: URL,
	request: IncomingMessage,
	response: ServerResponse,
	ctx: HandlerContext,
): Promise<boolean> {
	if (method === "GET" && url.pathname === "/api/assets/graph") {
		const workspaceId = Number(url.searchParams.get("workspaceId"));
		if (!requireWorkspace(ctx.runtime, workspaceId)) {
			sendJson(response, 404, { error: "unknown_workspace" });
			return true;
		}
		sendJson(response, 200, ctx.runtime.assets.getWorkspaceAssetGraph(workspaceId));
		return true;
	}

	if (method === "GET" && url.pathname === "/api/assets/export") {
		const workspaceId = Number(url.searchParams.get("workspaceId"));
		if (!requireWorkspace(ctx.runtime, workspaceId)) {
			sendJson(response, 404, { error: "unknown_workspace" });
			return true;
		}
		sendJson(response, 200, ctx.runtime.assets.exportReusableAssetBundle(workspaceId));
		return true;
	}

	if (method === "POST" && url.pathname === "/api/assets/import") {
		let body: unknown;
		try {
			body = await parseJsonBody(request);
		} catch {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		const importBody = body as { workspaceId?: unknown; assets?: unknown; relations?: unknown };
		const workspaceId = Number(importBody.workspaceId);
		if (!requireWorkspace(ctx.runtime, workspaceId)) {
			sendJson(response, 404, { error: "unknown_workspace" });
			return true;
		}
		if (!Array.isArray(importBody.assets) || importBody.assets.length === 0) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		for (const asset of importBody.assets) {
			if (
				typeof asset !== "object"
				|| asset === null
				|| !isReusableAssetKind((asset as { kind?: unknown }).kind)
				|| typeof (asset as { title?: unknown }).title !== "string"
				|| !("content" in (asset as object))
			) {
				sendJson(response, 400, { error: "malformed_body" });
				return true;
			}
		}
		const relations = importBody.relations === undefined ? undefined : parseImportedRelations(importBody.relations);
		if (importBody.relations !== undefined && relations === undefined) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		try {
			const ids = ctx.runtime.assets.importReusableAssetBundle(
				workspaceId,
				importBody.assets as { kind: ReusableAssetKind; title: string; content: unknown }[],
				relations,
				true,
			);
			sendJson(response, 201, { assetIds: ids });
		} catch (error) {
			if (sendAssetError(response, error)) return true;
			throw error;
		}
		return true;
	}

	if (method === "POST" && url.pathname === "/api/assets/import/preview") {
		let body: unknown;
		try {
			body = await parseJsonBody(request);
		} catch {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		const previewBody = body as { workspaceId?: unknown; bundle?: unknown };
		const workspaceId = Number(previewBody.workspaceId);
		if (!requireWorkspace(ctx.runtime, workspaceId)) {
			sendJson(response, 404, { error: "unknown_workspace" });
			return true;
		}
		const bundle = parseImportBundle(previewBody.bundle);
		if (bundle === undefined) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		try {
			const preview = ctx.runtime.assets.previewImportBundle(workspaceId, bundle.assets, bundle.relations);
			sendJson(response, 200, preview);
		} catch (error) {
			if (sendAssetError(response, error)) return true;
			throw error;
		}
		return true;
	}

	if (method === "POST" && url.pathname === "/api/assets/import/commit") {
		let body: unknown;
		try {
			body = await parseJsonBody(request);
		} catch {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		const commitBody = body as { workspaceId?: unknown; bundle?: unknown; previewDigest?: unknown };
		const workspaceId = Number(commitBody.workspaceId);
		if (!requireWorkspace(ctx.runtime, workspaceId)) {
			sendJson(response, 404, { error: "unknown_workspace" });
			return true;
		}
		if (typeof commitBody.previewDigest !== "string") {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		const bundle = parseImportBundle(commitBody.bundle);
		if (bundle === undefined) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		try {
			const ids = ctx.runtime.assets.commitImportBundle(
				workspaceId,
				bundle.assets,
				bundle.relations ?? [],
				commitBody.previewDigest,
			);
			sendJson(response, 201, { assetIds: ids });
		} catch (error) {
			if (sendAssetError(response, error)) return true;
			throw error;
		}
		return true;
	}

	if (method === "GET" && url.pathname === "/api/assets/hierarchy") {
		const workspaceId = Number(url.searchParams.get("workspaceId"));
		if (!requireWorkspace(ctx.runtime, workspaceId)) {
			sendJson(response, 404, { error: "unknown_workspace" });
			return true;
		}
		const searchQ = url.searchParams.get("q");
		if (searchQ !== null && searchQ.length > 0) {
			sendJson(response, 200, { query: searchQ, hits: ctx.runtime.assets.searchNodes(workspaceId, searchQ) });
			return true;
		}
		const parentAssetIdParam = url.searchParams.get("parentAssetId");
		if (parentAssetIdParam !== null && parentAssetIdParam !== "") {
			const parentAssetId = Number(parentAssetIdParam);
			if (!Number.isInteger(parentAssetId)) {
				sendJson(response, 400, { error: "invalid_parent_asset_id" });
				return true;
			}
			const asset = ctx.runtime.assets.getReusableAsset(parentAssetId);
			if (!asset || asset.workspaceId !== workspaceId) {
				sendJson(response, 404, { error: "unknown_asset" });
				return true;
			}
			sendJson(response, 200, { children: ctx.runtime.assets.getChildren(parentAssetId) });
			return true;
		}
		const root = url.searchParams.get("root") ?? "scenario-domain";
		if (!isReusableAssetKind(root)) {
			sendJson(response, 400, { error: "invalid_root_kind" });
			return true;
		}
		const page = parsePositiveQueryInteger(url.searchParams.get("page"), 1);
		const pageSize = parsePositiveQueryInteger(url.searchParams.get("pageSize"), 12, 100);
		if (page === undefined || pageSize === undefined) {
			sendJson(response, 400, { error: "invalid_asset_query" });
			return true;
		}
		sendJson(response, 200, ctx.runtime.assets.getHierarchyRoots(workspaceId, root, { page, pageSize }));
		return true;
	}

	if (method === "POST" && url.pathname === "/api/assets/hierarchy") {
		let body: unknown;
		try {
			body = await parseJsonBody(request);
		} catch {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		const createBody = body as { workspaceId?: unknown; tree?: unknown; parentAssetId?: unknown };
		const workspaceId = Number(createBody.workspaceId);
		if (!requireWorkspace(ctx.runtime, workspaceId)) {
			sendJson(response, 404, { error: "unknown_workspace" });
			return true;
		}
		const tree = parseSubtreeNode(createBody.tree);
		if (tree === undefined) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		let parentAssetId: number | null = null;
		if (createBody.parentAssetId !== undefined) {
			parentAssetId = Number(createBody.parentAssetId);
			if (!Number.isInteger(parentAssetId)) {
				sendJson(response, 400, { error: "malformed_body" });
				return true;
			}
			const parentAsset = ctx.runtime.assets.getReusableAsset(parentAssetId);
			if (!parentAsset || parentAsset.workspaceId !== workspaceId) {
				sendJson(response, 404, { error: "unknown_asset" });
				return true;
			}
		}
		try {
			const result = ctx.runtime.assets.createSubtree(workspaceId, tree, parentAssetId);
			sendJson(response, 201, result);
		} catch (error) {
			if (error instanceof ReusableAssetNameConflictError) {
				sendJson(response, 409, { error: "name_conflict" });
				return true;
			}
			if (sendAssetError(response, error)) return true;
			throw error;
		}
		return true;
	}

	if (method === "PUT" && url.pathname === "/api/assets/hierarchy/move") {
		let body: unknown;
		try {
			body = await parseJsonBody(request);
		} catch {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		const moveBody = body as { workspaceId?: unknown; assetId?: unknown; expectedRevisionId?: unknown; newParentAssetId?: unknown };
		const workspaceId = Number(moveBody.workspaceId);
		const assetId = Number(moveBody.assetId);
		const expectedRevisionId = Number(moveBody.expectedRevisionId);
		if (!Number.isInteger(workspaceId) || !Number.isInteger(assetId) || !Number.isInteger(expectedRevisionId)) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		if (!ctx.runtime.workspaceExists(workspaceId)) {
			sendJson(response, 404, { error: "unknown_workspace" });
			return true;
		}
		const asset = ctx.runtime.assets.getReusableAsset(assetId);
		if (!asset || asset.workspaceId !== workspaceId) {
			sendJson(response, 404, { error: "unknown_asset" });
			return true;
		}
		let newParentAssetId: number | null = null;
		if (moveBody.newParentAssetId !== undefined && moveBody.newParentAssetId !== null) {
			newParentAssetId = Number(moveBody.newParentAssetId);
			if (!Number.isInteger(newParentAssetId)) {
				sendJson(response, 400, { error: "malformed_body" });
				return true;
			}
			const parentAsset = ctx.runtime.assets.getReusableAsset(newParentAssetId);
			if (!parentAsset || parentAsset.workspaceId !== workspaceId) {
				sendJson(response, 404, { error: "unknown_asset" });
				return true;
			}
		}
		try {
			ctx.runtime.assets.moveSubtree(workspaceId, assetId, expectedRevisionId, newParentAssetId);
			sendJson(response, 200, { ok: true });
		} catch (error) {
			if (error instanceof ReusableAssetVersionConflictError) {
				sendJson(response, 409, { error: "version_conflict" });
				return true;
			}
			if (error instanceof AssetRelationValidationError) {
				sendJson(response, 400, { error: "invalid_relation", invalidRelations: error.issues });
				return true;
			}
			throw error;
		}
		return true;
	}

	if (method === "GET" && url.pathname === "/api/assets") {
		const workspaceId = Number(url.searchParams.get("workspaceId"));
		if (!requireWorkspace(ctx.runtime, workspaceId)) {
			sendJson(response, 404, { error: "unknown_workspace" });
			return true;
		}
		const q = url.searchParams.get("q");
		const page = parsePositiveQueryInteger(url.searchParams.get("page"), 1);
		const pageSize = parsePositiveQueryInteger(url.searchParams.get("pageSize"), 12, 100);
		const rawKind = url.searchParams.get("kind");
		const kind = rawKind === null || rawKind === "" ? undefined : rawKind;
		if (page === undefined || pageSize === undefined || (kind !== undefined && !isReusableAssetKind(kind))) {
			sendJson(response, 400, { error: "invalid_asset_query" });
			return true;
		}
		sendJson(response, 200, ctx.runtime.assets.listReusableAssetPage(workspaceId, { page, pageSize, kind: kind as ReusableAssetKind, q: q ?? undefined }));
		return true;
	}

	if (method === "POST" && url.pathname === "/api/assets") {
		let body: unknown;
		try {
			body = await parseJsonBody(request);
		} catch {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		const reserved = ["actor", "operator"].filter((field) => field in body);
		if (reserved.length > 0) {
			sendJson(response, 400, { error: "actor_fields_are_not_accepted" });
			return true;
		}
		const createBody = body as { workspaceId?: unknown; kind?: unknown; title?: unknown; content?: unknown; relations?: unknown };
		const workspaceId = Number(createBody.workspaceId);
		if (!requireWorkspace(ctx.runtime, workspaceId)) {
			sendJson(response, 404, { error: "unknown_workspace" });
			return true;
		}
		if (!isReusableAssetKind(createBody.kind) || !("content" in createBody)) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		if (createBody.kind !== "stakeholder" && typeof createBody.title !== "string") {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		const relations = createBody.relations === undefined ? [] : parseOutgoingRelations(createBody.relations);
		if (relations === undefined) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		let created: { assetId: number; revisionId: number; revisionNo: number } | undefined;
		try {
			created = ctx.runtime.assets.createReusableAsset({
				workspaceId,
				kind: createBody.kind as ReusableAssetKind,
				title: typeof createBody.title === "string" ? createBody.title : "",
				content: createBody.content,
				strict: true,
			});
			if (relations.length > 0) {
				ctx.runtime.assets.writeRelations({ workspaceId, fromAssetId: created.assetId, fromRevisionId: created.revisionId, relations });
			}
			sendJson(response, 201, created);
		} catch (error) {
			if (error instanceof AssetRelationValidationError) {
				if (created) ctx.runtime.assets.deleteReusableAsset(created.assetId);
				sendJson(response, 400, { error: "invalid_relations", invalidRelations: error.issues });
				return true;
			}
			if (sendAssetError(response, error)) return true;
			throw error;
		}
		return true;
	}

	if (method === "PUT" && segments.length === 3 && segments[0] === "api" && segments[1] === "assets") {
		let body: unknown;
		try {
			body = await parseJsonBody(request);
		} catch {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		const record = body as { expectedRevisionId?: unknown; title?: unknown; content?: unknown; relations?: unknown };
		const assetId = Number(segments[2]);
		const asset = ctx.runtime.assets.getReusableAsset(assetId);
		if (!asset) {
			sendJson(response, 404, { error: "unknown_asset" });
			return true;
		}
		const relations = parseOutgoingRelations(record.relations);
		if (!Number.isInteger(record.expectedRevisionId) || typeof record.title !== "string" || !("content" in record) || relations === undefined) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		try {
			const updated = ctx.runtime.assets.updateReusableAsset({
				workspaceId: asset.workspaceId,
				assetId,
				expectedRevisionId: record.expectedRevisionId as number,
				title: record.title,
				content: record.content,
				relations,
			});
			if (!updated) {
				sendJson(response, 404, { error: "unknown_asset" });
				return true;
			}
			sendJson(response, 200, updated);
		} catch (error) {
			if (sendAssetError(response, error)) return true;
			throw error;
		}
		return true;
	}

	if (method === "GET" && segments.length === 3 && segments[0] === "api" && segments[1] === "assets") {
		const asset = ctx.runtime.assets.getReusableAsset(Number(segments[2]));
		if (!asset) {
			sendJson(response, 404, { error: "unknown_asset" });
			return true;
		}
		sendJson(response, 200, asset);
		return true;
	}

	if (method === "DELETE" && segments.length === 3 && segments[0] === "api" && segments[1] === "assets") {
		const assetId = Number(segments[2]);
		const asset = ctx.runtime.assets.getReusableAsset(assetId);
		if (!asset) {
			sendJson(response, 404, { error: "unknown_asset" });
			return true;
		}
		if (url.searchParams.get("preview") === "true") {
			sendJson(response, 200, { affected: ctx.runtime.assets.previewSubtreeDeletion(assetId) });
			return true;
		}
		let body: unknown = {};
		try {
			body = JSON.parse(await readBody(request));
		} catch {
			// empty body is allowed for plain deletion
		}
		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			sendJson(response, 400, { error: "malformed_body" });
			return true;
		}
		const deleteBody = body as { cascadeSubtree?: unknown };
		if (deleteBody.cascadeSubtree === true) {
			const refs = ctx.runtime.assets.hasIncomingCrossAssetRelations(assetId);
			if (refs.length > 0) {
				sendJson(response, 409, { error: "asset_referenced", refs });
				return true;
			}
			try {
				ctx.runtime.assets.deleteSubtree(assetId);
				sendJson(response, 200, { deleted: true });
			} catch (error) {
				if (sendAssetError(response, error)) return true;
				throw error;
			}
			return true;
		}
		if (ctx.runtime.assets.hasChildren(assetId)) {
			sendJson(response, 409, { error: "has_children" });
			return true;
		}
		try {
			if (!ctx.runtime.assets.deleteReusableAsset(assetId)) {
				sendJson(response, 404, { error: "unknown_asset" });
				return true;
			}
			sendJson(response, 200, { deleted: true });
		} catch (error) {
			if (error instanceof ReusableAssetReferencedError) {
				sendJson(response, 409, { error: "asset_referenced", refs: error.refs });
				return true;
			}
			throw error;
		}
		return true;
	}

	return false;
}
