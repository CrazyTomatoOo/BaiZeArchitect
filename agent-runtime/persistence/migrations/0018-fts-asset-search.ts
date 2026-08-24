/**
 * 0018-fts-asset-search.ts — FTS5 trigram 检索投影（#23）。
 *
 * 投影双表（不改源表；insert-only 增量回填）：
 * - reusable_asset_search：reusable_asset_content 快照（被某资产 current_revision 引用者）
 * - artifact_search：artifact_content 快照（被某 artifact 已批准 + current revision 引用者）
 * 两表均带 workspace_id 等 UNINDEXED 过滤列（检索严格限 workspace）+ snapshot_id（源 snapshot_documents.id，current 过滤锚）。
 * rowid 由 FTS 自增（snapshot_documents 按 (kind,digest) 全局去重，同一 doc 可被多个 source 引用，不可作 FTS rowid）。
 * - asset_search_index / artifact_search_index：已索引对账本（kind 隐式、doc_id+source_id 唯一），驱动 insert-only 增量回填；
 *   pending → approved 的文档在下次 backfill 时自然补插（不依赖单调 id 游标快进）。
 * 归档包（design_packages 的 approval_packet 快照）不是上述两种 kind，天然不入检索语料。
 * 说明：trigram tokenizer 需 SQLite ≥ 3.34（当前运行时 3.53 ✓）；<3 unicode 字符零命中（API 边界）。
 */
export const FTS_ASSET_SEARCH_MIGRATION = {
	version: 18,
	name: "fts-asset-search",
	sql: `
create virtual table reusable_asset_search using fts5(
	snapshot_id unindexed,
	workspace_id unindexed,
	asset_id unindexed,
	kind unindexed,
	title,
	content,
	tokenize = 'trigram'
);

create virtual table artifact_search using fts5(
	snapshot_id unindexed,
	workspace_id unindexed,
	requirement_id unindexed,
	artifact_id unindexed,
	kind unindexed,
	title,
	content,
	tokenize = 'trigram'
);

create table asset_search_index (
	doc_id integer not null,
	asset_id integer not null,
	indexed_at text not null,
	primary key (doc_id, asset_id)
);

create table artifact_search_index (
	doc_id integer not null,
	artifact_id integer not null,
	indexed_at text not null,
	primary key (doc_id, artifact_id)
);
`,
	checksum: "fts-asset-search-v1",
} as const;