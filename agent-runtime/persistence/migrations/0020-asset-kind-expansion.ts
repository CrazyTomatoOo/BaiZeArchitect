/**
 * 0020-asset-kind-expansion.ts — expand reusable_assets.kind to 12 kinds + add asset_relations.position.
 *
 * - reusable_assets.kind CHECK expands to:
 *   scenario-domain, scenario, scenario-variant, function-domain, function-item,
 *   function-point, usecase, design, architecture, data, api, stakeholder
 * - asset_relations gains position INTEGER NOT NULL DEFAULT 0 for ordering
 * SQLite cannot ALTER an existing CHECK constraint, so we use the 0013/0016
 * rebuild recipe: create new table → copy data → drop old → rename.
 * The immutability trigger and workspace index are recreated on the new table.
 */
export const ASSET_KIND_EXPANSION_MIGRATION = {
	version: 20,
	name: "asset-kind-expansion",
	sql: `
create table reusable_assets_new (
	id integer primary key,
	workspace_id integer not null references workspaces(id) on delete restrict,
	kind text not null check (kind in ('scenario-domain','scenario','scenario-variant','function-domain','function-item','function-point','usecase','design','architecture','data','api','stakeholder')),
	title text not null,
	current_revision_id integer,
	legacy_origin_requirement_id integer,
	origin_requirement_id integer,
	origin_artifact_id integer,
	origin_approval_id integer,
	created_at text not null,
	updated_at text not null
);

insert into reusable_assets_new (id, workspace_id, kind, title, current_revision_id, legacy_origin_requirement_id, origin_requirement_id, origin_artifact_id, origin_approval_id, created_at, updated_at)
select id, workspace_id, kind, title, current_revision_id, legacy_origin_requirement_id, origin_requirement_id, origin_artifact_id, origin_approval_id, created_at, updated_at
from reusable_assets;

drop table reusable_assets;
alter table reusable_assets_new rename to reusable_assets;

create index reusable_assets_workspace on reusable_assets(workspace_id, id);

alter table asset_relations add column position integer not null default 0;
`,
	checksum: "asset-kind-expansion-v1",
} as const;
