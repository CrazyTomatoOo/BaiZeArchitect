import { ARTIFACT_OWNERSHIP, PLAN_TASK_LIMITS, type PlanProposal, type TaskProposal, type WritableArtifactKind } from "./plan-types.js";
import type { WorkflowSchemaValidator } from "./contracts/schema.js";

export interface PlanValidationContext {
	workflowId: number;
	workflowVersion: number;
	planningContextDigest: string;
	basePlanRevisionId: number | null;
}

export interface PlanRuleViolation {
	rule: string;
	detail: string;
}

export interface PlanValidationResult {
	valid: boolean;
	ruleViolations: PlanRuleViolation[];
}

function computeAncestors(
	tasks: readonly TaskProposal[],
	taskKey: string,
): Set<string> {
	const byKey = new Map(tasks.map((t) => [t.key, t]));
	const ancestors = new Set<string>();
	const stack = [...(byKey.get(taskKey)?.dependsOn ?? [])];
	while (stack.length > 0) {
		const key = stack.pop()!;
		if (ancestors.has(key)) continue;
		ancestors.add(key);
		const task = byKey.get(key);
		if (task) stack.push(...task.dependsOn);
	}
	return ancestors;
}

function hasCycle(tasks: readonly TaskProposal[]): boolean {
	const byKey = new Map(tasks.map((t) => [t.key, t]));
	const WHITE = 0;
	const GRAY = 1;
	const BLACK = 2;
	const color = new Map<string, number>(tasks.map((t) => [t.key, WHITE]));
	const visit = (key: string): boolean => {
		const c = color.get(key);
		if (c === GRAY) return true;
		if (c === BLACK) return false;
		color.set(key, GRAY);
		const task = byKey.get(key);
		if (task) {
			for (const dep of task.dependsOn) {
				if (visit(dep)) return true;
			}
		}
		color.set(key, BLACK);
		return false;
	};
	for (const task of tasks) {
		if (visit(task.key)) return true;
	}
	return false;
}

function maxDepth(tasks: readonly TaskProposal[]): number {
	const byKey = new Map(tasks.map((t) => [t.key, t]));
	const memo = new Map<string, number>();
	const inProgress = new Set<string>();
	const depthOf = (key: string): number => {
		const cached = memo.get(key);
		if (cached !== undefined) return cached;
		if (inProgress.has(key)) return Infinity;
		inProgress.add(key);
		const task = byKey.get(key);
		if (!task || task.dependsOn.length === 0) {
			memo.set(key, 1);
			inProgress.delete(key);
			return 1;
		}
		const max = Math.max(...task.dependsOn.map(depthOf)) + 1;
		memo.set(key, max);
		inProgress.delete(key);
		return max;
	};
	return Math.max(...tasks.map((t) => depthOf(t.key)), 0);
}

export function validatePlanProposal(
	proposal: unknown,
	context: PlanValidationContext,
	schemaValidator: WorkflowSchemaValidator,
): PlanValidationResult {
	const violations: PlanRuleViolation[] = [];

	if (!schemaValidator.check(proposal)) {
		violations.push({ rule: "schema", detail: "PlanProposal does not match plan-proposal/v1 schema" });
		return { valid: false, ruleViolations: violations };
	}

	const plan = proposal as PlanProposal;

	if (
		plan.base.workflowId !== context.workflowId ||
		plan.base.workflowVersion !== context.workflowVersion
	) {
		violations.push({
			rule: "base_workflow_mismatch",
			detail: `base workflowId/version does not match context (${context.workflowId}/${context.workflowVersion})`,
		});
	}

	if (plan.base.planningContextDigest !== context.planningContextDigest) {
		violations.push({
			rule: "base_planning_context_mismatch",
			detail: "base planningContextDigest does not match context",
		});
	}

	if (plan.base.basePlanRevisionId !== context.basePlanRevisionId) {
		violations.push({
			rule: "base_plan_revision_mismatch",
			detail: `base basePlanRevisionId does not match context (${context.basePlanRevisionId})`,
		});
	}

	const tasks = plan.tasks;

	const keySet = new Set<string>();
	for (const task of tasks) {
		if (keySet.has(task.key)) {
			violations.push({
				rule: "task_key_uniqueness",
				detail: `duplicate task key: ${task.key}`,
			});
		}
		keySet.add(task.key);
	}

	for (const task of tasks) {
		for (const dep of task.dependsOn) {
			if (!keySet.has(dep)) {
				violations.push({
					rule: "dependency_not_found",
					detail: `task ${task.key} depends on non-existent key ${dep}`,
				});
			}
		}
	}

	if (hasCycle(tasks)) {
		violations.push({ rule: "dag_cycle", detail: "task dependency graph has a cycle" });
	}

	const depth = maxDepth(tasks);
	if (depth > PLAN_TASK_LIMITS.maxDepth) {
		violations.push({
			rule: "max_depth_exceeded",
			detail: `DAG depth ${depth} exceeds maximum ${PLAN_TASK_LIMITS.maxDepth}`,
		});
	}

	for (const task of tasks) {
		const ownedKinds = ARTIFACT_OWNERSHIP[task.role];
		for (const effect of task.expectedArtifactEffects) {
			if (!ownedKinds.includes(effect.kind as WritableArtifactKind)) {
				violations.push({
					rule: "write_ownership",
					detail: `task ${task.key} (role ${task.role}) cannot write ${effect.kind}`,
				});
			}
		}
	}

	const writerMap = new Map<string, string>();
	for (const task of tasks) {
		for (const effect of task.expectedArtifactEffects) {
			const writeKey = effect.kind;
			const existing = writerMap.get(writeKey);
			if (existing !== undefined && existing !== task.key) {
				violations.push({
					rule: "write_set_conflict",
					detail: `artifact kind ${effect.kind} has multiple writers: ${existing} and ${task.key}`,
				});
			}
			writerMap.set(writeKey, task.key);
		}
	}

	for (const task of tasks) {
		const ancestors = computeAncestors(tasks, task.key);
		for (const input of task.inputs) {
			if (input.type === "task_output") {
				if (!ancestors.has(input.taskKey)) {
					violations.push({
						rule: "input_ancestry",
						detail: `task ${task.key} references task_output ${input.taskKey} which is not an ancestor`,
					});
				}
			}
		}
	}

	const hasUnsatisfiedWork = tasks.some((t) => t.expectedArtifactEffects.length > 0);
	if (!hasUnsatisfiedWork) {
		violations.push({
			rule: "no_unsatisfied_work",
			detail: "plan has no task with expectedArtifactEffects (no unsatisfied work)",
		});
	}

	return { valid: violations.length === 0, ruleViolations: violations };
}
