import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONTRACT_FILE_IDENTITIES = {
	"artifact-content-v1.schema.json": "artifact-content/v1",
	"concurrency-policy-v1.json": "concurrency-policy/v1",
	"cutover-policy-v1.json": "cutover-policy/v1",
	"implementation-plan-v1.json": "implementation-plan/v1",
	"model-config-v1.schema.json": "model-config/v1",
	"operator-experience-v1.json": "operator-experience/v1",
	"persistence-model-v1.json": "persistence-model/v1",
	"plan-proposal-v1.schema.json": "plan-proposal/v1",
	"plan-template-v1.json": "plan-template/v1",
	"readiness-policy-v1.json": "readiness-policy/v1",
	"recovery-policy-v1.json": "recovery-policy/v1",
	"workflow-api-v1.json": "workflow-api/v1",
	"workflow-event-catalog-v1.json": "workflow-event-catalog/v1",
} as const;

export type WorkflowContractIdentity =
	(typeof CONTRACT_FILE_IDENTITIES)[keyof typeof CONTRACT_FILE_IDENTITIES];

export interface WorkflowContractAsset {
	fileName: string;
	identity: WorkflowContractIdentity;
	content: Readonly<Record<string, unknown>>;
}

export type ContractValidationErrorCode =
	| "contract_asset_set_mismatch"
	| "contract_json_invalid"
	| "unknown_contract_version"
	| "contract_structure_invalid"
	| "contract_reference_mismatch";

export class ContractValidationError extends Error {
	constructor(
		public readonly code: ContractValidationErrorCode,
		public readonly fileName: string,
		message: string,
	) {
		super(message);
		this.name = "ContractValidationError";
	}
}

export interface WorkflowContractCatalog {
	assets: readonly WorkflowContractAsset[];
	get(identity: WorkflowContractIdentity): WorkflowContractAsset;
}


type ContractValueKind = "array" | "boolean" | "number" | "object" | "string";

const REQUIRED_TOP_LEVEL_SHAPES: Readonly<
	Record<WorkflowContractIdentity, Readonly<Record<string, ContractValueKind>>>
> = {
	"artifact-content/v1": {
		$schema: "string",
		$id: "string",
		oneOf: "array",
		$defs: "object",
	},
	"concurrency-policy/v1": {
		scope: "object",
		governanceExecution: "object",
		claims: "object",
		publication: "object",
		recovery: "object",
	},
	"cutover-policy/v1": {
		strategy: "object",
		commands: "object",
		preflight: "object",
		migration: "object",
		rollback: "object",
	},
	"implementation-plan/v1": {
		integrationStrategy: "object",
		nonNegotiableContracts: "array",
		slices: "array",
		ci: "object",
		release: "object",
	},
	"model-config/v1": {
		$schema: "string",
		$id: "string",
		type: "string",
		required: "array",
		properties: "object",
		$defs: "object",
	},
	"operator-experience/v1": {
		prototype: "object",
		informationArchitecture: "object",
		statePrimaryActions: "object",
		liveUpdates: "object",
	},
	"plan-template/v1": {
		schemaVersion: "string",
		objective: "string",
		tasks: "array",
	},
	"persistence-model/v1": {
		database: "object",
		migration: "object",
		snapshotDocuments: "object",
		tables: "object",
		transactionBundles: "object",
	},
	"plan-proposal/v1": {
		$schema: "string",
		$id: "string",
		type: "string",
		required: "array",
		properties: "object",
		$defs: "object",
	},
	"readiness-policy/v1": {
		artifactContentSchemaRef: "string",
		artifactRequirementPolicy: "object",
		readinessChecks: "array",
		approvalPacket: "object",
	},
	"recovery-policy/v1": {
		startupGate: "object",
		runRecovery: "object",
		claimRecovery: "object",
		outbox: "object",
		reconciliationInvariants: "array",
	},
	"workflow-api/v1": {
		identity: "object",
		creation: "object",
		commandResource: "object",
		commands: "object",
		sse: "object",
	},
	"workflow-event-catalog/v1": {
		workflowEnvelope: "object",
		runEnvelope: "object",
		workflowEventTypes: "object",
		runEventTypes: "array",
	},
};

function valueKind(value: unknown): ContractValueKind | "invalid" {
	if (Array.isArray(value)) return "array";
	if (value !== null && typeof value === "object") return "object";
	if (["boolean", "number", "string"].includes(typeof value)) {
		return typeof value as ContractValueKind;
	}
	return "invalid";
}

function assertContractStructure(asset: WorkflowContractAsset): void {
	const invalid = Object.entries(REQUIRED_TOP_LEVEL_SHAPES[asset.identity]).filter(
		([key, expected]) => valueKind(asset.content[key]) !== expected,
	);
	if (invalid.length > 0) {
		throw new ContractValidationError(
			"contract_structure_invalid",
			asset.fileName,
			`${asset.fileName} has invalid required fields: ${invalid
				.map(([key, expected]) => `${key} (${expected})`)
				.join(", ")}`,
		);
	}
}

function contractIdentity(fileName: string, content: Record<string, unknown>): string | undefined {
	if (fileName === "plan-proposal-v1.schema.json") {
		return content.$id === "baize://schemas/plan-proposal/v1"
			? "plan-proposal/v1"
			: undefined;
	}
	if (fileName === "model-config-v1.schema.json") {
		return content.$id === "baize://schemas/model-config/v1"
			? "model-config/v1"
			: undefined;
	}
	if (fileName === "artifact-content-v1.schema.json") {
		return content.$id ===
			"https://baize.local/schemas/artifact-content-v1.schema.json"
			? "artifact-content/v1"
			: undefined;
	}
	if (fileName === "readiness-policy-v1.json") {
		return typeof content.policyVersion === "string"
			? content.policyVersion
			: undefined;
	}
	return typeof content.schemaVersion === "string"
		? content.schemaVersion
		: undefined;
}

function assertReference(
	asset: WorkflowContractAsset,
	actual: unknown,
	expected: string,
	field: string,
): void {
	if (actual !== expected) {
		throw new ContractValidationError(
			"contract_reference_mismatch",
			asset.fileName,
			`${asset.fileName} ${field} must reference ${expected}`,
		);
	}
}

function recordAt(
	asset: WorkflowContractAsset,
	...keys: string[]
): Record<string, unknown> {
	let current: unknown = asset.content;
	for (const key of keys) {
		if (!current || typeof current !== "object" || Array.isArray(current)) {
			throw new ContractValidationError(
				"contract_reference_mismatch",
				asset.fileName,
				`${asset.fileName} is missing ${keys.join(".")}`,
			);
		}
		current = (current as Record<string, unknown>)[key];
	}
	if (!current || typeof current !== "object" || Array.isArray(current)) {
		throw new ContractValidationError(
			"contract_reference_mismatch",
			asset.fileName,
			`${asset.fileName} is missing ${keys.join(".")}`,
		);
	}
	return current as Record<string, unknown>;
}

function stringArrayAt(
	asset: WorkflowContractAsset,
	...keys: string[]
): readonly string[] {
	let current: unknown = asset.content;
	for (const key of keys) {
		if (!current || typeof current !== "object" || Array.isArray(current)) {
			current = undefined;
			break;
		}
		current = (current as Record<string, unknown>)[key];
	}
	if (!Array.isArray(current) || current.some((item) => typeof item !== "string")) {
		throw new ContractValidationError(
			"contract_reference_mismatch",
			asset.fileName,
			`${asset.fileName} ${keys.join(".")} must be a string array`,
		);
	}
	return current as string[];
}

function assertStringSet(
	asset: WorkflowContractAsset,
	actual: readonly string[],
	expected: readonly string[],
	field: string,
): void {
	const sortedActual = [...actual].sort((left, right) => left.localeCompare(right));
	const sortedExpected = [...expected].sort((left, right) => left.localeCompare(right));
	if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
		throw new ContractValidationError(
			"contract_reference_mismatch",
			asset.fileName,
			`${asset.fileName} ${field} must match ${sortedExpected.join(", ")}`,
		);
	}
}

const TEMPLATE_ROLES: Readonly<Record<string, true>> = {
	"analysis-analyst": true,
	"scenario-analyst": true,
	"usecase-analyst": true,
	"function-analyst": true,
	"design-architect": true,
	"architecture-architect": true,
	"data-architect": true,
	"api-architect": true,
	critic: true,
};

/** plan-template/v1 深度校验（#19 验收：boot 加载校验）。模板 = 13 Task 固定链，design 拆为 design→architecture→data→api 各一 Task。 */
function assertPlanTemplateStructure(asset: WorkflowContractAsset): void {
	const content = asset.content as { tasks?: unknown };
	const rawTasks = content.tasks;
	if (!Array.isArray(rawTasks) || rawTasks.length !== 13) {
		throw new ContractValidationError(
			"contract_structure_invalid",
			asset.fileName,
			`${asset.fileName} must declare exactly 13 template tasks`,
		);
	}
	const keys = new Set<string>();
	let criticCount = 0;
	for (const raw of rawTasks) {
		if (typeof raw !== "object" || raw === null) {
			throw new ContractValidationError("contract_structure_invalid", asset.fileName, `${asset.fileName} task entries must be objects`);
		}
		const task = raw as Record<string, unknown>;
		if (typeof task.key !== "string" || keys.has(task.key)) {
			throw new ContractValidationError("contract_structure_invalid", asset.fileName, `${asset.fileName} tasks must have unique string keys`);
		}
		keys.add(task.key);
		if (typeof task.role !== "string" || !(TEMPLATE_ROLES as Record<string, boolean>)[task.role]) {
			throw new ContractValidationError("contract_structure_invalid", asset.fileName, `${asset.fileName} task ${String(task.key)} has illegal role ${String(task.role)}`);
		}
		if (task.dependsOn !== undefined && (!Array.isArray(task.dependsOn) || task.dependsOn.some((dep) => typeof dep !== "string" || !keys.has(dep)))) {
			throw new ContractValidationError("contract_structure_invalid", asset.fileName, `${asset.fileName} task ${String(task.key)} dependsOn references must resolve inside the template`);
		}
		if (task.role === "critic") criticCount += 1;
	}
	if (criticCount !== 5) {
		throw new ContractValidationError("contract_structure_invalid", asset.fileName, `${asset.fileName} must declare exactly 5 critic review tasks`);
	}
}
function validateCrossReferences(byIdentity: ReadonlyMap<string, WorkflowContractAsset>): void {
	const readiness = byIdentity.get("readiness-policy/v1");
	const persistence = byIdentity.get("persistence-model/v1");
	const api = byIdentity.get("workflow-api/v1");
	const implementation = byIdentity.get("implementation-plan/v1");
	const cutover = byIdentity.get("cutover-policy/v1");
	if (!readiness || !persistence || !api || !implementation || !cutover) {
		throw new ContractValidationError(
			"contract_asset_set_mismatch",
			"assets",
			"required cross-referenced contracts are missing",
		);
	}
	assertReference(
		readiness,
		readiness.content.artifactContentSchemaRef,
		"./artifact-content-v1.schema.json",
		"artifactContentSchemaRef",
	);
	assertReference(
		readiness,
		recordAt(readiness, "artifactRequirementPolicy").source,
		"plan-template/v1",
		"artifactRequirementPolicy.source",
	);
	assertReference(
		persistence,
		recordAt(persistence, "migration").legacyCutoverPolicyRef,
		"cutover-policy/v1",
		"migration.legacyCutoverPolicyRef",
	);
	assertReference(
		api,
		recordAt(api, "commands", "replace-plan").proposalSchema,
		"plan-proposal/v1",
		"commands.replace-plan.proposalSchema",
	);
	assertReference(
		readiness,
		recordAt(readiness, "findingPolicy").globalPlanRevisionBudgetRef,
		"orchestrator-plan-policy/v1#maxConsecutivePlanRevisionsWithoutHuman",
		"findingPolicy.globalPlanRevisionBudgetRef",
	);
	assertReference(
		cutover,
		recordAt(cutover, "legacyRequirementBundle").schemaRef,
		"legacy-requirement-bundle/v1",
		"legacyRequirementBundle.schemaRef",
	);
	assertStringSet(
		implementation,
		stringArrayAt(implementation, "nonNegotiableContracts"),
		[
			"workflow-state-contract/v1",
			"role-contract/v1",
			"plan-proposal/v1",
			"artifact-policy/v1",
			"readiness-policy/v1",
			"concurrency-policy/v1",
			"persistence-model/v1",
			"workflow-api/v1",
			"workflow-event-catalog/v1",
			"recovery-policy/v1",
			"operator-experience/v1",
			"cutover-policy/v1",
			"model-config/v1",
		],
		"nonNegotiableContracts",
	);
	assertStringSet(
		cutover,
		stringArrayAt(cutover, "targetSchemaAdditions", "tables"),
		["legacy_imports", "reusable_assets", "reusable_asset_revisions"],
		"targetSchemaAdditions.tables",
	);
	assertStringSet(
		cutover,
		stringArrayAt(cutover, "removedHttpPaths"),
		stringArrayAt(api, "removedPaths").filter((value) => value.startsWith("GET ") || value.startsWith("POST ")),
		"removedHttpPaths",
	);
}

export function defaultContractAssetDirectory(): string {
	const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
	const candidates = [
		path.resolve(
			moduleDirectory,
			"../../../.wayfinder/2026-08-auto-orchestration/assets",
		),
		path.resolve(moduleDirectory, "../../contracts"),
		path.resolve(process.cwd(), "contracts"),
	];
	const directory = candidates.find((candidate) => existsSync(candidate));
	if (!directory) {
		throw new ContractValidationError(
			"contract_asset_set_mismatch",
			"assets",
			`Workflow contract assets not found in ${candidates.join(" or ")}`,
		);
	}
	return directory;
}

export async function loadWorkflowContracts(
	directory = defaultContractAssetDirectory(),
): Promise<WorkflowContractCatalog> {
	const expectedFiles = Object.keys(CONTRACT_FILE_IDENTITIES).sort((left, right) =>
		left.localeCompare(right),
	);
	const actualFiles = (await readdir(directory))
		.filter((fileName) => fileName.endsWith(".json"))
		.sort((left, right) => left.localeCompare(right));
	if (
		actualFiles.length !== expectedFiles.length ||
		actualFiles.some((fileName, index) => fileName !== expectedFiles[index])
	) {
		throw new ContractValidationError(
			"contract_asset_set_mismatch",
			"assets",
			`expected ${expectedFiles.join(", ")}; found ${actualFiles.join(", ")}`,
		);
	}

	const assets: WorkflowContractAsset[] = [];
	for (const fileName of expectedFiles) {
		let content: Record<string, unknown>;
		try {
			content = JSON.parse(await readFile(path.join(directory, fileName), "utf8")) as Record<
				string,
				unknown
			>;
		} catch (error) {
			throw new ContractValidationError(
				"contract_json_invalid",
				fileName,
				`${fileName} is not valid JSON: ${String((error as Error).message ?? error)}`,
			);
		}
		const expectedIdentity = CONTRACT_FILE_IDENTITIES[
			fileName as keyof typeof CONTRACT_FILE_IDENTITIES
		];
		if (contractIdentity(fileName, content) !== expectedIdentity) {
			throw new ContractValidationError(
				"unknown_contract_version",
				fileName,
				`${fileName} must identify as ${expectedIdentity}`,
			);
		}
		const asset = { fileName, identity: expectedIdentity, content } as WorkflowContractAsset;
		assertContractStructure(asset);
		assets.push(asset);
	}

	const byIdentity = new Map(assets.map((asset) => [asset.identity, asset]));
	validateCrossReferences(byIdentity);
	return {
		assets,
		get(identity) {
			const asset = byIdentity.get(identity);
			if (!asset) {
				throw new ContractValidationError(
					"unknown_contract_version",
					identity,
					`unknown Workflow contract ${identity}`,
				);
			}
			return asset;
		},
	};
}

