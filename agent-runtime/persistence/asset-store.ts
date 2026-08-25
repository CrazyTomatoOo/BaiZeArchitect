import type Database from "better-sqlite3";
import type { FixtureClock } from "../testing/deterministic-fixtures.js";
import type { AssetGraph, AssetRelationExport, AssetRelationInput, AssetRelationRecord, ResolvedAssetGraph, ResolvedAssetRelation, ReusableAssetExportBundle } from "./asset-relations.js";
import { AssetRelationValidationError, isAssetRelationType, isValidAssetRelation } from "./asset-relations.js";
import type { ReusableAssetKind } from "./reusable-asset-kind.js";
import { parseJson } from "./json.js";
import type { SnapshotStore } from "./snapshot-store.js";

export class ReusableAssetMalformedBodyError extends Error {
	constructor() {
		super("Reusable Asset request body is malformed");
	}
}

export class ReusableAssetNameConflictError extends Error {
	constructor() {
		super("Reusable Asset stakeholder name conflicts within the workspace");
	}
}

export interface ReusableAssetSummary {
	id: number;
	workspaceId: number;
	kind: ReusableAssetKind;
	title: string;
	currentRevision: { id: number; revisionNo: number; digest: string } | null;
	legacyOriginRequirementId: number | null;
	createdAt: string;
}

export interface ReusableAssetDetail {
	id: number;
	workspaceId: number;
	kind: ReusableAssetKind;
	title: string;
	currentRevisionId: number | null;
	legacyOriginRequirementId: number | null;
	createdAt: string;
	resolvedGraph: ResolvedAssetGraph;
	revisions: readonly {
		id: number;
		revisionNo: number;
		contentDocumentId: number;
		digest: string;
		source: "manual" | "import" | "migration" | "workflow";
		content: unknown;
		createdAt: string;
	}[];
}

function normalizeStakeholderName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStakeholderDescription(value: unknown): string | undefined {
	if (value === undefined || value === null) return "";
	return typeof value === "string" ? value : undefined;
}

function normalizeStakeholderContent(content: unknown): { name: string; description: string } | undefined {
	if (typeof content !== "object" || content === null || Array.isArray(content)) return undefined;
	const record = content as { name?: unknown; description?: unknown };
	const name = normalizeStakeholderName(record.name);
	const description = normalizeStakeholderDescription(record.description);
	if (!name || description === undefined) return undefined;
	return { name, description };
}

function stakeholderNameKey(name: string): string {
	return name.trim().toLowerCase();
}

/**
 * asset-store.ts — Store（存储域）子域：Reusable Asset 资产库面。
 *
 * 不依赖 WorkspaceStore：workspace 存在性前置由 WorkflowStore 门面执行；
 * 资产内容文档经 SnapshotStore 内容寻址写入。浮引用语义（仅存 assetId），
 * workspace 内 stakeholder name 唯一（trim + 大小写不敏感）。
 * 子域边界见 docs/adr/ADR-006-store-subdomain-boundary.md。
 */
export class AssetStore {
	constructor(
		private readonly database: Database.Database,
		private readonly clock: FixtureClock,
		private readonly snapshotStore: SnapshotStore,
	) {}
	writeRelations(input: {
		workspaceId: number;
		fromAssetId: number;
		fromRevisionId: number;
		relations: readonly AssetRelationInput[];
	}): readonly AssetRelationRecord[] {
		const timestamp = this.clock.now().toISOString();
		const transaction = this.database.transaction(() => {
			const from = this.database
				.prepare("select id, kind, current_revision_id from reusable_assets where id = ? and workspace_id = ?")
				.get(input.fromAssetId, input.workspaceId) as { id: number; kind: ReusableAssetKind; current_revision_id: number | null } | undefined;
			const issues: Array<{ toAssetId?: number; type?: string; reason: string }> = [];
			if (!from) {
				throw new AssetRelationValidationError([{ reason: "unknown_from_asset" }]);
			}
			const fromRevision = this.database
				.prepare("select id from reusable_asset_revisions where id = ? and reusable_asset_id = ?")
				.get(input.fromRevisionId, input.fromAssetId) as { id: number } | undefined;
			if (!fromRevision || from.current_revision_id !== fromRevision.id) {
				throw new AssetRelationValidationError([{ reason: "stale_from_revision" }]);
			}
			const records: AssetRelationRecord[] = [];
			for (const relation of input.relations) {
				if (!isAssetRelationType(relation.type)) {
					issues.push({ toAssetId: relation.toAssetId, type: String(relation.type), reason: "unknown_relation_type" });
					continue;
				}
				const target = this.database
					.prepare("select id, kind, current_revision_id from reusable_assets where id = ? and workspace_id = ?")
					.get(relation.toAssetId, input.workspaceId) as { id: number; kind: ReusableAssetKind; current_revision_id: number | null } | undefined;
				if (!target) {
					issues.push({ toAssetId: relation.toAssetId, type: relation.type, reason: "unknown_asset" });
					continue;
				}
				if (target.id === from.id) {
					issues.push({ toAssetId: relation.toAssetId, type: relation.type, reason: "self_loop" });
					continue;
				}
				if (!isValidAssetRelation(from.kind, target.kind, relation.type)) {
					issues.push({ toAssetId: relation.toAssetId, type: relation.type, reason: "invalid_kind_pair" });
					continue;
				}
				if (target.current_revision_id === null) {
					issues.push({ toAssetId: relation.toAssetId, type: relation.type, reason: "target_without_revision" });
					continue;
				}
				this.database
					.prepare("insert or ignore into asset_relations(from_asset_id, to_asset_id, from_revision_id, to_revision_id, relationship_type, created_at) values (?, ?, ?, ?, ?, ?)")
					.run(input.fromAssetId, target.id, input.fromRevisionId, target.current_revision_id, relation.type, timestamp);
				const row = this.database
					.prepare("select id, from_asset_id, to_asset_id, from_revision_id, to_revision_id, relationship_type, created_at from asset_relations where from_asset_id = ? and to_asset_id = ? and relationship_type = ?")
					.get(input.fromAssetId, target.id, relation.type) as { id: number; from_asset_id: number; to_asset_id: number; from_revision_id: number; to_revision_id: number; relationship_type: string; created_at: string };
				records.push({
					id: row.id,
					fromAssetId: row.from_asset_id,
					toAssetId: row.to_asset_id,
					fromRevisionId: row.from_revision_id,
					toRevisionId: row.to_revision_id,
					type: row.relationship_type as AssetRelationRecord["type"],
					createdAt: row.created_at,
				});
			}
			if (issues.length > 0) {
				throw new AssetRelationValidationError(issues);
			}
			return records;
		}).immediate;
		return transaction();
	}

	readRelations(assetId: number): readonly AssetRelationRecord[] {
		const rows = this.database
			.prepare("select id, from_asset_id, to_asset_id, from_revision_id, to_revision_id, relationship_type, created_at from asset_relations where from_asset_id = ? or to_asset_id = ? order by id")
			.all(assetId, assetId) as Array<{ id: number; from_asset_id: number; to_asset_id: number; from_revision_id: number; to_revision_id: number; relationship_type: string; created_at: string }>;
		return rows.map((row) => ({
			id: row.id,
			fromAssetId: row.from_asset_id,
			toAssetId: row.to_asset_id,
			fromRevisionId: row.from_revision_id,
			toRevisionId: row.to_revision_id,
			type: row.relationship_type as AssetRelationRecord["type"],
			createdAt: row.created_at,
		}));
	}

	assetExistsByOriginArtifactId(workspaceId: number, artifactId: number): boolean {
		const row = this.database
			.prepare("select 1 as found from reusable_assets where workspace_id = ? and origin_artifact_id = ? limit 1")
			.get(workspaceId, artifactId) as { found: number } | undefined;
		return row !== undefined;
	}

	createReusableAsset(input: { workspaceId: number; kind: ReusableAssetKind; title: string; content: unknown; source?: "manual" | "import" | "migration" | "workflow"; legacyOriginRequirementId?: number | null; actorSnapshotDocumentId?: number | null; migrationAttestationDocumentId?: number | null }): { assetId: number; revisionId: number; revisionNo: number } {
		const timestamp = this.clock.now().toISOString();
		const content = input.kind === "stakeholder" ? normalizeStakeholderContent(input.content) : input.content;
		if (input.kind === "stakeholder" && !content) throw new ReusableAssetMalformedBodyError();
		const title = input.kind === "stakeholder" ? (content as { name: string }).name : input.title;
		const schemaRef = input.kind === "stakeholder" ? "asset/stakeholder/v1" : `artifact/${input.kind}/v1`;
		const transaction = this.database.transaction(() => {
			if (input.kind === "stakeholder" && this.stakeholderNameExists(input.workspaceId, (content as { name: string }).name)) {
				throw new ReusableAssetNameConflictError();
			}
			const document = this.snapshotStore.insertSnapshot("reusable_asset_content", schemaRef, content, timestamp);
			const assetId = Number(this.database
				.prepare("insert into reusable_assets(workspace_id, kind, title, current_revision_id, legacy_origin_requirement_id, created_at, updated_at) values (?, ?, ?, null, ?, ?, ?)")
				.run(input.workspaceId, input.kind, title, input.legacyOriginRequirementId ?? null, timestamp, timestamp).lastInsertRowid);
			const revisionId = Number(this.database
				.prepare("insert into reusable_asset_revisions(reusable_asset_id, revision_no, content_document_id, content_digest, source, actor_snapshot_document_id, migration_attestation_document_id, created_at) values (?, 1, ?, ?, ?, ?, ?, ?)")
				.run(assetId, document.id, document.digest, input.source ?? "manual", input.actorSnapshotDocumentId ?? null, input.migrationAttestationDocumentId ?? null, timestamp).lastInsertRowid);
			this.database.prepare("update reusable_assets set current_revision_id = ? where id = ?").run(revisionId, assetId);
			return { assetId, revisionId, revisionNo: 1 };
		}).immediate;
		return transaction();
	}

	/**
	 * #22 promote 入库：按 (workspace, kind, 标题) 归一 —— 存在则追加 revision，不存在新建。
	 * 带 workflow 溯源（来源需求/产物/批准记录）；source=workflow。幂等：重复 promote 同一产物
	 * （同 kind+标题）追加 revision 而不重复建资产。
	 */
	upsertReusableAssetByTitle(input: {
		workspaceId: number;
		kind: ReusableAssetKind;
		title: string;
		content: unknown;
		originRequirementId?: number | null;
		originArtifactId?: number | null;
		originApprovalId?: number | null;
	}): { assetId: number; revisionId: number; revisionNo: number; created: boolean } {
		const timestamp = this.clock.now().toISOString();
		if (input.kind === "stakeholder") throw new ReusableAssetMalformedBodyError();
		const transaction = this.database.transaction(() => {
			const existing = this.database
				.prepare("select id, current_revision_id from reusable_assets where workspace_id = ? and kind = ? and title = ? order by id desc limit 1")
				.get(input.workspaceId, input.kind, input.title) as { id: number; current_revision_id: number | null } | undefined;
			const document = this.snapshotStore.insertSnapshot("reusable_asset_content", `artifact/${input.kind}/v1`, input.content, timestamp);
			if (existing) {
				const currentNo = existing.current_revision_id === null
					? 0
					: (this.database.prepare("select revision_no from reusable_asset_revisions where id = ?").get(existing.current_revision_id) as { revision_no: number }).revision_no;
				const revisionNo = currentNo + 1;
				const revisionId = Number(this.database
					.prepare("insert into reusable_asset_revisions(reusable_asset_id, revision_no, content_document_id, content_digest, source, actor_snapshot_document_id, migration_attestation_document_id, created_at) values (?, ?, ?, ?, 'workflow', null, null, ?)")
					.run(existing.id, revisionNo, document.id, document.digest, timestamp).lastInsertRowid);
				// 溯源：追加 revision 后资产溯源更新为该 workflow promote 源（最新批准覆盖）
				this.database.prepare("update reusable_assets set current_revision_id = ?, origin_requirement_id = ?, origin_artifact_id = ?, origin_approval_id = ?, updated_at = ? where id = ?")
					.run(revisionId, input.originRequirementId ?? null, input.originArtifactId ?? null, input.originApprovalId ?? null, timestamp, existing.id);
				return { assetId: existing.id, revisionId, revisionNo, created: false };
			}
			const assetId = Number(this.database
				.prepare("insert into reusable_assets(workspace_id, kind, title, current_revision_id, legacy_origin_requirement_id, origin_requirement_id, origin_artifact_id, origin_approval_id, created_at, updated_at) values (?, ?, ?, null, null, ?, ?, ?, ?, ?)")
				.run(input.workspaceId, input.kind, input.title, input.originRequirementId ?? null, input.originArtifactId ?? null, input.originApprovalId ?? null, timestamp, timestamp).lastInsertRowid);
			const revisionId = Number(this.database
				.prepare("insert into reusable_asset_revisions(reusable_asset_id, revision_no, content_document_id, content_digest, source, actor_snapshot_document_id, migration_attestation_document_id, created_at) values (?, 1, ?, ?, 'workflow', null, null, ?)")
				.run(assetId, document.id, document.digest, timestamp).lastInsertRowid);
			this.database.prepare("update reusable_assets set current_revision_id = ? where id = ?").run(revisionId, assetId);
			return { assetId, revisionId, revisionNo: 1, created: true };
		}).immediate;
		return transaction();
	}

	updateStakeholderReusableAsset(assetId: number, patch: unknown): { revisionId: number; revisionNo: number } | undefined {
		if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw new ReusableAssetMalformedBodyError();
		const record = patch as { name?: unknown; description?: unknown };
		if (!("name" in record) && !("description" in record)) throw new ReusableAssetMalformedBodyError();
		const hasName = "name" in record;
		const hasDescription = "description" in record;
		const patchName = hasName ? normalizeStakeholderName(record.name) : undefined;
		const patchDescription = hasDescription ? normalizeStakeholderDescription(record.description) : undefined;
		if ((hasName && !patchName) || (hasDescription && patchDescription === undefined)) throw new ReusableAssetMalformedBodyError();
		const timestamp = this.clock.now().toISOString();
		const transaction = this.database.transaction(() => {
			const asset = this.database
				.prepare("select a.id, a.workspace_id, a.kind, a.current_revision_id, r.revision_no, d.content from reusable_assets a join reusable_asset_revisions r on r.id = a.current_revision_id join snapshot_documents d on d.id = r.content_document_id where a.id = ?")
				.get(assetId) as { id: number; workspace_id: number; kind: string; current_revision_id: number; revision_no: number; content: string } | undefined;
			if (!asset || asset.kind !== "stakeholder") return undefined;
			const current = normalizeStakeholderContent(parseJson<unknown>(asset.content));
			if (!current) throw new ReusableAssetMalformedBodyError();
			const next = {
				name: patchName ?? current.name,
				description: patchDescription ?? current.description,
			};
			if (this.stakeholderNameExists(asset.workspace_id, next.name, asset.id)) throw new ReusableAssetNameConflictError();
			const document = this.snapshotStore.insertSnapshot("reusable_asset_content", "asset/stakeholder/v1", next, timestamp);
			const revisionNo = asset.revision_no + 1;
			const revisionId = Number(this.database
				.prepare("insert into reusable_asset_revisions(reusable_asset_id, revision_no, content_document_id, content_digest, source, actor_snapshot_document_id, migration_attestation_document_id, created_at) values (?, ?, ?, ?, 'manual', null, null, ?)")
				.run(asset.id, revisionNo, document.id, document.digest, timestamp).lastInsertRowid);
			this.database.prepare("update reusable_assets set title = ?, current_revision_id = ?, updated_at = ? where id = ?").run(next.name, revisionId, timestamp, asset.id);
			return { revisionId, revisionNo };
		}).immediate;
		return transaction();
	}

	private stakeholderNameExists(workspaceId: number, name: string, excludeAssetId?: number): boolean {
		const rows = this.database
			.prepare("select a.id, d.content from reusable_assets a join reusable_asset_revisions r on r.id = a.current_revision_id join snapshot_documents d on d.id = r.content_document_id where a.workspace_id = ? and a.kind = 'stakeholder'")
			.all(workspaceId) as Array<{ id: number; content: string }>;
		const key = stakeholderNameKey(name);
		return rows.some((row) => row.id !== excludeAssetId && stakeholderNameKey(normalizeStakeholderContent(parseJson<unknown>(row.content))?.name ?? "") === key);
	}
	findStakeholderByName(workspaceId: number, name: string): { assetId: number; revisionId: number } | undefined {
		const key = stakeholderNameKey(name);
		const rows = this.database
			.prepare("select a.id, a.current_revision_id, d.content from reusable_assets a join reusable_asset_revisions r on r.id = a.current_revision_id join snapshot_documents d on d.id = r.content_document_id where a.workspace_id = ? and a.kind = 'stakeholder'")
			.all(workspaceId) as Array<{ id: number; current_revision_id: number; content: string }>;
		for (const row of rows) {
			const content = normalizeStakeholderContent(parseJson<unknown>(row.content));
			if (content && stakeholderNameKey(content.name) === key) return { assetId: row.id, revisionId: row.current_revision_id };
		}
		return undefined;
	}


	listReusableAssets(workspaceId: number): readonly ReusableAssetSummary[] {
		const rows = this.database
			.prepare("select a.id, a.kind, a.title, a.current_revision_id, a.legacy_origin_requirement_id, a.created_at, r.revision_no, r.content_digest from reusable_assets a left join reusable_asset_revisions r on r.id = a.current_revision_id where a.workspace_id = ? order by a.id")
			.all(workspaceId) as Array<{ id: number; kind: string; title: string; current_revision_id: number | null; legacy_origin_requirement_id: number | null; created_at: string; revision_no: number | null; content_digest: string | null }>;
		return rows.map((row) => ({
			id: row.id,
			workspaceId,
			kind: row.kind as ReusableAssetSummary["kind"],
			title: row.title,
			currentRevision: row.current_revision_id === null ? null : { id: row.current_revision_id, revisionNo: row.revision_no as number, digest: row.content_digest as string },
			legacyOriginRequirementId: row.legacy_origin_requirement_id,
			createdAt: row.created_at,
		}));
	}

	getResolvedAssetGraph(assetId: number): ResolvedAssetGraph {
		const rows = this.database
			.prepare(`select ar.from_asset_id, ar.to_asset_id, ar.from_revision_id, ar.to_revision_id, ar.relationship_type,
				case when ar.to_asset_id = ? then ar.from_revision_id else ar.to_revision_id end as peer_revision_id,
				case when ar.to_asset_id = ? then from_asset.title else to_asset.title end as peer_title,
				case when ar.to_asset_id = ? then from_asset.kind else to_asset.kind end as peer_kind
				from asset_relations ar
				join reusable_assets from_asset on from_asset.id = ar.from_asset_id
				join reusable_assets to_asset on to_asset.id = ar.to_asset_id
				where ar.from_asset_id = ? or ar.to_asset_id = ?
				order by ar.id`)
			.all(assetId, assetId, assetId, assetId, assetId) as Array<{
				from_asset_id: number;
				to_asset_id: number;
				from_revision_id: number;
				to_revision_id: number;
				relationship_type: string;
				peer_revision_id: number;
				peer_title: string;
				peer_kind: ReusableAssetKind;
			}>;
		const incoming: ResolvedAssetGraph["incoming"][number][] = [];
		const outgoing: ResolvedAssetGraph["outgoing"][number][] = [];
		for (const row of rows) {
			const peer = {
				assetId: row.to_asset_id === assetId ? row.from_asset_id : row.to_asset_id,
				revisionId: row.peer_revision_id,
				type: row.relationship_type as ResolvedAssetRelation["type"],
				title: row.peer_title,
				kind: row.peer_kind,
			};
			if (row.to_asset_id === assetId) incoming.push(peer);
			else outgoing.push(peer);
		}
		return { incoming, outgoing };
	}

	getWorkspaceAssetGraph(workspaceId: number): AssetGraph {
		const nodes = this.database
			.prepare("select id, kind, title from reusable_assets where workspace_id = ? order by id")
			.all(workspaceId) as Array<{ id: number; kind: ReusableAssetKind; title: string }>;
		const edges = this.database
			.prepare(`select ar.from_asset_id, ar.to_asset_id, ar.relationship_type
				from asset_relations ar
				join reusable_assets from_asset on from_asset.id = ar.from_asset_id
				join reusable_assets to_asset on to_asset.id = ar.to_asset_id
				where from_asset.workspace_id = ? and to_asset.workspace_id = ?
				order by ar.id`)
			.all(workspaceId, workspaceId) as Array<{ from_asset_id: number; to_asset_id: number; relationship_type: string }>;
		return {
			nodes: nodes.map((node) => ({ assetId: node.id, kind: node.kind, title: node.title })),
			edges: edges.map((edge) => ({ fromAssetId: edge.from_asset_id, toAssetId: edge.to_asset_id, type: edge.relationship_type as AssetGraph["edges"][number]["type"] })),
		};
	}

	getReusableAsset(assetId: number): ReusableAssetDetail | undefined {
		const asset = this.database
			.prepare("select id, workspace_id, kind, title, current_revision_id, legacy_origin_requirement_id, created_at from reusable_assets where id = ?")
			.get(assetId) as { id: number; workspace_id: number; kind: string; title: string; current_revision_id: number | null; legacy_origin_requirement_id: number | null; created_at: string } | undefined;
		if (!asset) return undefined;
		const revisions = this.database
			.prepare("select r.id, r.revision_no, r.content_document_id, r.content_digest, r.source, r.created_at, d.content from reusable_asset_revisions r join snapshot_documents d on d.id = r.content_document_id where r.reusable_asset_id = ? order by r.revision_no")
			.all(assetId) as Array<{ id: number; revision_no: number; content_document_id: number; content_digest: string; source: string; created_at: string; content: string }>;
		return {
			id: asset.id,
			workspaceId: asset.workspace_id,
			kind: asset.kind as ReusableAssetDetail["kind"],
			title: asset.title,
			currentRevisionId: asset.current_revision_id,
			legacyOriginRequirementId: asset.legacy_origin_requirement_id,
			createdAt: asset.created_at,
			resolvedGraph: this.getResolvedAssetGraph(asset.id),
			revisions: revisions.map((revision) => ({
				id: revision.id,
				revisionNo: revision.revision_no,
				contentDocumentId: revision.content_document_id,
				digest: revision.content_digest,
				source: revision.source as "manual" | "import" | "migration",
				content: parseJson<unknown>(revision.content),
				createdAt: revision.created_at,
			})),
		};
	}

	deleteReusableAsset(assetId: number): boolean {
		const transaction = this.database.transaction(() => {
			const asset = this.database.prepare("select id from reusable_assets where id = ?").get(assetId) as { id: number } | undefined;
			if (!asset) return false;
			// revisions 由 reusable_asset_revisions.reusable_asset_id 的 on delete cascade 连带删除（0011 语义）
			this.database.prepare("delete from reusable_assets where id = ?").run(assetId);
			return true;
		}).immediate;
		return transaction();
	}

	exportReusableAssets(workspaceId: number): readonly ReusableAssetDetail[] {
		return this.listReusableAssets(workspaceId)
			.map((summary) => this.getReusableAsset(summary.id))
			.filter((detail): detail is ReusableAssetDetail => detail !== undefined);
	}
	exportReusableAssetBundle(workspaceId: number): ReusableAssetExportBundle {
		const assets = this.exportReusableAssets(workspaceId);
		const relations = this.database
			.prepare(`select from_asset.title as from_title, from_asset.kind as from_kind,
				to_asset.title as to_title, to_asset.kind as to_kind, ar.relationship_type
				from asset_relations ar
				join reusable_assets from_asset on from_asset.id = ar.from_asset_id
				join reusable_assets to_asset on to_asset.id = ar.to_asset_id
				where from_asset.workspace_id = ? and to_asset.workspace_id = ?
				order by ar.id`)
			.all(workspaceId, workspaceId) as Array<{ from_title: string; from_kind: ReusableAssetKind; to_title: string; to_kind: ReusableAssetKind; relationship_type: string }>;
		return {
			assets,
			relations: relations.map((relation): AssetRelationExport => ({
				fromTitle: relation.from_title,
				fromKind: relation.from_kind,
				toTitle: relation.to_title,
				toKind: relation.to_kind,
				type: relation.relationship_type as AssetRelationExport["type"],
			})),
		};
	}


	importReusableAssets(workspaceId: number, assets: readonly { kind: ReusableAssetKind; title: string; content: unknown; provenanceDigest?: string }[]): readonly number[] {
		const ids: number[] = [];
		const transaction = this.database.transaction(() => {
			for (const asset of assets) {
				const created = this.createReusableAsset({ workspaceId, kind: asset.kind, title: asset.title, content: asset.content, source: "import" });
				ids.push(created.assetId);
			}
		}).immediate;
		transaction();
		return ids;
	}
	importReusableAssetBundle(
		workspaceId: number,
		assets: readonly { kind: ReusableAssetKind; title: string; content: unknown }[],
		relations?: readonly AssetRelationExport[],
	): readonly number[] {
		const ids: number[] = [];
		const relationRows = relations ?? [];
		const transaction = this.database.transaction(() => {
			const assetsByKey = new Map<string, { assetId: number; revisionId: number; kind: ReusableAssetKind }>();
			for (const asset of assets) {
				const key = `${asset.kind}\u0000${asset.title}`;
				const existing = this.database
					.prepare("select id, current_revision_id from reusable_assets where workspace_id = ? and kind = ? and title = ? order by id desc limit 1")
					.get(workspaceId, asset.kind, asset.title) as { id: number; current_revision_id: number | null } | undefined;
				let assetId: number;
				let revisionId: number;
				if (existing?.current_revision_id !== null && existing !== undefined) {
					assetId = existing.id;
					revisionId = existing.current_revision_id;
				} else {
					const created = this.createReusableAsset({ workspaceId, kind: asset.kind, title: asset.title, content: asset.content, source: "import" });
					assetId = created.assetId;
					revisionId = created.revisionId;
				}
				assetsByKey.set(key, { assetId, revisionId, kind: asset.kind });
				ids.push(assetId);
			}
			const issues: Array<{ reason: string; type?: string }> = [];
			const relationGroups = new Map<number, { fromRevisionId: number; relations: AssetRelationInput[] }>();
			for (const relation of relationRows) {
				const from = assetsByKey.get(`${relation.fromKind}\u0000${relation.fromTitle}`);
				const to = assetsByKey.get(`${relation.toKind}\u0000${relation.toTitle}`);
				if (!from || !to) {
					issues.push({ reason: "unknown_import_asset", type: relation.type });
					continue;
				}
				if (from.assetId === to.assetId) {
					issues.push({ reason: "self_loop", type: relation.type });
					continue;
				}
				if (!isAssetRelationType(relation.type)) {
					issues.push({ reason: "unknown_relation_type", type: relation.type });
					continue;
				}
				if (!isValidAssetRelation(from.kind, to.kind, relation.type)) {
					issues.push({ reason: "invalid_kind_pair", type: relation.type });
					continue;
				}
				const group = relationGroups.get(from.assetId) ?? { fromRevisionId: from.revisionId, relations: [] };
				group.relations.push({ toAssetId: to.assetId, type: relation.type });
				relationGroups.set(from.assetId, group);
			}
			if (issues.length > 0) throw new AssetRelationValidationError(issues);
			if (relations !== undefined) {
				for (const assetId of new Set([...assetsByKey.values()].map((asset) => asset.assetId))) {
					this.database.prepare("delete from asset_relations where from_asset_id = ?").run(assetId);
				}
			}
			for (const [fromAssetId, group] of relationGroups) {
				this.writeRelations({ workspaceId, fromAssetId, fromRevisionId: group.fromRevisionId, relations: group.relations });
			}
			return ids;
		}).immediate;
		return transaction();
	}
}