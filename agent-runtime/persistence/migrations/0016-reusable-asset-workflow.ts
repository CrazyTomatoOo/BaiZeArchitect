/**
 * 0016-reusable-asset-workflow.ts — 资产库扩 8 种可复用 kind + workflow 来源（#14 决议条目级 + #22 promote 命令）。
 *
 * - reusable_assets.kind 扩为 scenario/usecase/function/design/architecture/data/api/actor
 * - reusable_assets 新增溯源列（origin_requirement_id/origin_artifact_id/origin_approval_id，审计元数据无 FK）
 * - reusable_asset_revisions.source 扩 workflow（并行 manual/import/migration）
 * SQLite 不能 ALTER CHECK，按 0013 重建配方：建新表 → 拷贝 → drop → rename。
 * 重建连带：reusable_asset_revision_content_immutable 触发器与 reusable_assets_workspace 索引
 * 一并重建（沿用 0011 原定义）；reusable_asset_revisions 的 FK 保持 0011 的 on delete cascade 语义。
 */
export const REUSABLE_ASSET_WORKFLOW_MIGRATION = {
	version: 16,
	name: "reusable-asset-workflow",
	sql: `
create table reusable_assets_new (
	id integer primary key,
	workspace_id integer not null references workspaces(id) on delete restrict,
	kind text not null check (kind in ('scenario','usecase','function','design','architecture','data','api','actor')),
	title text not null,
	current_revision_id integer,
	legacy_origin_requirement_id integer,
	origin_requirement_id integer,
	origin_artifact_id integer,
	origin_approval_id integer,
	created_at text not null,
	updated_at text not null
);

insert into reusable_assets_new (id, workspace_id, kind, title, current_revision_id, legacy_origin_requirement_id, created_at, updated_at)
select id, workspace_id, kind, title, current_revision_id, legacy_origin_requirement_id, created_at, updated_at
from reusable_assets;

drop table reusable_assets;
alter table reusable_assets_new rename to reusable_assets;

create index reusable_assets_workspace on reusable_assets(workspace_id, id);

create table reusable_asset_revisions_new (
	id integer primary key,
	reusable_asset_id integer not null references reusable_assets(id) on delete cascade,
	revision_no integer not null,
	content_document_id integer not null references snapshot_documents(id) on delete restrict,
	content_digest text not null,
	source text not null check (source in ('manual','import','migration','workflow')),
	actor_snapshot_document_id integer references snapshot_documents(id) on delete restrict,
	migration_attestation_document_id integer references snapshot_documents(id) on delete restrict,
	created_at text not null,
	unique(reusable_asset_id, revision_no)
);

insert into reusable_asset_revisions_new (id, reusable_asset_id, revision_no, content_document_id, content_digest, source, actor_snapshot_document_id, migration_attestation_document_id, created_at)
select id, reusable_asset_id, revision_no, content_document_id, content_digest, source, actor_snapshot_document_id, migration_attestation_document_id, created_at
from reusable_asset_revisions;

drop table reusable_asset_revisions;
alter table reusable_asset_revisions_new rename to reusable_asset_revisions;

create trigger reusable_asset_revision_content_immutable
before update on reusable_asset_revisions
when old.reusable_asset_id != new.reusable_asset_id
	or old.revision_no != new.revision_no
	or old.content_document_id != new.content_document_id
	or old.content_digest != new.content_digest
	or old.source != new.source
	or old.created_at != new.created_at
begin
	select raise(abort, 'ReusableAssetRevision content is immutable');
end;
`,
	checksum: "reusable-asset-workflow-v1",
} as const;