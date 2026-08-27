import type Database from "better-sqlite3";
import type { FixtureClock } from "../testing/deterministic-fixtures.js";
import type { AssetGraph, AssetRelationExport, AssetRelationInput, AssetRelationRecord, ResolvedAssetGraph, ResolvedAssetRelation, ReusableAssetExportBundle } from "./asset-relations.js";
import { AssetRelationValidationError, isAssetRelationType, isValidAssetRelation } from "./asset-relations.js";
import { REUSABLE_ASSET_KINDS, type ReusableAssetKind } from "./reusable-asset-kind.js";
import { parseJson } from "./json.js";
import type { SnapshotStore } from "./snapshot-store.js";
import { validateAssetContent, pointer, type AssetValidationError, type AssetContentValidationError } from "./asset-content-validator.js";

export class ReusableAssetMalformedBodyError extends Error {
	readonly validationErrors?: readonly AssetValidationError[];
	constructor(validationErrors?: readonly AssetValidationError[]) {
		super("Reusable Asset request body is malformed");
		this.validationErrors = validationErrors;
	}
}

export class ReusableAssetNameConflictError extends Error {
	constructor() {
		super("Reusable Asset stakeholder name conflicts within the workspace");
	}
}
export class ReusableAssetVersionConflictError extends Error {
	constructor() {
		super("Reusable Asset revision is stale");
		this.name = "ReusableAssetVersionConflictError";
	}
}
export class ReusableAssetReferencedError extends Error {
	constructor(readonly refs: readonly { assetId: number; kind: ReusableAssetKind; title: string; type: string }[]) {
		super("Reusable Asset is referenced by other assets");
	}
}

export interface ReusableAssetSummary {
	id: number;
	workspaceId: number;
	kind: ReusableAssetKind;
	title: string;
	currentRevision: { id: number; revisionNo: number; digest: string; source: "manual" | "import" | "migration" | "workflow" } | null;
	legacyOriginRequirementId: number | null;
	createdAt: string;
}

export interface ReusableAssetListQuery {
	page?: number;
	pageSize?: number;
	kind?: ReusableAssetKind;
	q?: string;
}

export interface ReusableAssetPage {
	assets: readonly ReusableAssetSummary[];
	total: number;
	page: number;
	pageSize: number;
	kindCounts: Readonly<Record<ReusableAssetKind, number>>;
}

type ReusableAssetSummaryRow = {
	id: number;
	kind: string;
	title: string;
	current_revision_id: number | null;
	legacy_origin_requirement_id: number | null;
	created_at: string;
	revision_no: number | null;
	content_digest: string | null;
	source: string | null;
};

function toReusableAssetSummary(workspaceId: number, row: ReusableAssetSummaryRow): ReusableAssetSummary {
	return {
		id: row.id,
		workspaceId,
		kind: row.kind as ReusableAssetKind,
		title: row.title,
		currentRevision: row.current_revision_id === null ? null : { id: row.current_revision_id, revisionNo: row.revision_no as number, digest: row.content_digest as string, source: row.source as "manual" | "import" | "migration" | "workflow" },
		legacyOriginRequirementId: row.legacy_origin_requirement_id,
		createdAt: row.created_at,
	};
}

export interface ReusableAssetDetail {
	id: number;
	workspaceId: number;
	kind: ReusableAssetKind;
	title: string;
		currentRevisionId: number | null;
		legacyOriginRequirementId: number | null;
		originRequirementId: number | null;
		originArtifactId: number | null;
		originApprovalId: number | null;
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
const HIERARCHY_ASSET_KINDS: Record<string, true> = { "scenario-domain": true, "scenario": true, "scenario-variant": true, "function-domain": true, "function-item": true, "function-point": true };

interface StructuredAssetValidator {
	check(value: unknown): boolean;
}

function promotedAssetDocument(kind: "scenario" | "usecase" | "function" | "design" | "architecture" | "data" | "api", item: Record<string, unknown>): Record<string, unknown> {
	const common = { schemaVersion: `artifact/${kind}/v1`, artifactKind: kind, summary: "Reusable Asset item", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }] };
	switch (kind) {
		case "scenario": return { ...common, domains: [{ nodeId: "d1", title: "Domain", scenarios: [{ nodeId: "s1", title: "Scenario", variants: [item] }] }] };
		case "usecase": return { ...common, useCases: [item] };
		case "function": return { ...common, domains: [{ nodeId: "d1", title: "Domain", items: [{ nodeId: "i1", title: "Item", points: [item] }] }] };
		case "design": return { ...common, changeUnits: [item], alternatives: ["manual"], failureHandling: ["manual"], testStrategy: ["manual"], implementationOrder: ["manual"], rolloutStrategy: "manual", rollbackStrategy: "manual" };
		case "architecture": return { ...common, components: [item], relationships: [], constraints: [], nonFunctionalRequirements: ["manual"] };
		case "data": return { ...common, entities: [item], relations: [] };
		case "api": return { ...common, openapi: "3.1.0", info: { title: "API", version: "1" }, paths: {} };
	}
}

function normalizeHierarchyAssetContent(kind: string, content: unknown): Record<string, unknown> | undefined {
	if (typeof content !== "object" || content === null || Array.isArray(content)) return undefined;
	const record = content as Record<string, unknown>;
	if (typeof record.nodeId !== "string" || record.nodeId.length === 0) return undefined;
	if (kind !== "function-point") {
		if (typeof record.title !== "string" || record.title.length === 0) return undefined;
	}
	if (kind === "scenario-variant") {
		const actors = Array.isArray(record.actors) ? record.actors : [];
		const mainFlow = Array.isArray(record.mainFlow) ? record.mainFlow : [];
		if (actors.length === 0 || mainFlow.length === 0) return undefined;
		if (typeof record.trigger !== "string" || record.trigger.length === 0) return undefined;
		if (typeof record.expectedOutcome !== "string" || record.expectedOutcome.length === 0) return undefined;
	} else if (kind === "function-point") {
		if (typeof record.name !== "string" || record.name.length === 0) return undefined;
		if (typeof record.responsibility !== "string" || record.responsibility.length === 0) return undefined;
		const acceptanceCriteria = Array.isArray(record.acceptanceCriteria) ? record.acceptanceCriteria : [];
		if (acceptanceCriteria.length === 0) return undefined;
	}
	return record;
}

function validateStructuredAssetContent(kind: ReusableAssetKind, content: unknown, validator: StructuredAssetValidator | undefined, strict: boolean): readonly AssetValidationError[] {
	if (kind === "stakeholder") return normalizeStakeholderContent(content) === undefined ? [{ type: "invalid_stakeholder", path: "", message: "stakeholder content must have name and description" }] : [];
	if (typeof content !== "object" || content === null || Array.isArray(content)) return [{ type: "invalid_content", path: "", message: "Content must be an object" }];
	const record = content as Record<string, unknown>;
	if (record.schemaVersion === `artifact/${kind}/v1`) {
		if (record.artifactKind !== kind) return [{ type: "invalid_artifact_kind", path: pointer("artifactKind"), message: `artifactKind must be ${kind}` }];
		if (!validator) return [];
		const sourceRefs = Array.isArray(record.sourceRefs) && record.sourceRefs.length > 0
			? record.sourceRefs
			: [{ type: "requirement_revision", revisionId: 1 }];
	if (!validator.check({ ...record, sourceRefs })) return [{ type: "schema_validation_failed", path: "", message: "Content failed artifact schema validation" }];
	if (kind === "api" || kind === "data" || kind === "architecture") return validateAssetContent(kind, record);
	return [];
	}
	if (HIERARCHY_ASSET_KINDS[kind] === true) {
		const normalized = normalizeHierarchyAssetContent(kind, content);
		if (!normalized) return validateAssetContent(kind, content);
		return [];
	}
	if (!("schemaVersion" in record) && !("artifactKind" in record)) {
		if (strict) {
			if (!validator || !validator.check(promotedAssetDocument(kind as "scenario" | "usecase" | "function" | "design" | "architecture" | "data" | "api", record))) {
				return [{ type: "schema_validation_failed", path: "", message: "Content failed schema validation" }];
			}
			return validateAssetContent(kind, record);
		}
		return [];
	}
	return [{ type: "invalid_schema_version", path: pointer("schemaVersion"), message: `schemaVersion must be artifact/${kind}/v1` }];
}



function sourceReferencesFingerprint(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(sourceReferencesFingerprint).join(",")}]`;
	if (typeof value !== "object" || value === null) return "";
	const record = value as Record<string, unknown>;
	return Object.entries(record)
		.flatMap(([key, child]) => key === "sourceRefs" ? [`sourceRefs:${JSON.stringify(child)}`] : [sourceReferencesFingerprint(child)].filter((entry) => entry.length > 0))
		.sort()
		.join("|");
}

export interface ImportPreview {
	summary: {
		createCount: number;
		reuseCount: number;
		relationChanges: number;
		kindBreakdown: Record<string, number>;
		pathConflicts: number;
		validationErrors: Array<{ title: string; errors: readonly AssetValidationError[] }>;
	};
	previewDigest: string;
}

export class ImportDigestConflictError extends Error {
	constructor() {
		super("Import preview digest does not match");
		this.name = "ImportDigestConflictError";
	}
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
		private readonly structuredValidator?: StructuredAssetValidator,
		private readonly hashProvider?: { digest(value: string): string },
	) {}
	writeRelations(input: {
		workspaceId: number;
		fromAssetId: number;
		fromRevisionId: number;
		relations: readonly AssetRelationInput[];
	}): readonly AssetRelationRecord[] {
		const timestamp = this.clock.now().toISOString();
		const write = (): AssetRelationRecord[] => {
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
				.prepare("insert or ignore into asset_relations(from_asset_id, to_asset_id, from_revision_id, to_revision_id, relationship_type, position, created_at) values (?, ?, ?, ?, ?, ?, ?)")
				.run(input.fromAssetId, target.id, input.fromRevisionId, target.current_revision_id, relation.type, relation.position ?? 0, timestamp);
			const row = this.database
				.prepare("select id, from_asset_id, to_asset_id, from_revision_id, to_revision_id, relationship_type, position, created_at from asset_relations where from_asset_id = ? and to_asset_id = ? and relationship_type = ?")
				.get(input.fromAssetId, target.id, relation.type) as { id: number; from_asset_id: number; to_asset_id: number; from_revision_id: number; to_revision_id: number; relationship_type: string; position: number; created_at: string };
			records.push({
				id: row.id,
				fromAssetId: row.from_asset_id,
				toAssetId: row.to_asset_id,
				fromRevisionId: row.from_revision_id,
				toRevisionId: row.to_revision_id,
				type: row.relationship_type as AssetRelationRecord["type"],
				position: row.position,
				createdAt: row.created_at,
			});
		}
			if (issues.length > 0) {
				throw new AssetRelationValidationError(issues);
			}
			return records;
		};
		const transaction = this.database.inTransaction ? write : this.database.transaction(write).immediate;
		return transaction();
	}

	readRelations(assetId: number): readonly AssetRelationRecord[] {
		const rows = this.database
		.prepare("select id, from_asset_id, to_asset_id, from_revision_id, to_revision_id, relationship_type, position, created_at from asset_relations where from_asset_id = ? or to_asset_id = ? order by id")
		.all(assetId, assetId) as Array<{ id: number; from_asset_id: number; to_asset_id: number; from_revision_id: number; to_revision_id: number; relationship_type: string; position: number; created_at: string }>;
		return rows.map((row) => ({
			id: row.id,
			fromAssetId: row.from_asset_id,
			toAssetId: row.to_asset_id,
			fromRevisionId: row.from_revision_id,
			toRevisionId: row.to_revision_id,
			type: row.relationship_type as AssetRelationRecord["type"],
			position: row.position,
			createdAt: row.created_at,
		}));
	}

	assetExistsByOriginArtifactId(workspaceId: number, artifactId: number): boolean {
		const row = this.database
			.prepare("select 1 as found from reusable_assets where workspace_id = ? and origin_artifact_id = ? limit 1")
			.get(workspaceId, artifactId) as { found: number } | undefined;
		return row !== undefined;
	}

	createReusableAsset(input: { workspaceId: number; kind: ReusableAssetKind; title: string; content: unknown; source?: "manual" | "import" | "migration" | "workflow"; strict?: boolean; legacyOriginRequirementId?: number | null; actorSnapshotDocumentId?: number | null; migrationAttestationDocumentId?: number | null }): { assetId: number; revisionId: number; revisionNo: number } {
		const timestamp = this.clock.now().toISOString();
		const content = input.kind === "stakeholder" ? normalizeStakeholderContent(input.content) : input.content;
		if (input.kind === "stakeholder" && !content) throw new ReusableAssetMalformedBodyError([{ type: "invalid_stakeholder", path: "", message: "stakeholder content must have name and description" }]);
		const contentErrors = validateStructuredAssetContent(input.kind, content, this.structuredValidator, input.strict === true);
		if (contentErrors.length > 0) throw new ReusableAssetMalformedBodyError(contentErrors);
		const title = input.kind === "stakeholder" ? (content as { name: string }).name : input.title;
	const schemaRef = input.kind === "stakeholder" ? "asset/stakeholder/v1" : typeof content === "object" && content !== null && !Array.isArray(content) && (content as Record<string, unknown>).schemaVersion === `artifact/${input.kind}/v1` ? `artifact/${input.kind}/v1` : HIERARCHY_ASSET_KINDS[input.kind] === true ? `asset/${input.kind}/v1` : `artifact/${input.kind}/v1`;
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

	updateReusableAsset(input: {
		workspaceId: number;
		assetId: number;
		expectedRevisionId: number;
		title: string;
		content: unknown;
		relations: readonly AssetRelationInput[];
	}): { assetId: number; revisionId: number; revisionNo: number } | undefined {
		const timestamp = this.clock.now().toISOString();
		const transaction = this.database.transaction(() => {
			const asset = this.database
				.prepare(`select a.id, a.workspace_id, a.kind, a.current_revision_id, a.origin_artifact_id, r.revision_no, d.content
					from reusable_assets a
					left join reusable_asset_revisions r on r.id = a.current_revision_id
					left join snapshot_documents d on d.id = r.content_document_id
					where a.id = ? and a.workspace_id = ?`)
				.get(input.assetId, input.workspaceId) as { id: number; workspace_id: number; kind: ReusableAssetKind; current_revision_id: number | null; origin_artifact_id: number | null; revision_no: number | null; content: string | null } | undefined;
			if (!asset) return undefined;
			if (asset.current_revision_id !== input.expectedRevisionId) throw new ReusableAssetVersionConflictError();
			const title = input.title.trim();
			if (title.length === 0) throw new ReusableAssetMalformedBodyError();
			const stakeholderContent = asset.kind === "stakeholder" ? normalizeStakeholderContent(input.content) : undefined;
			const content = asset.kind === "stakeholder" ? stakeholderContent : input.content;
			const updateErrors = validateStructuredAssetContent(asset.kind, content, this.structuredValidator, true);
			if (updateErrors.length > 0) throw new ReusableAssetMalformedBodyError(updateErrors);
			if (asset.kind === "stakeholder" && this.stakeholderNameExists(input.workspaceId, title, asset.id)) throw new ReusableAssetNameConflictError();
			if (asset.origin_artifact_id !== null && asset.content !== null && sourceReferencesFingerprint(parseJson<unknown>(asset.content)) !== sourceReferencesFingerprint(content)) {
				throw new ReusableAssetMalformedBodyError();
			}
			const document = this.snapshotStore.insertSnapshot("reusable_asset_content", asset.kind === "stakeholder" ? "asset/stakeholder/v1" : `artifact/${asset.kind}/v1`, content, timestamp);
			const revisionNo = (asset.revision_no ?? 0) + 1;
			const revisionId = Number(this.database
				.prepare("insert into reusable_asset_revisions(reusable_asset_id, revision_no, content_document_id, content_digest, source, actor_snapshot_document_id, migration_attestation_document_id, created_at) values (?, ?, ?, ?, 'manual', null, null, ?)")
				.run(asset.id, revisionNo, document.id, document.digest, timestamp).lastInsertRowid);
			this.database.prepare("update reusable_assets set title = ?, current_revision_id = ?, updated_at = ? where id = ?").run(title, revisionId, timestamp, asset.id);
			this.database.prepare("delete from asset_relations where from_asset_id = ?").run(asset.id);
			if (input.relations.length > 0) {
				this.writeRelations({ workspaceId: input.workspaceId, fromAssetId: asset.id, fromRevisionId: revisionId, relations: input.relations });
			}
			return { assetId: asset.id, revisionId, revisionNo };
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
	deleteOutgoingRelations(assetId: number, type: AssetRelationRecord["type"]): void {
		this.database.prepare("delete from asset_relations where from_asset_id = ? and relationship_type = ?").run(assetId, type);
	}


	listReusableAssets(workspaceId: number): readonly ReusableAssetSummary[] {
		const rows = this.database
			.prepare("select a.id, a.kind, a.title, a.current_revision_id, a.legacy_origin_requirement_id, a.created_at, r.revision_no, r.content_digest, r.source from reusable_assets a left join reusable_asset_revisions r on r.id = a.current_revision_id where a.workspace_id = ? order by a.id")
			.all(workspaceId) as ReusableAssetSummaryRow[];
		return rows.map((row) => toReusableAssetSummary(workspaceId, row));
	}

	listReusableAssetPage(workspaceId: number, query: ReusableAssetListQuery = {}): ReusableAssetPage {
		const page = Number.isInteger(query.page) && (query.page as number) > 0 ? query.page as number : 1;
		const pageSize = Number.isInteger(query.pageSize) && (query.pageSize as number) > 0 ? query.pageSize as number : 12;
		const normalizedQuery = typeof query.q === "string" ? query.q.trim().toLowerCase() : "";
		const conditions = ["a.workspace_id = ?"];
		const parameters: Array<number | string> = [workspaceId];
		if (query.kind !== undefined) {
			conditions.push("a.kind = ?");
			parameters.push(query.kind);
		}
		if (normalizedQuery.length > 0) {
			conditions.push("instr(lower(a.title), ?) > 0");
			parameters.push(normalizedQuery);
		}
		const where = conditions.join(" and ");
		const total = (this.database
			.prepare(`select count(*) as count from reusable_assets a where ${where}`)
			.get(...parameters) as { count: number }).count;
		const rows = this.database
			.prepare(`select a.id, a.kind, a.title, a.current_revision_id, a.legacy_origin_requirement_id, a.created_at, r.revision_no, r.content_digest, r.source
				from reusable_assets a
				left join reusable_asset_revisions r on r.id = a.current_revision_id
				where ${where}
				order by a.id desc
				limit ? offset ?`)
			.all(...parameters, pageSize, (page - 1) * pageSize) as ReusableAssetSummaryRow[];
		const kindCounts = Object.fromEntries(REUSABLE_ASSET_KINDS.map((kind) => [kind, 0])) as Record<ReusableAssetKind, number>;
		const countRows = this.database
			.prepare("select kind, count(*) as count from reusable_assets where workspace_id = ? group by kind")
			.all(workspaceId) as Array<{ kind: ReusableAssetKind; count: number }>;
		for (const row of countRows) kindCounts[row.kind] = row.count;
		return { assets: rows.map((row) => toReusableAssetSummary(workspaceId, row)), total, page, pageSize, kindCounts };
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
			.prepare("select id, workspace_id, kind, title, current_revision_id, legacy_origin_requirement_id, origin_requirement_id, origin_artifact_id, origin_approval_id, created_at from reusable_assets where id = ?")
			.get(assetId) as { id: number; workspace_id: number; kind: string; title: string; current_revision_id: number | null; legacy_origin_requirement_id: number | null; origin_requirement_id: number | null; origin_artifact_id: number | null; origin_approval_id: number | null; created_at: string } | undefined;
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
			originRequirementId: asset.origin_requirement_id,
			originArtifactId: asset.origin_artifact_id,
			originApprovalId: asset.origin_approval_id,
			createdAt: asset.created_at,
			resolvedGraph: this.getResolvedAssetGraph(asset.id),
			revisions: revisions.map((revision) => ({
				id: revision.id,
				revisionNo: revision.revision_no,
				contentDocumentId: revision.content_document_id,
				digest: revision.content_digest,
				source: revision.source as "manual" | "import" | "migration" | "workflow",
				content: parseJson<unknown>(revision.content),
				createdAt: revision.created_at,
			})),
		};
	}

	deleteReusableAsset(assetId: number): boolean {
		const transaction = this.database.transaction(() => {
			const asset = this.database.prepare("select id from reusable_assets where id = ?").get(assetId) as { id: number } | undefined;
			if (!asset) return false;
			const refs = this.database
				.prepare(`select case when relation.from_asset_id = ? then to_asset.id else from_asset.id end as asset_id,
					case when relation.from_asset_id = ? then to_asset.kind else from_asset.kind end as kind,
					case when relation.from_asset_id = ? then to_asset.title else from_asset.title end as title,
					relation.relationship_type
					from asset_relations relation
					join reusable_assets from_asset on from_asset.id = relation.from_asset_id
					join reusable_assets to_asset on to_asset.id = relation.to_asset_id
					where relation.from_asset_id = ? or relation.to_asset_id = ?
					order by relation.id`)
				.all(assetId, assetId, assetId, assetId, assetId) as Array<{ asset_id: number; kind: ReusableAssetKind; title: string; relationship_type: string }>;
			if (refs.length > 0) {
				throw new ReusableAssetReferencedError(refs.map((ref) => ({ assetId: ref.asset_id, kind: ref.kind, title: ref.title, type: ref.relationship_type })));
			}
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
			to_asset.title as to_title, to_asset.kind as to_kind, ar.relationship_type, ar.position
				from asset_relations ar
				join reusable_assets from_asset on from_asset.id = ar.from_asset_id
				join reusable_assets to_asset on to_asset.id = ar.to_asset_id
				where from_asset.workspace_id = ? and to_asset.workspace_id = ?
				order by ar.id`)
		.all(workspaceId, workspaceId) as Array<{ from_title: string; from_kind: ReusableAssetKind; to_title: string; to_kind: ReusableAssetKind; relationship_type: string; position: number }>;
		return {
			assets,
			relations: relations.map((relation): AssetRelationExport => ({
				fromTitle: relation.from_title,
				fromKind: relation.from_kind,
				toTitle: relation.to_title,
				toKind: relation.to_kind,
				type: relation.relationship_type as AssetRelationExport["type"],
				position: relation.position,
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
		strict = false,
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
					const created = this.createReusableAsset({ workspaceId, kind: asset.kind, title: asset.title, content: asset.content, source: "import", strict });
					assetId = created.assetId;
					revisionId = created.revisionId;
				}
				assetsByKey.set(key, { assetId, revisionId, kind: asset.kind });
				ids.push(assetId);
			}
			const issues: Array<{ reason: string; type?: string; fromTitle?: string; fromKind?: ReusableAssetKind; toTitle?: string; toKind?: ReusableAssetKind }> = [];
			const relationGroups = new Map<number, { fromRevisionId: number; relations: AssetRelationInput[] }>();
			for (const relation of relationRows) {
				const from = assetsByKey.get(`${relation.fromKind}\u0000${relation.fromTitle}`);
				const to = assetsByKey.get(`${relation.toKind}\u0000${relation.toTitle}`);
				const context = { fromTitle: relation.fromTitle, fromKind: relation.fromKind, toTitle: relation.toTitle, toKind: relation.toKind, type: relation.type };
				if (!from || !to) {
					issues.push({ ...context, reason: "unknown_import_asset" });
					continue;
				}
				if (from.assetId === to.assetId) {
					issues.push({ ...context, reason: "self_loop" });
					continue;
				}
				if (!isAssetRelationType(relation.type)) {
					issues.push({ ...context, reason: "unknown_relation_type" });
					continue;
				}
				if (!isValidAssetRelation(from.kind, to.kind, relation.type)) {
					issues.push({ ...context, reason: "invalid_kind_pair" });
					continue;
				}
				const group = relationGroups.get(from.assetId) ?? { fromRevisionId: from.revisionId, relations: [] };
			group.relations.push({ toAssetId: to.assetId, type: relation.type, position: relation.position });
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

	previewImportBundle(workspaceId: number, assets: readonly { kind: ReusableAssetKind; title: string; content: unknown }[], relations?: readonly AssetRelationExport[]): ImportPreview {
		const previewAssets = assets.map((a) => this.normalizeImportAsset(a));
		const createCount: number[] = [];
		const reuseCount: number[] = [];
		const kindBreakdown: Record<string, number> = {};
		const validationErrors: Array<{ title: string; errors: readonly AssetValidationError[] }> = [];
		for (const asset of previewAssets) {
			kindBreakdown[asset.kind] = (kindBreakdown[asset.kind] ?? 0) + 1;
			const existing = this.findAssetByNodePath(workspaceId, asset.kind, asset.content);
			if (existing) {
				reuseCount.push(existing.assetId);
			} else {
				const errors = validateStructuredAssetContent(asset.kind, asset.content, this.structuredValidator, true);
				if (errors.length > 0) validationErrors.push({ title: asset.title, errors });
				else createCount.push(0);
			}
		}
		const bundleJson = JSON.stringify({ assets: previewAssets, relations: relations ?? [] });
	const previewDigest = this.hashProvider?.digest(bundleJson) ?? this.clock.now().toISOString();
		return {
			summary: {
				createCount: createCount.length,
				reuseCount: reuseCount.length,
				relationChanges: relations?.length ?? 0,
				kindBreakdown,
				pathConflicts: 0,
				validationErrors,
			},
			previewDigest,
		};
	}

	commitImportBundle(workspaceId: number, assets: readonly { kind: ReusableAssetKind; title: string; content: unknown }[], relations: readonly AssetRelationExport[], previewDigest: string): readonly number[] {
		const bundleJson = JSON.stringify({ assets: assets.map((a) => this.normalizeImportAsset(a)), relations });
	const computedDigest = this.hashProvider?.digest(bundleJson) ?? this.clock.now().toISOString();
		if (computedDigest !== previewDigest) {
			throw new ImportDigestConflictError();
		}
		return this.importReusableAssetBundle(workspaceId, assets.map((a) => this.normalizeImportAsset(a)), relations, true);
	}

	private normalizeImportAsset(asset: { kind: ReusableAssetKind; title: string; content: unknown }): { kind: ReusableAssetKind; title: string; content: unknown } {
		if (asset.kind === "api" && typeof asset.content === "object" && asset.content !== null && !Array.isArray(asset.content)) {
			const record = asset.content as Record<string, unknown>;
			if (!("schemaVersion" in record) && "openapi" in record) {
				const title = typeof record.info === "object" && record.info !== null && !Array.isArray(record.info) && typeof (record.info as Record<string, unknown>).title === "string" ? (record.info as Record<string, unknown>).title as string : asset.title;
			return { ...asset, content: { ...record, schemaVersion: "artifact/api/v1", artifactKind: "api", summary: title, sourceRefs: [] }, title };
			}
		}
		return asset;
	}

	private findAssetByNodePath(workspaceId: number, kind: string, content: unknown): { assetId: number; revisionId: number } | undefined {
		if (typeof content !== "object" || content === null || Array.isArray(content)) return undefined;
		const record = content as Record<string, unknown>;
		const nodeId = typeof record.nodeId === "string" ? record.nodeId : undefined;
		const title = typeof record.title === "string" ? record.title : typeof record.name === "string" ? record.name : undefined;
		if (nodeId) {
			const rows = this.database
				.prepare("select a.id, a.current_revision_id, d.content from reusable_assets a join reusable_asset_revisions r on r.id = a.current_revision_id join snapshot_documents d on d.id = r.content_document_id where a.workspace_id = ? and a.kind = ? order by a.id")
				.all(workspaceId, kind) as Array<{ id: number; current_revision_id: number; content: string }>;
			for (const row of rows) {
				try {
					const existing = JSON.parse(row.content) as Record<string, unknown>;
					if (typeof existing.nodeId === "string" && existing.nodeId === nodeId) {
						return { assetId: row.id, revisionId: row.current_revision_id };
					}
				} catch { continue; }
			}
		}
		if (title) {
			const existing = this.database
				.prepare("select id, current_revision_id from reusable_assets where workspace_id = ? and kind = ? and title = ? order by id desc limit 1")
				.get(workspaceId, kind, title) as { id: number; current_revision_id: number | null } | undefined;
			if (existing?.current_revision_id !== null && existing !== undefined) {
				return { assetId: existing.id, revisionId: existing.current_revision_id };
			}
		}
		return undefined;
	}

	// --- Hierarchy tree operations ---

	getHierarchyRoots(workspaceId: number, rootKind: string, query: { page: number; pageSize: number; q?: string }): { roots: readonly HierarchyNode[]; total: number; kindCounts: Record<string, number> } {
		const conditions = ["workspace_id = ?", "kind = ?"];
		const params: unknown[] = [workspaceId, rootKind];
		const normalizedQuery = query.q?.trim().toLowerCase();
		if (normalizedQuery) {
			conditions.push("(lower(title) like ? or exists (select 1 from reusable_asset_revisions r join snapshot_documents d on d.id = r.content_document_id where r.reusable_asset_id = reusable_assets.id and (lower(d.content) like ?)))");
			params.push(`%${normalizedQuery}%`, `%${normalizedQuery}%`);
		}
		const where = conditions.join(" and ");
		const total = (this.database.prepare(`select count(*) as count from reusable_assets where ${where}`).get(...params) as { count: number }).count;
		const rows = this.database
			.prepare(`select id, kind, title, current_revision_id, created_at from reusable_assets where ${where} order by id limit ? offset ?`)
			.all(...params, query.pageSize, (query.page - 1) * query.pageSize) as Array<{ id: number; kind: string; title: string; current_revision_id: number | null; created_at: string }>;
		const kindCounts: Record<string, number> = {};
		const countRows = this.database.prepare("select kind, count(*) as count from reusable_assets where workspace_id = ? group by kind").all(workspaceId) as Array<{ kind: string; count: number }>;
		for (const row of countRows) kindCounts[row.kind] = row.count;
		return {
			roots: rows.map((row) => ({
				assetId: row.id,
				kind: row.kind as ReusableAssetKind,
				title: row.title,
				childCount: this.getChildCount(row.id),
				currentRevisionId: row.current_revision_id,
				createdAt: row.created_at,
			})),
			total,
			kindCounts,
		};
	}

	getChildren(parentAssetId: number): readonly HierarchyNode[] {
		const rows = this.database
			.prepare(`select a.id, a.kind, a.title, a.current_revision_id, a.created_at, ar.position
				from reusable_assets a
				join asset_relations ar on ar.to_asset_id = a.id
				where ar.from_asset_id = ? and ar.relationship_type = 'contains'
				order by ar.position, ar.id`)
			.all(parentAssetId) as Array<{ id: number; kind: string; title: string; current_revision_id: number | null; created_at: string; position: number }>;
		return rows.map((row) => ({
			assetId: row.id,
			kind: row.kind as ReusableAssetKind,
			title: row.title,
			childCount: this.getChildCount(row.id),
			currentRevisionId: row.current_revision_id,
			position: row.position,
			createdAt: row.created_at,
		}));
	}

	getChildCount(assetId: number): number {
		return (this.database.prepare("select count(*) as count from asset_relations where from_asset_id = ? and relationship_type = 'contains'").get(assetId) as { count: number }).count;
	}

	searchNodes(workspaceId: number, q: string): readonly { assetId: number; kind: ReusableAssetKind; title: string; matchedPath: string[] }[] {
		const normalized = q.trim().toLowerCase();
		if (normalized.length === 0) return [];
		const rows = this.database
			.prepare(`select a.id, a.kind, a.title, d.content
				from reusable_assets a
				join reusable_asset_revisions r on r.id = a.current_revision_id
				join snapshot_documents d on d.id = r.content_document_id
				where a.workspace_id = ? and (lower(a.title) like ? or lower(d.content) like ?)
				order by a.id`)
			.all(workspaceId, `%${normalized}%`, `%${normalized}%`) as Array<{ id: number; kind: string; title: string; content: string }>;
		return rows.map((row) => {
			const nodeId = this.extractNodeId(row.content);
			return { assetId: row.id, kind: row.kind as ReusableAssetKind, title: row.title, matchedPath: this.buildPath(row.id, nodeId) };
		});
	}

	private extractNodeId(contentJson: string): string {
		try {
			const content = JSON.parse(contentJson) as Record<string, unknown>;
			return typeof content.nodeId === "string" ? content.nodeId : "";
		} catch { return ""; }
	}

	private buildPath(assetId: number, nodeId: string): string[] {
		const path: string[] = [];
		let current = assetId;
		for (let i = 0; i < 10 && current > 0; i++) {
			const parent = this.database
				.prepare("select from_asset_id from asset_relations where to_asset_id = ? and relationship_type = 'contains' limit 1")
				.get(current) as { from_asset_id: number } | undefined;
			if (!parent) break;
			const parentContent = this.database
				.prepare("select d.content from reusable_assets a join reusable_asset_revisions r on r.id = a.current_revision_id join snapshot_documents d on d.id = r.content_document_id where a.id = ?")
				.get(parent.from_asset_id) as { content: string } | undefined;
			path.unshift(this.extractNodeId(parentContent?.content ?? "") || String(parent.from_asset_id));
			current = parent.from_asset_id;
		}
		path.unshift(nodeId || String(assetId));
		return path;
	}

	createSubtree(workspaceId: number, tree: SubtreeNode, parentId: number | null): { assets: Array<{ assetId: number; revisionId: number; title: string; kind: string }>; relations: Array<{ fromAssetId: number; toAssetId: number; type: string; position: number }> } {
		const assets: Array<{ assetId: number; revisionId: number; title: string; kind: string }> = [];
		const relations: Array<{ fromAssetId: number; toAssetId: number; type: string; position: number }> = [];
		const timestamp = this.clock.now().toISOString();
		const transaction = this.database.transaction(() => {
			this.createSubtreeNode(workspaceId, tree, parentId, 0, assets, relations, timestamp);
		}).immediate;
		transaction();
		return { assets, relations };
	}

	private createSubtreeNode(workspaceId: number, node: SubtreeNode, parentId: number | null, position: number, assets: Array<{ assetId: number; revisionId: number; title: string; kind: string }>, relations: Array<{ fromAssetId: number; toAssetId: number; type: string; position: number }>, timestamp: string): void {
		const content = { ...node.content, nodeId: node.nodeId ?? cryptoNodeId() };
		const created = this.createReusableAsset({ workspaceId, kind: node.kind as ReusableAssetKind, title: node.title, content, source: "manual" });
		assets.push({ assetId: created.assetId, revisionId: created.revisionId, title: node.title, kind: node.kind });
		if (parentId !== null) {
			const parentRevision = this.database
				.prepare("select current_revision_id from reusable_assets where id = ?")
				.get(parentId) as { current_revision_id: number | null };
			this.database
				.prepare("insert or ignore into asset_relations(from_asset_id, to_asset_id, from_revision_id, to_revision_id, relationship_type, position, created_at) values (?, ?, ?, ?, 'contains', ?, ?)")
				.run(parentId, created.assetId, parentRevision.current_revision_id, created.revisionId, position, timestamp);
			relations.push({ fromAssetId: parentId, toAssetId: created.assetId, type: "contains", position });
		}
		for (let i = 0; i < (node.children ?? []).length; i++) {
			this.createSubtreeNode(workspaceId, node.children![i], created.assetId, i, assets, relations, timestamp);
		}
	}

	moveSubtree(workspaceId: number, assetId: number, expectedRevisionId: number, newParentAssetId: number | null): void {
		const asset = this.database
			.prepare("select id, kind, current_revision_id from reusable_assets where id = ? and workspace_id = ?")
			.get(assetId, workspaceId) as { id: number; kind: string; current_revision_id: number | null } | undefined;
		if (!asset) throw new Error("Asset not found");
		if (asset.current_revision_id !== expectedRevisionId) throw new ReusableAssetVersionConflictError();
		if (newParentAssetId !== null) {
			const parent = this.database
				.prepare("select id, kind from reusable_assets where id = ? and workspace_id = ?")
				.get(newParentAssetId, workspaceId) as { id: number; kind: string } | undefined;
			if (!parent) throw new Error("Parent not found");
			if (!isValidAssetRelation(parent.kind as ReusableAssetKind, asset.kind as ReusableAssetKind, "contains")) {
				throw new AssetRelationValidationError([{ reason: "invalid_kind_pair" }]);
			}
			if (this.wouldCreateCycle(assetId, newParentAssetId)) {
				throw new AssetRelationValidationError([{ reason: "cycle_detected" }]);
			}
		}
		this.database.prepare("delete from asset_relations where to_asset_id = ? and relationship_type = 'contains'").run(assetId);
		if (newParentAssetId !== null) {
			const parentRevision = this.database.prepare("select current_revision_id from reusable_assets where id = ?").get(newParentAssetId) as { current_revision_id: number | null };
			const childRevision = asset.current_revision_id;
			const maxPos = (this.database.prepare("select coalesce(max(position), -1) as pos from asset_relations where from_asset_id = ? and relationship_type = 'contains'").get(newParentAssetId) as { pos: number }).pos;
			this.database
				.prepare("insert or ignore into asset_relations(from_asset_id, to_asset_id, from_revision_id, to_revision_id, relationship_type, position, created_at) values (?, ?, ?, ?, 'contains', ?, ?)")
				.run(newParentAssetId, assetId, parentRevision.current_revision_id, childRevision, maxPos + 1, this.clock.now().toISOString());
		}
	}

	private wouldCreateCycle(assetId: number, newParentAssetId: number): boolean {
		let current: number | null = newParentAssetId;
		for (let i = 0; i < 50 && current !== null; i++) {
			if (current === assetId) return true;
			const parent = this.database.prepare("select from_asset_id from asset_relations where to_asset_id = ? and relationship_type = 'contains' limit 1").get(current) as { from_asset_id: number } | undefined;
			current = parent?.from_asset_id ?? null;
		}
		return false;
	}

	deleteSubtree(assetId: number): readonly { assetId: number; title: string; kind: string }[] {
		const affected: Array<{ assetId: number; title: string; kind: string }> = [];
		const transaction = this.database.transaction(() => {
			this.collectSubtree(assetId, affected);
			for (const node of affected) {
				this.database.prepare("delete from asset_relations where from_asset_id = ? or to_asset_id = ?").run(node.assetId, node.assetId);
				this.database.prepare("delete from reusable_assets where id = ?").run(node.assetId);
			}
		}).immediate;
		transaction();
		return affected;
	}

	previewSubtreeDeletion(assetId: number): readonly { assetId: number; title: string; kind: string }[] {
		const affected: Array<{ assetId: number; title: string; kind: string }> = [];
		this.collectSubtree(assetId, affected);
		return affected;
	}

	private collectSubtree(assetId: number, affected: Array<{ assetId: number; title: string; kind: string }>): void {
		const asset = this.database.prepare("select id, kind, title from reusable_assets where id = ?").get(assetId) as { id: number; kind: string; title: string } | undefined;
		if (!asset) return;
		affected.push({ assetId: asset.id, title: asset.title, kind: asset.kind });
		const children = this.database
			.prepare("select to_asset_id from asset_relations where from_asset_id = ? and relationship_type = 'contains'")
			.all(assetId) as Array<{ to_asset_id: number }>;
		for (const child of children) {
			this.collectSubtree(child.to_asset_id, affected);
		}
	}

	hasChildren(assetId: number): boolean {
		return this.getChildCount(assetId) > 0;
	}
	hasIncomingCrossAssetRelations(assetId: number): readonly { assetId: number; kind: string; title: string; type: string }[] {
		const refs = this.database
			.prepare(`select case when relation.from_asset_id = ? then to_asset.id else from_asset.id end as asset_id,
				case when relation.from_asset_id = ? then to_asset.kind else from_asset.kind end as kind,
				case when relation.from_asset_id = ? then to_asset.title else from_asset.title end as title,
				relation.relationship_type as type
				from asset_relations relation
				join reusable_assets from_asset on from_asset.id = relation.from_asset_id
				join reusable_assets to_asset on to_asset.id = relation.to_asset_id
				where (relation.from_asset_id = ? or relation.to_asset_id = ?) and relation.relationship_type != 'contains'
				order by relation.id`)
			.all(assetId, assetId, assetId, assetId, assetId) as Array<{ asset_id: number; kind: string; title: string; type: string }>;
		return refs.map((ref) => ({ assetId: ref.asset_id, kind: ref.kind, title: ref.title, type: ref.type }));
	}
}

export interface HierarchyNode {
	assetId: number;
	kind: ReusableAssetKind;
	title: string;
	childCount: number;
	currentRevisionId: number | null;
	position?: number;
	createdAt: string;
}

export interface SubtreeNode {
	kind: string;
	title: string;
	nodeId?: string;
	content: Record<string, unknown>;
	children?: readonly SubtreeNode[];
}

function cryptoNodeId(): string {
	return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}