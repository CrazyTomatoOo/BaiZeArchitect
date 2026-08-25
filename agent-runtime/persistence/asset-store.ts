import type Database from "better-sqlite3";
import type { FixtureClock } from "../testing/deterministic-fixtures.js";
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
}