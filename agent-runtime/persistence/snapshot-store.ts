import type Database from "better-sqlite3";
import type { HashProvider } from "../testing/deterministic-fixtures.js";

export interface SnapshotDocument {
	id: number;
	digest: string;
	schemaRef: string;
	content: unknown;
}

/**
 * snapshot-store.ts — Store（存储域）子域：内容寻址快照文档（对象存储面）。
 *
 * 全局共享（kind+digest 去重）、插入后不可变、不随 Workspace 级联删除；
 * 治理域的 Plan/Context/Contract/Policy/Result/Packet 经 WorkflowStore 门面写入。
 * 子域边界见 docs/adr/ADR-006-store-subdomain-boundary.md。
 */
export class SnapshotStore {
	constructor(
		private readonly database: Database.Database,
		private readonly hashProvider: HashProvider,
	) {}

	/** 内容寻址写入：同 kind+digest 幂等复用；调用方负责外层事务边界。 */
	insertSnapshot(
		kind: string,
		schemaRef: string,
		content: unknown,
		createdAt: string,
	): SnapshotDocument {
		const digest = this.hashProvider.digest(content);
		const encoded = this.hashProvider.canonicalize(content);
		this.database
			.prepare("insert into snapshot_documents(kind, schema_ref, media_type, content, digest, created_at) values (?, ?, 'application/json', ?, ?, ?) on conflict(kind, digest) do nothing")
			.run(kind, schemaRef, encoded, digest, createdAt);
		const row = this.database
			.prepare("select id, digest, schema_ref, content, media_type from snapshot_documents where kind = ? and digest = ?")
			.get(kind, digest) as { id: number; digest: string; schema_ref: string; content: string; media_type: string };
		if (row.schema_ref !== schemaRef || row.media_type !== "application/json" || row.content !== encoded) {
			throw new Error(`Snapshot digest collision for ${kind}/${digest}`);
		}
		return { id: row.id, digest: row.digest, schemaRef: row.schema_ref, content };
	}
}