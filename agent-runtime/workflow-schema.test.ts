import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkflowContracts } from "./workflow/contracts/loader.ts";
import { compileWorkflowSchema } from "./workflow/contracts/schema.ts";

const validPlan = {
	schemaVersion: "plan-proposal/v1",
	base: {
		workflowId: 42,
		workflowVersion: 7,
		basePlanRevisionId: null,
		planningContextDigest: `sha256:${"a".repeat(64)}`,
	},
	objective: "Analyze the Requirement",
	tasks: [
		{
			key: "analyze-core",
			kind: "analyze",
			role: "analysis-analyst",
			objective: "Derive the impact profile",
			dependsOn: [],
			inputs: [],
			expectedArtifactEffects: [
				{ kind: "analysis", operation: "create_or_revise" },
			],
			completionPolicyRef: "analyst-task/v1",
			maxAttempts: 2,
		},
	],
	rationale: "A single analysis task is sufficient for this proposal.",
};

const sourceRefs = [{ type: "requirement_revision", revisionId: 1 }];
const stringList = ["value"];
const validArtifacts = [
	{
		artifactKind: "requirement",
		schemaVersion: "artifact/requirement/v1",
		summary: "Requirement summary",
		sourceRefs: [{ type: "human_directive", directiveId: 1 }],
		title: "Points expiry",
		description: "Design controlled points expiry and compensation.",
	},
	{
		artifactKind: "analysis",
		schemaVersion: "artifact/analysis/v1",
		summary: "Analysis summary",
		sourceRefs,
		goals: stringList,
		nonGoals: [],
		constraints: stringList,
		acceptanceCriteria: stringList,
		impactProfile: Object.fromEntries(
			["process", "actors", "behavior", "architecture", "data", "api"].map((key) => [
				key,
				{ status: "no", rationale: `${key} is unchanged` },
			]),
		),
		openQuestions: [],
	},
	{
		artifactKind: "scenario",
		schemaVersion: "artifact/scenario/v1",
		summary: "Scenario summary",
		sourceRefs,
		domains: [{ nodeId: "d1", title: "Domain", scenarios: [{ nodeId: "s1", title: "Scenario", variants: [{ nodeId: "v1", title: "Expiry", actors: stringList, preconditions: [], trigger: "Date reached", mainFlow: stringList, alternateFlows: [], expectedOutcome: "Expired" }] }] }],
	},
	{
		artifactKind: "usecase",
		schemaVersion: "artifact/usecase/v1",
		summary: "Use-case summary",
		sourceRefs,
		useCases: [{ id: "U1", actor: "Member", goal: "Understand expiry", preconditions: [], mainFlow: stringList, alternativeFlows: [], postconditions: stringList }],
	},
	{
		artifactKind: "function",
		schemaVersion: "artifact/function/v1",
		summary: "Function summary",
		sourceRefs,
		domains: [{ nodeId: "d1", title: "Domain", items: [{ nodeId: "i1", title: "Item", points: [{ nodeId: "p1", name: "Expire points", responsibility: "Expire eligible balances", inputs: stringList, outputs: stringList, businessRules: stringList, acceptanceCriteria: stringList }] }] }],
	},
	{
		artifactKind: "design",
		schemaVersion: "artifact/design/v1",
		summary: "Design summary",
		sourceRefs,
		changeUnits: [{ id: "C1", area: "Ledger", change: "Add expiry", rationale: "Policy", sourceRefs }],
		alternatives: stringList,
		failureHandling: stringList,
		testStrategy: stringList,
		implementationOrder: stringList,
		rolloutStrategy: "Atomic rollout",
		rollbackStrategy: "Restore snapshot",
	},
	{
		artifactKind: "architecture",
		schemaVersion: "artifact/architecture/v1",
		summary: "Architecture summary",
		sourceRefs,
		components: [{ componentId: "ledger", name: "Ledger", responsibility: "Track balances" }],
		relationships: [{ relationshipId: "r1", fromComponentId: "ledger", toComponentId: "expirer", interaction: "calls" }],
		constraints: stringList,
		nonFunctionalRequirements: stringList,
	},
	{
		artifactKind: "data",
		schemaVersion: "artifact/data/v1",
		summary: "Data summary",
		sourceRefs,
		entities: [{ entityId: "e1", name: "Balance", fields: [{ fieldId: "f1", name: "amount", type: "integer" }] }],
		relations: [{ fromEntityId: "e1", fromFieldIds: ["f1"], toEntityId: "e2", cardinality: "one-to-many" }],
	},
	{
		artifactKind: "api",
		schemaVersion: "artifact/api/v1",
		summary: "API summary",
		sourceRefs,
		openapi: "3.1.0",
		info: { title: "Points API", version: "1" },
		paths: { "/expire": { summary: "Expire points", post: { summary: "Expire", responses: { "200": { description: "OK" } } } } },
	},
];

test("compiles and executes the versioned PlanProposal JSON Schema", async () => {
	const contracts = await loadWorkflowContracts();
	const validate = compileWorkflowSchema(contracts, "plan-proposal/v1");

	assert.equal(validate.check(validPlan), true);
	for (const invalid of [
		{ ...validPlan, unexpected: true },
		{ ...validPlan, tasks: [] },
		{ ...validPlan, tasks: [{ ...validPlan.tasks[0], role: "critic" }] },
		{ ...validPlan, tasks: [{ ...validPlan.tasks[0], maxAttempts: 4 }] },
	]) {
		assert.equal(validate.check(invalid), false);
		assert.ok(validate.errors(invalid).length > 0);
	}
});

test("compiles every closed Artifact content branch with positive and negative cases", async () => {
	const contracts = await loadWorkflowContracts();
	const validate = compileWorkflowSchema(contracts, "artifact-content/v1");

	for (const artifact of validArtifacts) {
		assert.equal(validate.check(artifact), true, `${artifact.artifactKind} must be valid`);
		assert.equal(
			validate.check({ ...artifact, arbitraryProse: "not governed" }),
			false,
			`${artifact.artifactKind} must reject extra fields`,
		);
		assert.equal(
			validate.check({ ...artifact, summary: 42 }),
			false,
			`${artifact.artifactKind} must reject wrong types`,
		);
	}
});
