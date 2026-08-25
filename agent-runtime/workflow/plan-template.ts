/**
 * plan-template.ts — 预置模板 DAG 实例化（#12 决议：Engine 直生成，无 Orchestrator 模型调用）。
 *
 * 模板 = plan-template/v1 契约（静态 13 Task：analysis→scenario→usecase→function→design→architecture→data→api，
 * 每环节尾 Critic 复审，design 拆为 4 个独立 Task 各产 1 kind）。实例化只填 PlanProposal base（workflowId/version/digest），
 * task 列表深拷贝自契约；最终 PlanProposal 仍走 plan-proposal/v1 校验器与 adoptPlan 路径，
 * 保证与人工 replace-plan 同一验证面。模板计划免 PLAN_TASK_LIMITS（#12 决议）。
 */
import type { PlanProposal, TaskProposal } from "./plan-types.js";
import type { WorkflowContractCatalog } from "./contracts/loader.js";

export interface PlanTemplateContext {
	workflowId: number;
	workflowVersion: number;
	planningContextDigest: string;
	basePlanRevisionId: number | null;
}

function asTaskProposal(value: unknown): TaskProposal {
	const task = value as Record<string, unknown>;
	return {
		key: task.key as string,
		kind: task.kind as TaskProposal["kind"],
		role: task.role as TaskProposal["role"],
		objective: task.objective as string,
		dependsOn: (task.dependsOn as unknown[]).map(String),
		inputs: (task.inputs as unknown[]).map((input) => ({ ...(input as Record<string, unknown>) }) as unknown) as TaskProposal["inputs"],
		expectedArtifactEffects: (task.expectedArtifactEffects as unknown[]).map((effect) => ({ ...(effect as Record<string, unknown>) }) as unknown) as TaskProposal["expectedArtifactEffects"],
		completionPolicyRef: task.completionPolicyRef as string,
		maxAttempts: task.maxAttempts as number,
	};
}

/** 模板契约 → 完整 PlanProposal（确定性：同一契约 + 同一 context 产同一 proposal）。 */
export function instantiatePlanTemplate(
	contracts: WorkflowContractCatalog,
	context: PlanTemplateContext,
): PlanProposal {
	const template = contracts.get("plan-template/v1").content;
	const rawTasks = template.tasks as unknown[];
	const tasks = rawTasks.map(asTaskProposal);
	const seen = new Set<string>();
	for (const task of tasks) {
		if (seen.has(task.key)) {
			throw new Error(`Plan template has duplicate task key ${task.key}`);
		}
		seen.add(task.key);
	}
	return {
		schemaVersion: "plan-proposal/v1",
		base: {
			workflowId: context.workflowId,
			workflowVersion: context.workflowVersion,
			planningContextDigest: context.planningContextDigest,
			basePlanRevisionId: context.basePlanRevisionId,
		},
		objective: template.objective as string,
		tasks,
		rationale: "engine-instantiated plan-template/v1",
	};
}