import { describe, expect, it } from "vitest";

import workflowComponentSource from "./baize-workflow.ts?raw";
import workflowClientSource from "./workflow-client.ts?raw";
import workspaceManagerSource from "./baize-workspace-manager.ts?raw";
import shellSource from "./baize-shell.ts?raw";
import indexSource from "../index.html?raw";
import assetLibrarySource from "./baize-asset-library.ts?raw";
import {
	artifactSummary,
	createWorkspaceErrorCopy,
	deleteWorkspaceErrorCopy,
	designStages,
	gateQueue,
	normalizeWorkspaceInput,
	packetReviewDrift,
	pendingCounts,
	recoveryActions,
	resolveStoredWorkspace,
	stateHero,
	WorkspaceApiError,
	type WorkflowProjection,
	type WorkflowState,
} from "./workflow-client";

function projection(overrides: Partial<Omit<WorkflowProjection, "workflow">> & { workflow?: Partial<WorkflowProjection["workflow"]> } = {}): WorkflowProjection {
	const { workflow, ...rest } = overrides;
	return {
		workflow: {
			id: 7,
			state: "running",
			version: 3,
			lastEventSeq: 9,
			currentFailureCode: null,
			policyBundle: { documentId: 5, digest: "sha256:" + "a".repeat(64) },
			...workflow,
		},
		requirement: {
			id: 1,
			workspaceId: 2,
			title: "示例需求",
			version: 1,
			currentRevision: { id: 11, revisionNo: 1, status: "approved", digest: "sha256:" + "b".repeat(64), schemaRef: "artifact/requirement/v1" },
		},
		designSession: { id: 4, status: "active", sessionId: "design-session:1" },
		currentPlan: { id: 3, revisionNo: 1, status: "active", proposalDigest: "sha256:" + "c".repeat(64), createdAt: "2026-08-12T10:00:00.000Z" },
		tasks: [],
		activeClaim: null,
		activeRun: null,
		openGates: [],
		decisions: [],
		findings: [],
		findingThreads: [],
		readiness: {
			workflowId: 7,
			ready: false,
			checks: [
				{ name: "complete_required_artifacts", passed: false, detail: "3/5 kinds 已有当前 revision" },
				{ name: "terminal_current_work", passed: false, detail: "存在未终结 Task" },
			],
			warnings: [],
		},
		currentPacket: null,
		currentIncident: null,
		...rest,
	};
}

describe("stateHero — 每个治理状态恰好一个主动作", () => {
	const states: WorkflowState[] = ["pending", "running", "waiting_for_human", "paused", "failed", "ready_to_archive", "archived"];

	it("七种状态均有标题、描述和恰好一个主动作", () => {
		for (const state of states) {
			const hero = stateHero(state);
			expect(hero.title.length).toBeGreaterThan(0);
			expect(hero.description.length).toBeGreaterThan(0);
			expect(hero.action.label.length).toBeGreaterThan(0);
		}
	});

	it("pending 主动作是 start 命令", () => {
		expect(stateHero("pending").action).toEqual({ label: "开始", kind: "command", commandType: "start" });
	});

	it("paused 主动作是 resume 命令", () => {
		expect(stateHero("paused").action).toEqual({ label: "继续", kind: "command", commandType: "resume" });
	});

	it("running 主动作只展开进度,不是治理命令", () => {
		const action = stateHero("running").action;
		expect(action.kind).toBe("expand");
		expect(action.commandType).toBeUndefined();
	});

	it("waiting_for_human 与 failed 主动作展开详情而非命令", () => {
		expect(stateHero("waiting_for_human").action.kind).toBe("expand");
		expect(stateHero("failed").action.kind).toBe("expand");
	});

	it("ready_to_archive 主动作打开批准包视图", () => {
		expect(stateHero("ready_to_archive").action.kind).toBe("expand");
	});

	it("archived 主动作导航到设计包", () => {
		expect(stateHero("archived").action.kind).toBe("package");
	});
});

describe("designStages — 五段设计进程", () => {
	it("无 Task 时除计划外全部 pending,approve 依状态", () => {
		const stages = designStages(projection({ currentPlan: null }));
		expect(stages.map((stage) => stage.key)).toEqual(["plan", "analyze", "design", "review", "approve"]);
		expect(stages.find((stage) => stage.key === "approve")?.status).toBe("pending");
	});

	it("analyze 任务进行中时该段 active,完成的段为 done", () => {
		const stages = designStages(
			projection({
				tasks: [
					{ id: 1, key: "plan-1", kind: "plan", role: "orchestrator", status: "completed", maxAttempts: 2, latestAttempt: null },
					{ id: 2, key: "analyze-1", kind: "analyze", role: "analyst", status: "in_progress", maxAttempts: 3, latestAttempt: { id: 9, attemptNo: 1, status: "running" } },
					{ id: 3, key: "design-1", kind: "design", role: "architect", status: "pending", maxAttempts: 3, latestAttempt: null },
				],
			}),
		);
		expect(stages.find((stage) => stage.key === "plan")?.status).toBe("done");
		expect(stages.find((stage) => stage.key === "analyze")?.status).toBe("active");
		expect(stages.find((stage) => stage.key === "design")?.status).toBe("pending");
	});

	it("archived 时批准段 done;ready_to_archive 时 active", () => {
		expect(designStages(projection({ workflow: { state: "archived" } })).find((stage) => stage.key === "approve")?.status).toBe("done");
		expect(designStages(projection({ workflow: { state: "ready_to_archive" } })).find((stage) => stage.key === "approve")?.status).toBe("active");
	});

	it("review 段聚合 review/rework/verify 三类 Task", () => {
		const stages = designStages(
			projection({
				tasks: [
					{ id: 4, key: "review-1", kind: "review", role: "critic", status: "completed", maxAttempts: 3, latestAttempt: null },
					{ id: 5, key: "verify-1", kind: "verify", role: "critic", status: "in_progress", maxAttempts: 3, latestAttempt: null },
				],
			}),
		);
		expect(stages.find((stage) => stage.key === "review")?.status).toBe("active");
	});
});

describe("pendingCounts 与 artifactSummary", () => {
	it("统计打开的门禁、未处置 Decision 与未关闭 Finding", () => {
		const counts = pendingCounts(
			projection({
				openGates: [{ id: 1, gateType: "human_input", subjectType: "task", subjectId: 2, openedAt: "2026-08-12T10:00:00.000Z" }],
				decisions: [
					{ id: 1, severity: "major", status: "open", summary: "选型" },
					{ id: 2, severity: "minor", status: "accepted", summary: "已定" },
				],
				findings: [
					{ id: 1, threadId: 1, severity: "critical", status: "open", summary: "缺陷", targetRevisionId: 5 },
					{ id: 2, threadId: 2, severity: "info", status: "disclosed", summary: "提示", targetRevisionId: 5 },
				],
			}),
		);
		expect(counts).toEqual({ gates: 1, decisions: 1, findings: 1 });
	});

	it("Artifact 摘要来自 complete_required_artifacts 检查详情", () => {
		expect(artifactSummary(projection())).toBe("3/5 kinds 已有当前 revision");
		expect(artifactSummary({ ...projection(), readiness: { workflowId: 7, ready: false, checks: [], warnings: [] } })).toBe("尚无 Impact Profile");
	});
});

describe("gateQueue — 确定性门禁队列", () => {
	it("按 critical Decision → Human Input → Finding 处置 → Incident 恢复排序,同级按 id 升序", () => {
		const queue = gateQueue(
			projection({
				workflow: { state: "waiting_for_human" },
				decisions: [
					{ id: 5, severity: "critical", status: "open", summary: "关键选型 B" },
					{ id: 2, severity: "critical", status: "open", summary: "关键选型 A" },
					{ id: 1, severity: "major", status: "open", summary: "非 critical 不入队" },
				],
				openGates: [
					{ id: 9, gateType: "finding_disposition", subjectType: "finding_thread", subjectId: 3, openedAt: "t" },
					{ id: 4, gateType: "human_input", subjectType: "task_attempt", subjectId: 8, openedAt: "t" },
				],
				findings: [{ id: 21, threadId: 3, severity: "major", status: "open", summary: "重大缺陷", targetRevisionId: 55 }],
				currentIncident: { id: 6, incidentType: "outbox_exhausted", failureCode: "outbox_exhausted", status: "open", createdAt: "t" },
			}),
		);
		expect(queue.map((item) => item.key)).toEqual(["decision:2", "decision:5", "gate:4", "gate:9", "incident:6"]);
		expect(queue.map((item) => item.position)).toEqual([1, 2, 3, 4, 5]);
		expect(queue.map((item) => item.commandType)).toEqual([
			"dispose-decision",
			"dispose-decision",
			"provide-human-input",
			"accept-finding-risk",
			"retry-recovery",
		]);
	});

	it("finding 处置项从同 thread 的 open Finding 预填 findingId/targetRevisionId", () => {
		const queue = gateQueue(
			projection({
				openGates: [{ id: 9, gateType: "finding_disposition", subjectType: "finding_thread", subjectId: 3, openedAt: "t" }],
				findings: [
					{ id: 20, threadId: 3, severity: "major", status: "resolved", summary: "旧", targetRevisionId: 50 },
					{ id: 21, threadId: 3, severity: "major", status: "open", summary: "重大缺陷", targetRevisionId: 55 },
				],
			}),
		);
		expect(queue).toHaveLength(1);
		expect(queue[0]).toMatchObject({ category: "finding_disposition", findingId: 21, targetRevisionId: 55, title: "重大缺陷" });
	});

	it("无门禁/Decision/Incident 时队列为空", () => {
		expect(gateQueue(projection())).toEqual([]);
	});
});

describe("recoveryActions — 每类失败只给出合法恢复组合", () => {
	it("task_budget_exhausted → retry-task + diagnostic-run", () => {
		const actions = recoveryActions(
			projection({
				workflow: { state: "failed", currentFailureCode: "task_budget_exhausted" },
				tasks: [
					{ id: 31, key: "analyze-1", kind: "analyze", role: "analyst", status: "failed", maxAttempts: 3, latestAttempt: null },
				],
			}),
		);
		expect(actions.map((action) => action.commandType)).toEqual(["retry-task", "diagnostic-run"]);
		expect(actions[0].payload).toEqual({ taskId: 31 });
	});

	it("planning_exhausted → retry-planning + diagnostic-run", () => {
		const actions = recoveryActions(projection({ workflow: { state: "failed", currentFailureCode: "planning_exhausted" } }));
		expect(actions.map((action) => action.commandType)).toEqual(["retry-planning", "diagnostic-run"]);
	});

	it("outbox Incident → retry-recovery + diagnostic-run(不含 retry-task)", () => {
		const actions = recoveryActions(
			projection({
				workflow: { state: "failed", currentFailureCode: "outbox_exhausted" },
				currentIncident: { id: 6, incidentType: "outbox_exhausted", failureCode: "outbox_exhausted", status: "open", createdAt: "t" },
			}),
		);
		expect(actions.map((action) => action.commandType)).toEqual(["retry-recovery", "diagnostic-run"]);
		expect(actions[0].payload).toEqual({ incidentId: 6 });
	});

	it("running 状态无恢复动作", () => {
		expect(recoveryActions(projection())).toEqual([]);
	});
});

describe("packetReviewDrift — Packet 绑定与 stale 判定", () => {
	const context = { packetId: 9, digest: "sha256:" + "d".repeat(64), workflowVersion: 5 };

	it("Packet 身份、digest、版本一致时不 stale", () => {
		const view = projection({
			workflow: { state: "ready_to_archive", version: 5 },
			currentPacket: { id: 9, digest: context.digest, status: "current", createdAt: "t" },
		});
		expect(packetReviewDrift(view, context)).toBeNull();
	});

	it("digest 改变 → stale 并给出 expected/actual diff", () => {
		const view = projection({
			workflow: { state: "ready_to_archive", version: 5 },
			currentPacket: { id: 10, digest: "sha256:" + "e".repeat(64), status: "current", createdAt: "t" },
		});
		const drift = packetReviewDrift(view, context);
		expect(drift).not.toBeNull();
		expect(drift!.expectedDigest).toBe(context.digest);
		expect(drift!.actualDigest).toBe("sha256:" + "e".repeat(64));
		expect(drift!.actualPacketId).toBe(10);
	});

	it("Workflow 版本前进(pause 保留 Packet)也判定 stale,因为 approve 绑定 expectedWorkflowVersion", () => {
		const view = projection({
			workflow: { state: "ready_to_archive", version: 6 },
			currentPacket: { id: 9, digest: context.digest, status: "current", createdAt: "t" },
		});
		const drift = packetReviewDrift(view, context);
		expect(drift).not.toBeNull();
		expect(drift!.actualWorkflowVersion).toBe(6);
	});

	it("Packet 被撤回(currentPacket 为 null)→ stale", () => {
		const view = projection({ workflow: { state: "running", version: 6 }, currentPacket: null });
		const drift = packetReviewDrift(view, context);
		expect(drift).not.toBeNull();
		expect(drift!.actualPacketId).toBeNull();
		expect(drift!.actualDigest).toBeNull();
	});
});

describe("禁止的遗留控件 — Web 不包含 Reviewer/角色选择/自由 Prompt/direct archive/force 控件", () => {
	const sources = [workflowComponentSource, workflowClientSource];
	const combined = sources.join("\n");

	it("无 Reviewer Agent、角色选择、自由 Prompt Run 控件", () => {
		expect(combined).not.toMatch(/Reviewer/);
		expect(combined).not.toMatch(/角色选择/);
		expect(combined).not.toMatch(/自由\s*Prompt/i);
	});

	it("无 direct archive、force-ready、force-skip 命令或端点", () => {
		expect(combined).not.toMatch(/force-ready|force-skip|force_skip|force_ready/);
		expect(combined).not.toMatch(/"direct-archive"|directArchive/);
		expect(combined).not.toMatch(/\/api\/requirements\/\$\{[^}]*\}\/archive/);
	});

	it("只使用统一命令端点,不使用已移除的旧 Run 端点", () => {
		expect(combined).not.toMatch(/\/api\/requirements\/[^`]*\/runs/);
		expect(combined).not.toMatch(/\/api\/runs\/[^`]*\/(steer|cancel)/);
		expect(combined).toContain("/commands/");
	});
});

// ---------------------------------------------------------------------------
// 工作区管理页(票 09/10/04):输入归一 + 错误文案映射 + 负向扫描
// ---------------------------------------------------------------------------

describe("normalizeWorkspaceInput — 创建输入 trim 归一", () => {
	it("trim 名称与仓库路径", () => {
		expect(normalizeWorkspaceInput("  工作区 A  ", "  /repo/a  ")).toEqual({ name: "工作区 A", repoPath: "/repo/a" });
	});

	it("任一为空白 → null(服务端 400 同语义)", () => {
		expect(normalizeWorkspaceInput("", "/repo/a")).toBeNull();
		expect(normalizeWorkspaceInput("   ", "/repo/a")).toBeNull();
		expect(normalizeWorkspaceInput("工作区 A", "")).toBeNull();
		expect(normalizeWorkspaceInput("工作区 A", "   ")).toBeNull();
	});
});

describe("createWorkspaceErrorCopy — 400/409 行内文案", () => {
	it("malformed_workspace → 必填提示", () => {
		expect(createWorkspaceErrorCopy(new WorkspaceApiError(400, "malformed_workspace", "x"))).toContain("必填");
	});

	it("duplicate_repo_path → 路径已被使用提示", () => {
		expect(createWorkspaceErrorCopy(new WorkspaceApiError(409, "duplicate_repo_path", "x"))).toContain("已在其他工作区使用");
	});

	it("未知错误回退通用文案", () => {
		expect(createWorkspaceErrorCopy(new Error("网络错误"))).toBe("网络错误");
	});
});

describe("deleteWorkspaceErrorCopy — 409 busy / 404 行内文案", () => {
	it("workspace_busy → 引擎在飞提示", () => {
		expect(deleteWorkspaceErrorCopy(new WorkspaceApiError(409, "workspace_busy", "x"))).toContain("在飞");
	});

	it("unknown_workspace → 已不存在提示", () => {
		expect(deleteWorkspaceErrorCopy(new WorkspaceApiError(404, "unknown_workspace", "x"))).toContain("已不存在");
	});

	it("未知错误回退通用文案", () => {
		expect(deleteWorkspaceErrorCopy(new Error("网络错误"))).toBe("网络错误");
	});
});

describe("baize-workspace-manager — 管理页安全约定", () => {
	it("注册为 baize-workspace-manager 且不使用已删除的 baize-workspaces 名", () => {
		expect(workspaceManagerSource).toContain('customElements.define("baize-workspace-manager"');
		expect(workspaceManagerSource).not.toMatch(/baize-workspaces(?:\.|")/);
	});

	it("删除确认走行内两步 dialog,绝无 window.confirm", () => {
		expect(workspaceManagerSource).toContain('role="dialog"');
		expect(workspaceManagerSource).not.toMatch(/window\.confirm/);
		expect(workspaceManagerSource).not.toMatch(/confirm\(\s*["']/);
		expect(workspaceManagerSource).toContain("不可恢复");
	});

	it("对外事件契约:进入/创建后直接进入 + 删除成功通知", () => {
		expect(workspaceManagerSource).toContain("baize-enter-workspace");
		expect(workspaceManagerSource).toContain("baize-workspace-deleted");
	});

	it("删除在飞时禁用全部行操作(防删除竞态,决议 10)", () => {
		expect(workspaceManagerSource).toMatch(/\?disabled=\$\{this\.deletingId !== null\}[\s\S]*>删除</);
	});

	it("行容器为 div 而非 button(防按钮嵌套)", () => {
		const rowMarkup = workspaceManagerSource.match(/<div class="card item \$\{[\s\S]*?<div class="row">/);
		expect(rowMarkup).not.toBeNull();
	});

	it("整卡可点击进入 + 持有 workspaceId 标识当前工作区(ADR-012),API 委托 client 三函数", () => {
		expect(workspaceManagerSource).toMatch(/workspaceId:\s*\{ type: Number/);
		expect(workspaceManagerSource).toContain("baize-enter-workspace");
		expect(workspaceManagerSource).toMatch(/@click=\$\{\(\) => this\.enter\(workspace\.id\)\}/);
		expect(workspaceManagerSource).toMatch(/stopPropagation/);
		expect(workspaceManagerSource).toMatch(/createWorkspace|deleteWorkspace|listWorkspaces/);
	});
});

// ---------------------------------------------------------------------------
// 票 05:shell 首屏与选中态
// ---------------------------------------------------------------------------

describe("resolveStoredWorkspace — 已存键解析规则(决议 09)", () => {
	const workspaces = [
		{ id: 3, name: "North", repoPath: "/north", createdAt: "t", requirementCount: 0, assetCount: 0 },
		{ id: 5, name: "South", repoPath: "/south", createdAt: "t", requirementCount: 0, assetCount: 0 },
	];

	it("合法键值在列表内 → 直达,不清键", () => {
		expect(resolveStoredWorkspace("3", workspaces)).toEqual({ workspaceId: 3, clearKey: false });
		expect(resolveStoredWorkspace("5", workspaces)).toEqual({ workspaceId: 5, clearKey: false });
	});

	it("无键 → 管理页,不清键", () => {
		expect(resolveStoredWorkspace(null, workspaces)).toEqual({ workspaceId: null, clearKey: false });
	});

	it("键值已失效(工作区被级联删除)→ 管理页并清键", () => {
		expect(resolveStoredWorkspace("9", workspaces)).toEqual({ workspaceId: null, clearKey: true });
	});

	it("非整数值(脏数据)→ 管理页并清键", () => {
		expect(resolveStoredWorkspace("abc", workspaces)).toEqual({ workspaceId: null, clearKey: true });
		expect(resolveStoredWorkspace("0", workspaces)).toEqual({ workspaceId: null, clearKey: true });
		expect(resolveStoredWorkspace("-1", workspaces)).toEqual({ workspaceId: null, clearKey: true });
	});

	it("列表不可用(网络失败)→ 管理页但不销毁已存选择", () => {
		expect(resolveStoredWorkspace("3", null)).toEqual({ workspaceId: null, clearKey: false });
	});
});

describe("baize-shell — 首屏与选中态安全约定(票 05)", () => {
	it("挂载 baize-workspace-manager 并消费其进入/删除事件", () => {
		expect(shellSource).toContain('import "./baize-workspace-manager.js"');
		expect(shellSource).toContain("baize-enter-workspace");
		expect(shellSource).toContain("baize-workspace-deleted");
	});

	it("使用 @lit-labs/router 路由管理页与需求列表", () => {
		expect(shellSource).toMatch(/Router\(this, \[/);
		expect(shellSource).toContain("/manage");
		expect(shellSource).toContain("/workflow/:id");
	});

	it("只用 localStorage[\"baize.workspaceId\"] 键,写/清时机齐", () => {
		expect(shellSource).toContain('localStorage.getItem("baize.workspaceId")');
		expect(shellSource).toContain('localStorage.setItem("baize.workspaceId"');
		expect(shellSource).toContain('localStorage.removeItem("baize.workspaceId")');
	});

	it("不再持有静态 workspace-id / workspaceId 属性声明", () => {
		expect(shellSource).not.toMatch(/workspace-id: \{ type: Number/);
		expect(shellSource).not.toMatch(/workspaceId: \{ type: Number/);
	});

	it("绝无 window.confirm", () => {
		expect(shellSource).not.toMatch(/window\.confirm/);
	});

	it("index.html 不再硬编码 workspace-id,仍挂载 baize-shell", () => {
		expect(indexSource).toContain("<baize-shell>");
		expect(indexSource).not.toMatch(/workspace-id\s*=/);
	});
});

describe("baize-shell — VS Code 五层组件注册(#78/#79/#80)", () => {
	it("注册并挂载四层新组件", () => {
		expect(shellSource).toContain("baize-activity-bar");
		expect(shellSource).toContain("baize-side-bar");
		expect(shellSource).toContain("baize-status-bar");
		expect(shellSource).toContain("baize-panel");
	});
	it("不含已删除的旧布局 class/token", () => {
		expect(shellSource).not.toMatch(/workbench-frame/);
		expect(shellSource).not.toMatch(/workbench-rail/);
		expect(shellSource).not.toMatch(/content-max/);
	});
	it("index.html 不含已删除 token", () => {
		expect(indexSource).not.toMatch(/content-max/);
		expect(indexSource).not.toMatch(/workbench-rail-width/);
		expect(indexSource).toContain("activity-bar-w");
		expect(indexSource).toContain("data-theme");
	});
});

describe("baize-workflow — 子组件提取(#81/#82/#83)", () => {
	it("导入并挂载七个子组件", () => {
		expect(workflowComponentSource).toContain("baize-workflow-hero");
		expect(workflowComponentSource).toContain("baize-tab-bar");
		expect(workflowComponentSource).toContain("baize-gate-queue");
		expect(workflowComponentSource).toContain("baize-approval-review");
		expect(workflowComponentSource).toContain("baize-tasks-tab");
		expect(workflowComponentSource).toContain("baize-artifacts-tab");
		expect(workflowComponentSource).toContain("baize-governance-tab");
	});
	it("不再含重复的需求列表/登录逻辑", () => {
		expect(workflowComponentSource).not.toMatch(/loadRequirements/);
		expect(workflowComponentSource).not.toMatch(/handleCreateRequirement/);
		expect(workflowComponentSource).not.toMatch(/handleLogin/);
		expect(workflowComponentSource).not.toMatch(/loginToken/);
		expect(workflowComponentSource).not.toMatch(/loginError/);
	});
});
describe("workspace asset surface", () => {
	it("renders workspace asset information after entering a workspace", () => {
		expect(shellSource).toMatch(/baize-asset-library/);
		expect(assetLibrarySource).toMatch(/listAssets/);
	});
});
