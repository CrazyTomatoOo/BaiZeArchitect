/**
 * 0019-asset-relations.ts — explicit workspace asset relationship graph.
 *
 * Asset IDs provide joins, uniqueness and cascade ownership. Revision IDs pin
 * the revisions observed when the relation was created for auditability.
 */
export const ASSET_RELATIONS_MIGRATION = {
	version: 19,
	name: "asset-relations",
	sql: `
create table asset_relations (
	id integer primary key autoincrement,
	from_asset_id integer not null references reusable_assets(id) on delete cascade,
	to_asset_id integer not null references reusable_assets(id) on delete cascade,
	from_revision_id integer not null references reusable_asset_revisions(id) on delete cascade,
	to_revision_id integer not null references reusable_asset_revisions(id) on delete cascade,
	relationship_type text not null,
	created_at text not null,
	unique(from_asset_id, to_asset_id, relationship_type)
);

create index asset_relations_from_asset on asset_relations(from_asset_id);
create index asset_relations_to_asset on asset_relations(to_asset_id);
`,
	checksum: "asset-relations-v1",
} as const;
