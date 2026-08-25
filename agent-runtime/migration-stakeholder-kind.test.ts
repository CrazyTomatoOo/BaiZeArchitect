import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
	createCrashInjector,
	createFixtureClock,
	createHashProvider,
	createOutboxTransport,
} from "./testing/deterministic-fixtures.ts";
import { openHeadlessWorkflowRuntime } from "./workflow/headless-runtime.js";
import { STAKEHOLDER_KIND_MIGRATION } from "./persistence/migrations/0013-stakeholder-kind.js";

function runtimeOptions(databasePath: string) {
	return {
		databasePath,
		clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector([]),
		outboxTransport: createOutboxTransport(),
	};
}

async function withRuntime(
	work: (fixture: {
		databasePath: string;
		runtime: Awaited<ReturnType<typeof openHeadlessWorkflowRuntime>>;
	}) => Promise<void> | void,
): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-migration-stakeholder-kind-"));
	const databasePath = path.join(directory, "workflow.db");
	const runtime = await openHeadlessWorkflowRuntime(runtimeOptions(databasePath));
	try {
		await work({ databasePath, runtime });
	} finally {
		runtime.close();
		await rm(directory, { recursive: true, force: true });
	}
}

// 0011-era table shape for reusable_assets (kind CHECK without 'stakeholder').
const V11_REUSABLE_ASSETS_SQL = `
create table reusable_assets (
	id integer primary key,
	workspace_id integer not null,
	kind text not null check (kind in ('scenario','usecase','function')),
	title text not null,
	current_revision_id integer,
	legacy_origin_requirement_id integer,
	created_at text not null,
	updated_at text not null
);
`;

test("fresh database accepts kind=stakeholder and round-trips it", async () => {
	await withRuntime(async ({ runtime }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/repo", name: "repo" });
		const created = runtime.createReusableAsset({
			workspaceId,
			kind: "stakeholder",
			title: "管理员",
			content: { name: "管理员", description: "负责用户与权限配置" },
		});
		assert.equal(created.revisionId > 0, true);
		const listed = runtime.listReusableAssets(workspaceId);
		assert.deepEqual(
			listed.map((a) => ({ kind: a.kind, title: a.title })),
			[{ kind: "stakeholder", title: "管理员" }],
		);
		const detail = runtime.getReusableAsset(created.assetId);
		assert.equal(detail?.kind, "stakeholder");
		assert.deepEqual(detail?.revisions.at(-1)?.content, {
			name: "管理员",
			description: "负责用户与权限配置",
		});
	});
});

test("stakeholder kind survives the 0011-era table rebuild (rows preserved, CHECK expanded)", () => {
	const db = new Database(":memory:");
	// 生产语义：applyMigrations 只在全新库上按序执行（此时表为空），或在存量库上仅校验
	// checksum、缺迁移即抛错——永远不会对含数据的库补跑 0013。本测试仍按配方手动重放
	// 旧表形 + 预置数据，验证 drop→rename 配方本身在 FK 关闭时不丢行。
	// （FK=ON 时 drop 空父表天然安全；FK=OFF 只出现在本测试的手动重放场景。）
	db.pragma("foreign_keys = OFF");
	try {
		db.exec(V11_REUSABLE_ASSETS_SQL);
		// 预置一条 revision（模拟 0011 期子表行），验证 0013 重建父表后子表不受影响
		db.exec("create table reusable_asset_revisions (id integer primary key, reusable_asset_id integer not null, revision_no integer not null check (revision_no > 0), source text not null check (source in ('manual','import','migration')), created_at text not null)");
		db.prepare(
			"insert into reusable_assets(id, workspace_id, kind, title, current_revision_id, legacy_origin_requirement_id, created_at, updated_at) values (1, 1, 'scenario', '旧场景', null, null, ?, ?)",
		).run("2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
		db.prepare(
			"insert into reusable_asset_revisions(id, reusable_asset_id, revision_no, source, created_at) values (11, 1, 1, 'manual', '2026-08-01T00:00:00.000Z')",
		).run();
		db.exec(STAKEHOLDER_KIND_MIGRATION.sql);

		const schema = db.prepare("select sql from sqlite_master where type='table' and name='reusable_assets'").get() as { sql: string };
		assert.match(schema.sql, /'stakeholder'/);
		assert.match(schema.sql, /'scenario','usecase','function','stakeholder'/);

		const rows = db.prepare("select id, kind, title from reusable_assets").all() as Array<{ id: number; kind: string; title: string }>;
		assert.deepEqual(rows, [{ id: 1, kind: "scenario", title: "旧场景" }]);

		// 子表行与约束在重建父表后保持原样（revision/source 约束不变）
		const revisionRows = db.prepare("select id, reusable_asset_id, revision_no, source from reusable_asset_revisions").all() as Array<{ id: number; reusable_asset_id: number; revision_no: number; source: string }>;
		assert.deepEqual(revisionRows, [{ id: 11, reusable_asset_id: 1, revision_no: 1, source: "manual" }]);
		const revisionSchema = db.prepare("select sql from sqlite_master where type='table' and name='reusable_asset_revisions'").get() as { sql: string };
		assert.match(revisionSchema.sql, /source in \('manual','import','migration'\)/);
		assert.match(revisionSchema.sql, /revision_no > 0/);

		db.prepare(
			"insert into reusable_assets(id, workspace_id, kind, title, current_revision_id, legacy_origin_requirement_id, created_at, updated_at) values (2, 1, 'stakeholder', '新干系人', null, null, ?, ?)",
		).run("2026-08-02T00:00:00.000Z", "2026-08-02T00:00:00.000Z");
		assert.throws(
			() =>
				db.prepare(
					"insert into reusable_assets(id, workspace_id, kind, title, current_revision_id, legacy_origin_requirement_id, created_at, updated_at) values (3, 1, 'bogus', '非法', null, null, ?, ?)",
				).run("2026-08-02T00:00:00.000Z", "2026-08-02T00:00:00.000Z"),
			/CHECK constraint failed/,
		);
	} finally {
		db.close();
	}
});

test("the shared kind predicate classifies stakeholder and rejects unknown kinds", async () => {
	const { REUSABLE_ASSET_KINDS, isReusableAssetKind } = await import("./persistence/reusable-asset-kind.js");
	assert.deepEqual([...REUSABLE_ASSET_KINDS], ["scenario", "usecase", "function", "design", "architecture", "data", "api", "stakeholder"]);
	assert.equal(isReusableAssetKind("stakeholder"), true);
	assert.equal(isReusableAssetKind("actor"), false);
	assert.equal(isReusableAssetKind("bogus"), false);
});


// #22 review（S1/S3/S4）：0016 重建后不可变触发器/工作区索引/cascade FK/8 kinds/workflow source 全部保留。
test("0016 asset-workflow rebuild preserves trigger, index, cascade FK, 8 kinds, workflow source", async () => {
	await withRuntime(async ({ databasePath, runtime }) => {
		const db = new Database(databasePath);
		try {
			const workspaceId = runtime.createWorkspace({ repoPath: "/r", name: "R" });
			const triggers = db.prepare("select name from sqlite_master where type='trigger' and name='reusable_asset_revision_content_immutable'").all();
			assert.equal(triggers.length, 1, "immutability trigger recreated after 0016 rebuild");
			const indexes = db.prepare("select name from sqlite_master where type='index' and name='reusable_assets_workspace'").all();
			assert.equal(indexes.length, 1, "workspace index recreated after 0016 rebuild");
			const fkSql = db.prepare("select sql from sqlite_master where type='table' and name='reusable_asset_revisions'").get() as { sql: string };
			assert.match(fkSql.sql, /on delete cascade/, "revision FK keeps 0011 cascade semantics");
			const assetSql = db.prepare("select sql from sqlite_master where type='table' and name='reusable_assets'").get() as { sql: string };
			assert.match(assetSql.sql, /'scenario','usecase','function','design','architecture','data','api','stakeholder'/);
			const revisionSql = db.prepare("select sql from sqlite_master where type='table' and name='reusable_asset_revisions'").get() as { sql: string };
			assert.match(revisionSql.sql, /'manual','import','migration','workflow'/);
			// 走完整 store 路径建 asset + workflow-source revision（触发器必须放行合法插入）
			const created = runtime.createReusableAsset({
				workspaceId,
				kind: "scenario",
				title: "S",
				content: { steps: ["a"] },
				source: "workflow",
			});
			// 不可变触发器拦截 revision 修改
			assert.throws(
				() => db.prepare("update reusable_asset_revisions set revision_no = revision_no + 100 where id = ?").run(created.revisionId),
				/ReusableAssetRevision content is immutable/,
			);
			// cascade：删 asset 连带删 revisions
			runtime.deleteReusableAsset(created.assetId);
			const remaining = db.prepare("select count(*) as n from reusable_asset_revisions").get() as { n: number };
			assert.equal(remaining.n, 0, "revisions cascade-deleted with asset");
		} finally {
			db.close();
		}
	});
});
