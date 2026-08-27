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
	createFixtureOperator,
	type FixtureOperator,
} from "./testing/deterministic-fixtures.ts";
import {
	openHeadlessWorkflowRuntime,
	type HeadlessWorkflowRuntime,
	type RequirementBaseline,
} from "./workflow/headless-runtime.ts";
import type { RoleResult, ArtifactEffectProposal } from "./workflow/role-result.ts";

/**
 * #23 FTS5 检索语义测试：
 * - trigram 中文子串命中（支付网关/回调签名类用例）
 * - workspace 严格隔离（过滤列 + MATCH）
 * - 双语料（reusable asset + 已批准 artifact revision）
 * - 归档包（approval_packet）不入检索
 * - 增量回填（snapshot id 游标，insert-only，幂等）
 * - <3 unicode 字符零命中边界
 */

const BASELINE: RequirementBaseline = {
	schemaVersion: "artifact/requirement/v1",
	artifactKind: "requirement",
	summary: "Search corpus baseline",
	sourceRefs: [],
	title: "支付网关回调签名验证",
	description: "回调签名使用支付网关密钥派生校验。",
};

const OPERATOR: FixtureOperator = createFixtureOperator("alice");

async function withRuntime(
	work: (fixture: { runtime: HeadlessWorkflowRuntime; databasePath: string }) => Promise<void> | void,
): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-search-"));
	const databasePath = path.join(directory, "workflow.db");
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector([]),
		outboxTransport: createOutboxTransport(),
	});
	try {
		await work({ runtime, databasePath });
	} finally {
		runtime.close();
		await rm(directory, { recursive: true, force: true });
	}
}

async function startAndPlan(runtime: HeadlessWorkflowRuntime, baseline: RequirementBaseline = BASELINE): Promise<number> {
	const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
	const created = runtime.createRequirement({ workspaceId, baseline });
	runtime.executeCommand({
		workflowId: created.workflowId,
		commandId: "cmd-start",
		expectedWorkflowVersion: 0,
		type: "start",
		operator: OPERATOR,
	});
	const result = await runtime.planWorkflow(created.workflowId, null);
	assert.equal(result.outcome, "adopted");
	return created.workflowId;
}

function currentVersion(runtime: HeadlessWorkflowRuntime, workflowId: number): number {
	return runtime.getWorkflowProjection(workflowId)!.workflow.version;
}

function effectFor(kind: string, content: unknown, evidenceSnapshotId: number, sourceRevId: number): ArtifactEffectProposal {
	return {
		effectType: "artifact_revision",
		artifactKind: kind as ArtifactEffectProposal["artifactKind"],
		logicalKey: kind,
		content,
		baseRevisionId: null,
		traceLinks: [{ evidenceSnapshotId, sourceRef: { type: "requirement_revision", revisionId: sourceRevId } }],
	};
}

function roleResult(workflowId: number, attemptId: number, effects: ArtifactEffectProposal[]): RoleResult {
	return { schemaVersion: "role-result/v1", workflowId, attemptId, effects };
}

function criticReport(workflowId: number, attemptId: number, revisionId: number, artifactKind = "analysis"): unknown {
	return {
		schemaVersion: "critic-report/v1",
		workflowId,
		attemptId,
		coverageAttestation: { complete: true, reviewTargets: [{ revisionId, artifactKind }] },
		findings: [],
	};
}

/** 产出 + 评审 + 批准一个 analysis 产物（语料：artifact approved revision）。 */
async function produceApproveAnalysis(runtime: HeadlessWorkflowRuntime, workflowId: number): Promise<{ artifactId: number; revisionId: number }> {
	const projection = runtime.getWorkflowProjection(workflowId)!;
	const reqRev = projection.requirement.currentRevision.id;
	const begin = runtime.beginAttempt(workflowId);
	assert.ok(begin.taskId > 0, "analysis task ready");
	const snapshot = runtime.bindEvidenceSnapshot(workflowId, "sha256:repo1", [{ path: "src/main.ts", digest: "sha256:f1", size: 10 }]);
	const content = {
		schemaVersion: "artifact/analysis/v1",
		artifactKind: "analysis",
		summary: "回调签名校验逻辑分析",
		sourceRefs: [{ type: "requirement_revision", revisionId: reqRev }],
		goals: ["校验支付网关回调签名"],
		nonGoals: [],
		constraints: [],
		acceptanceCriteria: ["签名不合法时拒绝回调"],
		impactProfile: { process: { status: "no", rationale: "r" }, actors: { status: "no", rationale: "r" }, behavior: { status: "no", rationale: "r" }, architecture: { status: "no", rationale: "r" }, data: { status: "no", rationale: "r" }, api: { status: "no", rationale: "r" } },
		openQuestions: [],
	};
	const published = runtime.completeAttempt(workflowId, begin.attemptId, roleResult(workflowId, begin.attemptId, [effectFor("analysis", content, snapshot.id, reqRev)]));
	assert.equal(published.outcome, "published");
	const review = runtime.beginAttempt(workflowId);
	assert.ok(review.taskId > 0, "review-analysis task ready");
	const artifact = runtime.getArtifactRevisionDetail(projection.requirement.id, "analysis");
	assert.ok(artifact);
	runtime.completeAttempt(workflowId, review.attemptId, {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: review.attemptId,
		effects: [],
		criticReport: criticReport(workflowId, review.attemptId, artifact.revisionId),
	});
	const approve = runtime.executeCommand({
		workflowId,
		commandId: "cmd-approve-analysis",
		expectedWorkflowVersion: currentVersion(runtime, workflowId),
		type: "approve-artifact",
		operator: OPERATOR,
		payload: { artifactId: artifact.artifactId, revisionId: artifact.revisionId },
	});
	assert.equal(approve.outcome, "accepted");
	return { artifactId: artifact.artifactId, revisionId: artifact.revisionId };
}

function workspaceIdOf(runtime: HeadlessWorkflowRuntime, workflowId: number): number {
	return runtime.getWorkflowProjection(workflowId)!.requirement.workspaceId;
}

test("trigram 中文子串命中双语料 + workspace 隔离", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await startAndPlan(runtime);
		const workspaceId = workspaceIdOf(runtime, workflowId);
		// asset 语料：直接入库一条含支付网关回调签名的资产
		runtime.createReusableAsset({
			workspaceId,
			kind: "scenario-variant",
			title: "支付网关回调签名场景",
			content: { nodeId: "sv1", title: "支付网关回调签名场景", actors: ["用户", "系统"], preconditions: [], trigger: "回调", mainFlow: ["接收支付网关回调", "校验回调签名", "落账"], alternateFlows: [], expectedOutcome: "落账成功" },
		});
		// artifact 语料：批准 analysis 产物（内容含回调签名校验）
		await produceApproveAnalysis(runtime, workflowId);
		// 子串命中：asset + artifact 双语料均命中
		const hits = runtime.searchWorkspaceContent(workspaceId, "回调签名");
		assert.ok(hits.length >= 2, `expect both corpora hit, got ${hits.length}`);
		const corpora = new Set(hits.map((h) => h.corpus));
		assert.ok(corpora.has("reusable_asset"), "asset corpus hit");
		assert.ok(corpora.has("artifact"), "artifact corpus hit");
		const assetHit = hits.find((h) => h.corpus === "reusable_asset")!;
		assert.ok(assetHit.excerpt.includes("回调签名"), "asset excerpt contains query");
		// 中文子串（连续 >3 字符）
		const hits2 = runtime.searchWorkspaceContent(workspaceId, "支付网关");
		assert.ok(hits2.length >= 1);
		// workspace 隔离：另一 workspace 搜同一词零命中
		const otherWs = runtime.createWorkspace({ repoPath: "/tmp/other", name: "Other" });
		const otherHits = runtime.searchWorkspaceContent(otherWs, "支付网关");
		assert.equal(otherHits.length, 0, "cross-workspace zero hits");
		// 无关词零命中
		const noHits = runtime.searchWorkspaceContent(workspaceId, "积分到期");
		assert.equal(noHits.length, 0);
	});
});

test("归档包 approval_packet 不入检索语料", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const workflowId = await startAndPlan(runtime);
		const workspaceId = workspaceIdOf(runtime, workflowId);
		// 先搜一次推进游标
		runtime.searchWorkspaceContent(workspaceId, "占位");
		// 同一库直插一条归档包内容快照（kind=approval_packet，id 晚于游标）
		const db = new Database(databasePath);
		db.prepare("insert into snapshot_documents(kind, schema_ref, media_type, content, digest, created_at) values ('approval_packet', 'approval-packet/v1', 'application/json', ?, 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ?)").run(
			JSON.stringify({ payload: "支付网关密钥派生归档包内容" }),
			"2026-08-12T11:00:00.000Z",
		);
		db.close();
		// 搜归档内容词 → 零命中
		const hits = runtime.searchWorkspaceContent(workspaceId, "密钥派生归档包");
		assert.equal(hits.length, 0, "archive package must not be indexed");
	});
});

test("增量回填：新资产在游标推进后仍可被检索", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await startAndPlan(runtime);
		const workspaceId = workspaceIdOf(runtime, workflowId);
		runtime.createReusableAsset({ workspaceId, kind: "function-point", title: "签名函数", content: { nodeId: "fp1", title: "签名函数", name: "签名函数", responsibility: "支付验签步骤", inputs: [], outputs: [], businessRules: [], acceptanceCriteria: ["验签"] } });
		// 首次搜索推进游标 + 命中存量
		const first = runtime.searchWorkspaceContent(workspaceId, "验签步骤");
		assert.ok(first.length >= 1);
		// 新增资产（新 snapshot id > 游标）
		runtime.createReusableAsset({ workspaceId, kind: "api", title: "对账接口", content: { detail: "每日对账报告生成与下载" } });
		// 再搜新内容 → 增量回填命中
		const second = runtime.searchWorkspaceContent(workspaceId, "对账报告生成");
		assert.ok(second.length >= 1, "incremental backfill picks up new asset");
		assert.equal(second[0]!.kind, "api");
	});
});

test("增量回填幂等：游标推进后重复搜索不重插 FTS 行", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const workflowId = await startAndPlan(runtime);
		const workspaceId = workspaceIdOf(runtime, workflowId);
		runtime.createReusableAsset({ workspaceId, kind: "scenario-variant", title: "幂等验证场景", content: { nodeId: "sv1", title: "幂等验证场景", actors: ["系统"], preconditions: [], trigger: "回调", mainFlow: ["支付网关回调签名重复回填不发散"], alternateFlows: [], expectedOutcome: "不发散" } });
		runtime.searchWorkspaceContent(workspaceId, "回调签名");
		const db = new Database(databasePath);
		const before = (db.prepare("select count(*) as n from reusable_asset_search").get() as { n: number }).n;
		db.close();
		// 再次搜索（游标已过，无新文档 → 不重插）
		runtime.searchWorkspaceContent(workspaceId, "回调签名");
		const db2 = new Database(databasePath);
		const after = (db2.prepare("select count(*) as n from reusable_asset_search").get() as { n: number }).n;
		db2.close();
		assert.equal(after, before, "insert-only backfill must not duplicate rows");
	});
});

test("<3 unicode 字符查询零命中（trigram 边界）", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await startAndPlan(runtime);
		const workspaceId = workspaceIdOf(runtime, workflowId);
		runtime.createReusableAsset({ workspaceId, kind: "scenario-variant", title: "支付网关", content: { nodeId: "sv1", title: "支付网关", actors: ["用户"], preconditions: [], trigger: "请求", mainFlow: ["支付网关回调"], alternateFlows: [], expectedOutcome: "成功" } });
		// 2 字符无法构成 trigram
		const hits = runtime.searchWorkspaceContent(workspaceId, "支付");
		assert.equal(hits.length, 0);
		// 空/空白查询零命中
		assert.equal(runtime.searchWorkspaceContent(workspaceId, "").length, 0);
		assert.equal(runtime.searchWorkspaceContent(workspaceId, "   ").length, 0);
	});
});


test("同内容多资产（snapshot 全局去重）各自入检索，无 rowid 冲突", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await startAndPlan(runtime);
		const workspaceId = workspaceIdOf(runtime, workflowId);
		// 同 kind 同内容 → snapshot_documents unique(kind,digest) 复用同一 doc id（schemaRef 相同）
		const content = { nodeId: "sv1", title: "复用快照场景", actors: ["系统"], preconditions: [], trigger: "定时", mainFlow: ["支付网关回调签名复用同一快照"], alternateFlows: [], expectedOutcome: "复用成功" };
		runtime.createReusableAsset({ workspaceId, kind: "scenario-variant", title: "资产甲", content });
		runtime.createReusableAsset({ workspaceId, kind: "scenario-variant", title: "资产乙", content });
		const hits = runtime.searchWorkspaceContent(workspaceId, "复用同一快照");
		assert.ok(hits.length >= 2, `both shared-doc assets must hit, got ${hits.length}`);
		const titles = hits.map((h) => h.title).sort();
		assert.ok(titles.includes("资产甲") && titles.includes("资产乙"), "each source gets its own hit row");
	});
});

test("pending artifact 先扫描后批准：账本驱动回填补插", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await startAndPlan(runtime);
		const workspaceId = workspaceIdOf(runtime, workflowId);
		// 只产出 analysis 产物（pending，未 review/approve）
		const projection = runtime.getWorkflowProjection(workflowId)!;
		const reqRev = projection.requirement.currentRevision.id;
		const begin = runtime.beginAttempt(workflowId);
		assert.ok(begin.taskId > 0);
		const snapshot = runtime.bindEvidenceSnapshot(workflowId, "sha256:repo1", [{ path: "a.ts", digest: "sha256:f1", size: 10 }]);
		const content = {
			schemaVersion: "artifact/analysis/v1",
			artifactKind: "analysis",
			summary: "回调签名先扫描后批准场景",
			sourceRefs: [{ type: "requirement_revision", revisionId: reqRev }],
			goals: ["g"],
			nonGoals: [],
			constraints: [],
			acceptanceCriteria: ["ok"],
			impactProfile: { process: { status: "no", rationale: "r" }, actors: { status: "no", rationale: "r" }, behavior: { status: "no", rationale: "r" }, architecture: { status: "no", rationale: "r" }, data: { status: "no", rationale: "r" }, api: { status: "no", rationale: "r" } },
			openQuestions: [],
		};
		runtime.completeAttempt(workflowId, begin.attemptId, roleResult(workflowId, begin.attemptId, [effectFor("analysis", content, snapshot.id, reqRev)]));
		// pending 时搜索：零命中（未批准不入语料）+ backfill 已扫描过该 doc
		const before = runtime.searchWorkspaceContent(workspaceId, "先扫描后批准");
		assert.equal(before.length, 0, "pending artifact not indexed");
		// 补 review + approve → 账本驱动回填应补插
		const review = runtime.beginAttempt(workflowId);
		assert.ok(review.taskId > 0);
		const artifact = runtime.getArtifactRevisionDetail(projection.requirement.id, "analysis");
		assert.ok(artifact);
		runtime.completeAttempt(workflowId, review.attemptId, {
			schemaVersion: "role-result/v1",
			workflowId,
			attemptId: review.attemptId,
			effects: [],
			criticReport: criticReport(workflowId, review.attemptId, artifact.revisionId),
		});
		const approve = runtime.executeCommand({
			workflowId,
			commandId: "cmd-approve-analysis",
			expectedWorkflowVersion: currentVersion(runtime, workflowId),
			type: "approve-artifact",
			operator: OPERATOR,
			payload: { artifactId: artifact.artifactId, revisionId: artifact.revisionId },
		});
		assert.equal(approve.outcome, "accepted");
		const after = runtime.searchWorkspaceContent(workspaceId, "先扫描后批准");
		assert.ok(after.length >= 1, "approved-after-scan doc backfilled on next search");
		assert.equal(after[0]!.corpus, "artifact");
	});
});
