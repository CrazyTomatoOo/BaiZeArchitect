import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
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
import type { AssetReference } from "./workflow/role-result.ts";

/**
 * #24 回授注入语义测试：
 * - 规划期注入：模板实例化时按需求标题检索 top-N 资产引用（plan revision 快照冻结）
 * - 生产角色注入：scenario-analyst 等 Attempt 的 Context Manifest 带 relevantAssets；critic 无注入
 * - 冻结语义：manifest/plan 冻结后检索库新增不影响已冻结引用（digest 不变）
 * - 预算截断：超过 FEEDBACK_REFERENCE_BUDGET 的命中只注入 top-N
 */

const BASELINE_A: RequirementBaseline = {
	schemaVersion: "artifact/requirement/v1",
	artifactKind: "requirement",
	summary: "支付网关回调签名相关需求",
	sourceRefs: [],
	title: "支付网关回调签名改造",
	description: "回调签名校验逻辑调整。",
};

const OPERATOR: FixtureOperator = createFixtureOperator("alice");

async function withRuntime(
	work: (fixture: { runtime: HeadlessWorkflowRuntime; databasePath: string }) => Promise<void> | void,
): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-feedback-"));
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

function createWorkspace(runtime: HeadlessWorkflowRuntime, tag: string): number {
	return runtime.createWorkspace({ repoPath: `/tmp/repo-${tag}`, name: `Repo-${tag}` });
}

let startCommandSeq = 0;

async function createStartedWorkflow(runtime: HeadlessWorkflowRuntime, workspaceId: number, baseline: RequirementBaseline): Promise<number> {
	const created = runtime.createRequirement({ workspaceId, baseline });
	const start = runtime.executeCommand({
		workflowId: created.workflowId,
		commandId: `cmd-start-${startCommandSeq++}`,
		expectedWorkflowVersion: 0,
		type: "start",
		operator: OPERATOR,
	});
	if (start.outcome !== "accepted") throw new Error(`start rejected: ${start.outcome}`);
	return created.workflowId;
}

async function plan(runtime: HeadlessWorkflowRuntime, workflowId: number): Promise<void> {
	const result = await runtime.planWorkflow(workflowId, null);
	assert.equal(result.outcome, "adopted");
}

/** 直读 plan_revisions.proposal_document_id 对应快照的 assetReferences。 */
function readProposalReferences(db: Database.Database, runtime: HeadlessWorkflowRuntime, workflowId: number): readonly AssetReference[] {
	const projection = runtime.getWorkflowProjection(workflowId)!;
	const planRevisionId = projection.workflow.currentPlanRevisionId;
	assert.ok(planRevisionId, "plan revision exists");
	const rev = db.prepare("select proposal_document_id from plan_revisions where id = ?").get(planRevisionId) as { proposal_document_id: number };
	const row = db.prepare("select content from snapshot_documents where id = ?").get(rev.proposal_document_id) as { content: string };
	const proposal = JSON.parse(row.content) as { assetReferences?: readonly AssetReference[] };
	return proposal.assetReferences ?? [];
}

/** 直读 context_manifest 快照的 relevantAssets。 */
function readManifestRelevantAssets(db: Database.Database, runtime: HeadlessWorkflowRuntime, attemptId: number): readonly AssetReference[] | undefined {
	const detail = runtime.getAttemptDetail(attemptId)!;
	const documentId = detail.contextManifest!.documentId;
	const row = db.prepare("select content from snapshot_documents where id = ?").get(documentId) as { content: string };
	const manifest = JSON.parse(row.content) as { relevantAssets?: readonly AssetReference[] };
	return manifest.relevantAssets;
}

test("规划期注入：按需求标题检索 top-N 历史资产（预算截断）", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const ws = createWorkspace(runtime, "a");
		const wfA = await createStartedWorkflow(runtime, ws, BASELINE_A);
		for (let i = 1; i <= 5; i += 1) {
			runtime.createReusableAsset({ workspaceId: ws, kind: "scenario-variant", title: `回调场景 ${i}`, content: { nodeId: `sv${i}`, title: `回调场景 ${i}`, actors: ["a"], preconditions: [], trigger: "t", mainFlow: [`支付网关回调签名校验步骤 ${i}`], alternateFlows: [], expectedOutcome: "o" } });
		}
		await plan(runtime, wfA);
		// 同 workspace 新需求（标题命中历史）→ 规划期注入
		const wfB = await createStartedWorkflow(runtime, ws, {
			schemaVersion: "artifact/requirement/v1",
			artifactKind: "requirement",
			summary: "回调签名二期",
			sourceRefs: [],
			title: "支付网关回调签名二期",
			description: "二期改造。",
		});
		await plan(runtime, wfB);
		const db = new Database(databasePath);
		const refs = readProposalReferences(db, runtime, wfB);
		db.close();
		assert.ok(refs.length > 0, "planning injection found historical assets");
		assert.ok(refs.length <= 3, "budget caps at 3 references");
		for (const ref of refs) {
			assert.ok(ref.title.includes("回调场景"), "references come from historical assets");
			assert.ok(ref.excerpt.length > 0, "excerpt present");
			assert.ok(ref.kind === "scenario-variant", "kind preserved");
		}
	});
});

test("生产角色注入：manifest 带 relevantAssets；critic 无注入", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const ws = createWorkspace(runtime, "prod");
		const db = new Database(databasePath);
		const wfProd = await createStartedWorkflow(runtime, ws, BASELINE_A);
		runtime.createReusableAsset({ workspaceId: ws, kind: "scenario-variant", title: "回调脱敏场景", content: { nodeId: "v2", title: "回调脱敏场景", actors: ["a"], preconditions: [], trigger: "t", mainFlow: ["支付网关回调签名脱敏处理"], alternateFlows: [], expectedOutcome: "o" } });
		await plan(runtime, wfProd);
		// 生产角色（analysis-analyst 为首个模板任务）→ manifest 注入 relevantAssets
		const beginProd = runtime.beginAttempt(wfProd);
		assert.equal(beginProd.taskRole, "analysis-analyst", "first template task is producer");
		const prodRefs = readManifestRelevantAssets(db, runtime, beginProd.attemptId);
		assert.ok(prodRefs && prodRefs.length > 0, "producer manifest carries relevantAssets");
		// 完成 producer publish（空 effect 走 review 就绪——用合法 analysis roleResult）
		// 发布 analysis 产物 → review-analysis 任务开启 → critic manifest 无注入
		const projection = runtime.getWorkflowProjection(wfProd)!;
		const reqRev = projection.requirement.currentRevision.id;
		const snapshot = runtime.bindEvidenceSnapshot(wfProd, "sha256:repo1", [{ path: "a.ts", digest: "sha256:f1", size: 10 }]);
		const content = {
			schemaVersion: "artifact/analysis/v1",
			artifactKind: "analysis",
			summary: "回调签名分析",
			sourceRefs: [{ type: "requirement_revision", revisionId: reqRev }],
			goals: ["g"], nonGoals: [], constraints: [],
			acceptanceCriteria: ["ok"],
			impactProfile: { process: { status: "no", rationale: "r" }, actors: { status: "no", rationale: "r" }, behavior: { status: "no", rationale: "r" }, architecture: { status: "no", rationale: "r" }, data: { status: "no", rationale: "r" }, api: { status: "no", rationale: "r" } },
			openQuestions: [],
		};
		const pub = runtime.completeAttempt(wfProd, beginProd.attemptId, {
			schemaVersion: "role-result/v1",
			workflowId: wfProd,
			attemptId: beginProd.attemptId,
			effects: [{
				effectType: "artifact_revision",
				artifactKind: "analysis",
				logicalKey: "analysis",
				content,
				baseRevisionId: null,
				traceLinks: [{ evidenceSnapshotId: snapshot.id, sourceRef: { type: "requirement_revision", revisionId: reqRev } }],
			}],
		});
		assert.equal(pub.outcome, "published");
		// 下一任务 = review-analysis（critic）
		const beginCritic = runtime.beginAttempt(wfProd);
		assert.equal(beginCritic.taskRole, "critic", "second task is review-analysis");
		const criticRefs = readManifestRelevantAssets(db, runtime, beginCritic.attemptId);
		assert.equal(criticRefs, undefined, "critic receives no relevantAssets");
		db.close();
	});
});

test("冻结语义：Manifest 冻结后检索库变化不影响已注入引用", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = createWorkspace(runtime, "x");
		const wfA = await createStartedWorkflow(runtime, ws, BASELINE_A);
		runtime.createReusableAsset({ workspaceId: ws, kind: "scenario-variant", title: "回调场景甲", content: { nodeId: "v3", title: "回调场景甲", actors: ["a"], preconditions: [], trigger: "t", mainFlow: ["支付网关回调签名校验"], alternateFlows: [], expectedOutcome: "o" } });
		await plan(runtime, wfA);
		const begin1 = runtime.beginAttempt(wfA);
		assert.ok(begin1.taskId > 0);
		const dig1 = runtime.getAttemptDetail(begin1.attemptId)!.contextManifest!.digest;
		// 检索库新增资产（后续沉淀）
		runtime.createReusableAsset({ workspaceId: ws, kind: "api", title: "回调接口乙", content: { steps: ["支付网关回调签名接口"] } });
		// 已冻结 manifest 不变（同 manifest 文档 → 同 digest）
		const dig1b = runtime.getAttemptDetail(begin1.attemptId)!.contextManifest!.digest;
		assert.equal(dig1b, dig1, "frozen manifest digest stable after corpus change");
	});
});

test("预算截断：>3 命中只注入 top-3", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = createWorkspace(runtime, "x");
		const wfA = await createStartedWorkflow(runtime, ws, BASELINE_A);
		for (let i = 1; i <= 5; i += 1) {
		runtime.createReusableAsset({ workspaceId: ws, kind: "function-point", title: `支付网关回调签名函数 ${i}`, content: { nodeId: `fp${i}`, title: `支付网关回调签名函数 ${i}`, name: `支付网关回调签名函数 ${i}`, responsibility: "支付", inputs: [], outputs: [], businessRules: [], acceptanceCriteria: ["支付网关回调签名验收"] } });
		}
		const refs = runtime.getFeedbackAssetReferences(wfA, "支付网关回调签名", 3);
		assert.equal(refs.length, 3, "budget trims to exactly 3");
		const refs2 = runtime.getFeedbackAssetReferences(wfA, "支付网关回调签名", 10);
		assert.ok(refs2.length <= 5, "capped by available corpus");
	});
});


test("注入摘要为命中窗口（非全文头部）+ 本需求 promote 资产被排除", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const ws = createWorkspace(runtime, "excl");
		const db = new Database(databasePath);
		// 历史资产：标题/内容含标题子串（滑窗命中）
		const wfHis = await createStartedWorkflow(runtime, ws, BASELINE_A);
		runtime.createReusableAsset({ workspaceId: ws, kind: "scenario-variant", title: "旧回调场景", content: { nodeId: "v4", title: "旧回调场景", actors: ["a"], preconditions: [], trigger: "t", mainFlow: ["前置说明部分较长内容占位占位占位支付网关回调签名校验逻辑是重点内容后续还有"], alternateFlows: [], expectedOutcome: "o" } });
		await plan(runtime, wfHis);
		// 本需求自身 promote 一条命中资产（应被 own-requirement 排除）
		// 新需求标题命中：注入只含 wfHis 的历史资产，不含本需求自己 promote 的
		const wfNew = await createStartedWorkflow(runtime, ws, {
			schemaVersion: "artifact/requirement/v1",
			artifactKind: "requirement",
			summary: "回调整改",
			sourceRefs: [],
			title: "支付网关回调签名改造",
			description: "改造。",
		});
		// 本需求 promote 产生的资产带 origin_requirement_id（用 db 直设模拟 promote 写入语义）
		const own = runtime.createReusableAsset({ workspaceId: ws, kind: "usecase", title: "本需求用例", content: { detail: "支付网关回调签名本需求自己的用例说明" } });
		const ownRequirementId = runtime.getWorkflowProjection(wfNew)!.requirement.id;
		db.prepare("update reusable_assets set origin_requirement_id = ? where id = ?").run(ownRequirementId, own.assetId);
		await plan(runtime, wfNew);
		const refs = readProposalReferences(db, runtime, wfNew);
		assert.ok(refs.length > 0, "injection present");
		// own-requirement 排除：本需求 promote 的资产不在引用里
		assert.equal(refs.some((r) => r.title === "本需求用例"), false, "own-requirement asset excluded");
		// 滑窗命中摘要：excerpt 包含命中窗口（支付网关回调），而非仅头部占位
		const historical = refs.find((r) => r.title === "旧回调场景");
		assert.ok(historical, "historical asset referenced");
		assert.ok(historical.excerpt.includes("支付网关回调签名校验逻辑"), "excerpt centered on matched window");
		db.close();
	});
});


test("预算常量与契约 maxItems 同步", async () => {
	const { FEEDBACK_REFERENCE_BUDGET } = await import("./persistence/workflow-store.js");
	const schema = JSON.parse(readFileSync(path.join(import.meta.dirname, "contracts", "plan-proposal-v1.schema.json"), "utf8")) as { properties: { assetReferences: { maxItems: number } } };
	assert.equal(schema.properties.assetReferences.maxItems, FEEDBACK_REFERENCE_BUDGET, "schema cap must equal runtime budget");
});
