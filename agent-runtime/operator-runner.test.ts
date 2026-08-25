import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
	createCrashInjector,
	createFixtureClock,
	createFixtureOperator,
	createHashProvider,
	createOutboxTransport,
} from "./testing/deterministic-fixtures.js";
import { openHeadlessWorkflowRuntime } from "./workflow/headless-runtime.js";
import { runReadyTasks } from "./workflow/operator-server.js";
import type { ModelDriver } from "./workflow/model-driver.js";
import type { RequirementBaseline } from "./workflow/requirement.js";

/**
 * 就绪任务接线 e2e — 复刻 start 命令的生产驱动链(planWorkflow → runReadyTasks),
 * 验证 C1 + C2:命令接受后引擎链式驱动首个就绪任务(analyze)并发布产物,不再静默卡死。
 * 修复前:main.ts 里 modelDriver 被 void 弃用、executeTask 无生产调用方,工作流永久卡死在 planning 之后。
 */

const ADMIN = createFixtureOperator("admin");

function baseline(): RequirementBaseline {
	return {
		schemaVersion: "artifact/requirement/v1",
		artifactKind: "requirement",
		summary: "Runner wiring regression",
		sourceRefs: [],
		title: "Runner wiring regression",
		description: "start 命令必须链式驱动就绪任务执行",
	};
}

function validAnalysisContent(): unknown {
	return {
		schemaVersion: "artifact/analysis/v1",
		artifactKind: "analysis",
		summary: "Analysis of expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		goals: ["Understand the domain"],
		nonGoals: [],
		constraints: [],
		acceptanceCriteria: ["ok"],
		impactProfile: {
			process: { status: "yes", rationale: "r" },
			actors: { status: "no", rationale: "r" },
			behavior: { status: "no", rationale: "r" },
			architecture: { status: "no", rationale: "r" },
			data: { status: "no", rationale: "r" },
			api: { status: "no", rationale: "r" },
		},
		openQuestions: [],
	};
}

/** 通配驱动:analysis-analyst 产出带 TraceLink 的 analysis 产物,其余角色空效果(测试不关心后续任务)。 */
function wildcardAnalysisDriver(databasePath: string, workflowId: number, evidenceSnapshotId: number): ModelDriver {
	const database = new Database(databasePath, { readonly: true });
	return {
		async execute(input) {
			// publishAttemptResult 严格校验 result.workflowId/attemptId === 实际值;
			// 真实驱动由模型回传,测试驱动从 DB 取当前最新 attempt(executeTask 的 beginAttempt 先于本调用提交)。
			const attempt = database
				.prepare("select id from task_attempts where workflow_id = ? order by id desc limit 1")
				.get(workflowId) as { id: number };
			const effects =
				input.role === "analysis-analyst"
					? [
							{
								effectType: "artifact_revision",
								artifactKind: "analysis",
								logicalKey: "analysis",
								content: validAnalysisContent(),
								baseRevisionId: null,
								traceLinks: [{ evidenceSnapshotId, sourceRef: { type: "requirement_revision", revisionId: 1 } }],
							},
						]
					: [];
			return {
				structuredResult: { schemaVersion: "role-result/v1", workflowId, attemptId: attempt.id, effects },
				modelUsage: { provider: "test", modelId: "test", inputTokens: 0, outputTokens: 0 },
			};
		},
	};
}

function queryTaskStatus(database: Database.Database, workflowId: number, key: string): string | undefined {
	const row = database.prepare("select status from tasks where workflow_id = ? and key = ? order by id desc limit 1").get(workflowId, key) as { status: string } | undefined;
	return row?.status;
}

test("runReadyTasks 链式驱动就绪任务并发布产物(不再静默卡死)", async () => {
	const directory = mkdtempSync(join(tmpdir(), "operator-runner-flow-"));
	const databasePath = join(directory, "test.db");
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector(),
		outboxTransport: createOutboxTransport(),
	});
	const workspaceId = runtime.createWorkspace({ repoPath: "/repo", name: "repo" });
	const workflowId = runtime.createRequirement({ workspaceId, baseline: baseline() }).workflowId;
	// analysis 发布要求 TraceLink:先绑仓库快照,把 evidenceSnapshotId 注入驱动
	runtime.bindEvidenceSnapshot(workflowId, "sha256:repo1", []);
	const evidenceSnapshotId = runtime.getEvidenceSnapshots(workflowId)[0]!.id;
	const modelDriver = wildcardAnalysisDriver(databasePath, workflowId, evidenceSnapshotId);

	// 复刻 operator-server start 命令接受后的生产驱动链
	runtime.executeCommand({ workflowId, commandId: "c", expectedWorkflowVersion: 0, type: "start", operator: ADMIN });
	const plan = await runtime.planWorkflow(workflowId, null);
	assert.equal(plan.outcome, "adopted");
	await runReadyTasks(runtime, modelDriver, workflowId);

	const database = new Database(databasePath, { readonly: true });
	try {
		// C1 接线:就绪任务被驱动并发布 analysis 产物
		const revision = database
			.prepare("select ar.id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.kind = 'analysis'")
			.get() as { id: number } | undefined;
		assert.ok(revision, "analysis artifact revision must be published by the ready-task runner");

		// C2 结算:规划任务完成,analyze 任务完成
		assert.equal(queryTaskStatus(database, workflowId, "plan"), "completed");
		assert.equal(queryTaskStatus(database, workflowId, "analyze"), "completed");

		// claim 已释放(无残留活动声明),事件含 task_completed + artifact_revision_published
		const claims = database.prepare("select status from governance_claims where workflow_id = ?").all(workflowId) as Array<{ status: string }>;
		assert.ok(claims.every((claim) => claim.status !== "active"), "no claim may remain active after publication");
		const types = (database.prepare("select type from workflow_events where workflow_id = ? order by seq").all(workflowId) as Array<{ type: string }>).map((event) => event.type);
		assert.ok(types.includes("task_completed"));
		assert.ok(types.includes("artifact_revision_published"));
	} finally {
		database.close();
		runtime.close();
		rmSync(directory, { recursive: true, force: true });
	}
});