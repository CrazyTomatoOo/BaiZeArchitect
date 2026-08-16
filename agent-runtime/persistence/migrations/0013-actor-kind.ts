/**
 * 0013-actor-kind.ts — 资产库新增第四种可复用资产 kind=actor（业务参与者）。
 *
 * SQLite 不能 ALTER 既有 CHECK 约束，因此按 0006/0009/0010 的既有重建配方：
 * 建新表 → 拷贝数据 → drop 旧表 → rename。reusable_asset_revisions 的
 * foreign key 仍指向 reusable_assets(id)（按表名解析，rename 后自动跟随）。
 */
export const ACTOR_KIND_MIGRATION = {
	version: 13,
	name: "actor-kind",
	sql: `
create table reusable_assets_new (
	id integer primary key,
	workspace_id integer not null references workspaces(id) on delete restrict,
	kind text not null check (kind in ('scenario','usecase','function','actor')),
	title text not null,
	current_revision_id integer,
	legacy_origin_requirement_id integer,
	created_at text not null,
	updated_at text not null
);

insert into reusable_assets_new (id, workspace_id, kind, title, current_revision_id, legacy_origin_requirement_id, created_at, updated_at)
select id, workspace_id, kind, title, current_revision_id, legacy_origin_requirement_id, created_at, updated_at
from reusable_assets;

drop table reusable_assets;
alter table reusable_assets_new rename to reusable_assets;

create index reusable_assets_workspace on reusable_assets(workspace_id, id);
`,
	checksum: "actor-kind-v1",
} as const;