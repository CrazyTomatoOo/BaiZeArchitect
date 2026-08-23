import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkflowContracts } from "./workflow/contracts/loader.js";
import { compileWorkflowSchema, type WorkflowSchemaValidator } from "./workflow/contracts/schema.js";
import { validatePlanProposal, type PlanValidationContext, type PlanRuleViolation } from "./workflow/plan-validator.js";
import type { PlanProposal, TaskProposal } from "./workflow/plan-types.js";

const CONTEXT: PlanValidationContext = {
	workflowId: 1,
	workflowVersion: 1,
	planningContextDigest: "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
	basePlanRevisionId: null,
};

function validProposal(): PlanProposal {
	return {
		schemaVersion: "plan-proposal/v1",
		base: {
			workflowId: 1,
			workflowVersion: 1,
			basePlanRevisionId: null,
			planningContextDigest: CONTEXT.planningContextDigest,
		},
		objective: "Plan the initial analysis and design",
		tasks: [
			{
				key: "analyze-req",
				kind: "analyze",
				role: "analysis-analyst",
				objective: "Analyze the requirement",
				dependsOn: [],
				inputs: [],
				expectedArtifactEffects: [{ kind: "analysis", operation: "create_or_revise" }],
				completionPolicyRef: "analysis/v1",
				maxAttempts: 3,
			},
			{
				key: "design-sol",
				kind: "design",
				role: "design-architect",
				objective: "Design the solution",
				dependsOn: ["analyze-req"],
				inputs: [
					{
						type: "task_output",
						taskKey: "analyze-req",
						artifactKind: "analysis",
						purpose: "Analysis as design input",
					},
				],
				expectedArtifactEffects: [{ kind: "design", operation: "create_or_revise" }],
				completionPolicyRef: "design/v1",
				maxAttempts: 3,
			},
		],
		rationale: "Standard analysis-then-design flow",
	};
}

let validator: WorkflowSchemaValidator;

test.before(async () => {
	const contracts = await loadWorkflowContracts();
	validator = compileWorkflowSchema(contracts, "plan-proposal/v1");
});

function expectValid(proposal: PlanProposal): void {
	const result = validatePlanProposal(proposal, CONTEXT, validator);
	assert.equal(result.valid, true, `expected valid but got: ${JSON.stringify(result.ruleViolations)}`);
}

function expectViolation(proposal: unknown, rule: string): void {
	const result = validatePlanProposal(proposal, CONTEXT, validator);
	assert.equal(result.valid, false);
	assert.ok(
		result.ruleViolations.some((v: PlanRuleViolation) => v.rule === rule),
		`expected rule ${rule}; got: ${JSON.stringify(result.ruleViolations)}`,
	);
}

test("valid proposal passes all rules", () => {
	expectValid(validProposal());
});

test("schema validation rejects missing required field", () => {
	const proposal = validProposal();
	delete (proposal as unknown as Record<string, unknown>).rationale;
	expectViolation(proposal, "schema");
});

test("base workflowId mismatch is rejected", () => {
	const proposal = validProposal();
	proposal.base.workflowId = 999;
	expectViolation(proposal, "base_workflow_mismatch");
});

test("base workflowVersion mismatch is rejected", () => {
	const proposal = validProposal();
	proposal.base.workflowVersion = 0;
	expectViolation(proposal, "base_workflow_mismatch");
});

test("base planning context digest mismatch is rejected", () => {
	const proposal = validProposal();
	proposal.base.planningContextDigest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
	expectViolation(proposal, "base_planning_context_mismatch");
});

test("duplicate task keys are rejected", () => {
	const proposal = validProposal();
	proposal.tasks[1].key = "analyze-req";
	expectViolation(proposal, "task_key_uniqueness");
});

test("non-existent dependency is rejected", () => {
	const proposal = validProposal();
	proposal.tasks[1].dependsOn = ["nonexistent-task"];
	expectViolation(proposal, "dependency_not_found");
});

test("cyclic dependency is rejected", () => {
	const proposal = validProposal();
	proposal.tasks[0].dependsOn = ["design-sol"];
	expectViolation(proposal, "dag_cycle");
});

test("depth exceeding 6 is rejected", () => {
	const proposal = validProposal();
	const tasks: TaskProposal[] = [];
	for (let i = 0; i < 7; i += 1) {
		tasks.push({
			key: `task-${i}`,
			kind: "analyze",
			role: "analysis-analyst",
			objective: `Step ${i}`,
			dependsOn: i === 0 ? [] : [`task-${i - 1}`],
			inputs: [],
			expectedArtifactEffects:
				i === 0 ? [{ kind: "analysis", operation: "create_or_revise" }] : [],
			completionPolicyRef: "analysis/v1",
			maxAttempts: 3,
		});
	}
	proposal.tasks = tasks;
	expectViolation(proposal, "max_depth_exceeded");
});

test("write ownership violation is rejected", () => {
	const proposal = validProposal();
	// Analyst task claims to write architecture (owned by architect)
	proposal.tasks[0].expectedArtifactEffects = [
		{ kind: "architecture", operation: "create_or_revise" },
	];
	expectViolation(proposal, "write_ownership");
});

test("duplicate writer per artifact kind is rejected", () => {
	const proposal = validProposal();
	// Both tasks claim to write analysis
	proposal.tasks[1].expectedArtifactEffects = [
		{ kind: "analysis", operation: "create_or_revise" },
	];
	expectViolation(proposal, "write_set_conflict");
});

test("task output input referencing non-ancestor is rejected", () => {
	const proposal = validProposal();
	// design-sol references analyze-req output but we remove the dependency
	proposal.tasks[1].dependsOn = [];
	expectViolation(proposal, "input_ancestry");
});

test("plan with no unsatisfied work is rejected", () => {
	const proposal = validProposal();
	// Remove all expectedArtifactEffects — no task creates anything
	proposal.tasks[0].expectedArtifactEffects = [];
	proposal.tasks[1].expectedArtifactEffects = [];
	expectViolation(proposal, "no_unsatisfied_work");
});

test("task kind plan is rejected (no recursive planning)", () => {
	const proposal = validProposal() as unknown as Record<string, unknown>;
	const tasks = [...(proposal.tasks as unknown[])] as Record<string, unknown>[];
	tasks[0] = { ...tasks[0], kind: "plan", role: "orchestrator" };
	proposal.tasks = tasks;
	expectViolation(proposal, "schema");
});

test("completion policy with invalid pattern is rejected", () => {
	const proposal = validProposal();
	proposal.tasks[0].completionPolicyRef = "invalid-policy";
	expectViolation(proposal, "schema");
});

test("maxAttempts out of range is rejected", () => {
	const proposal = validProposal();
	proposal.tasks[0].maxAttempts = 5;
	expectViolation(proposal, "schema");
});

test("more than 12 tasks is rejected", () => {
	const proposal = validProposal();
	const tasks: TaskProposal[] = [];
	for (let i = 0; i < 13; i += 1) {
		tasks.push({
			key: `t${i}`,
			kind: "analyze",
			role: "analysis-analyst",
			objective: `Task ${i}`,
			dependsOn: [],
			inputs: [],
			expectedArtifactEffects:
				i === 0 ? [{ kind: "analysis", operation: "create_or_revise" }] : [],
			completionPolicyRef: "analysis/v1",
			maxAttempts: 1,
		});
	}
	proposal.tasks = tasks;
	expectViolation(proposal, "schema");
});

test("forbidden additional property is rejected", () => {
	const proposal = validProposal() as unknown as Record<string, unknown>;
	proposal.tasks = (proposal.tasks as unknown[]).map((t) => ({
		...(t as Record<string, unknown>),
		executableDSL: "do bad things",
	}));
	expectViolation(proposal, "schema");
});

test("base plan revision mismatch is rejected", () => {
	const proposal = validProposal();
	proposal.base.basePlanRevisionId = 999;
	expectViolation(proposal, "base_plan_revision_mismatch");
});

// #25 负向扫描：旧角色 analyst/architect 已从 TaskRole/契约角色闭集移除，任何引用必须校验失败。
test("legacy role analyst is rejected by plan validation (negative scan)", () => {
	const proposal = validProposal();
	proposal.tasks[0]!.role = "analyst" as TaskRole;
	expectViolation(proposal, "schema");
});

test("legacy role architect is rejected by plan validation (negative scan)", () => {
	const proposal = validProposal();
	proposal.tasks[0]!.role = "architect" as TaskRole;
	expectViolation(proposal, "schema");
});

test("contract role enums no longer contain legacy analyst/architect roles", () => {
	// 直接读契约文件做负向扫描：独立 "analyst"/"architect" 键/枚举值已不允许出现
	// （生产角色如 "analysis-analyst"/"design-architect" 含子串但非独立键，正则不受影响）。
	const contractFiles = [
		"plan-proposal-v1.schema.json",
		"model-config-v1.schema.json",
		"concurrency-policy-v1.json",
		"readiness-policy-v1.json",
	] as const;
	for (const file of contractFiles) {
		const raw = readFileSync(join(import.meta.dirname, "contracts", file), "utf8");
		assert.doesNotMatch(raw, /"analyst"\s*[,}]/, `${file} must not reference bare "analyst"`);
		assert.doesNotMatch(raw, /"architect"\s*[,}]/, `${file} must not reference bare "architect"`);
	}
});

