import type { CrashInjector, FixtureClock, FixtureOperator, FixtureOutboxTransport, HashProvider } from "../testing/deterministic-fixtures.js";
import { WorkflowStore, type CommandReceipt, type ExecuteCommandInput, type WorkflowCommandType, type WorkflowProjection } from "../persistence/workflow-store.js";
import { loadWorkflowContracts } from "./contracts/loader.js";
import { compileWorkflowSchema } from "./contracts/schema.js";
import type { RequirementBaseline } from "./requirement.js";

export type { RequirementBaseline } from "./requirement.js";
export type { CommandReceipt, WorkflowCommandType } from "../persistence/workflow-store.js";

export interface HeadlessWorkflowRuntimeOptions {
	databasePath: string;
	clock: FixtureClock;
	hashProvider: HashProvider;
	crashInjector: CrashInjector;
	outboxTransport: FixtureOutboxTransport;
}

export interface ExecuteCommandRequest {
	workflowId: number;
	commandId: string;
	expectedWorkflowVersion: number;
	type: WorkflowCommandType;
	payload?: Record<string, unknown>;
	reason?: string;
	operator: FixtureOperator;
	schemaVersion?: string;
}

export interface HeadlessWorkflowRuntime {
	createWorkspace(input: { repoPath: string; name: string }): number;
	createRequirement(input: { workspaceId: number; baseline: RequirementBaseline }): {
		requirementId: number;
		workflowId: number;
		workflowState: "pending";
		workflowVersion: 0;
		lastEventSeq: 1;
	};
	listRequirements(workspaceId: number): Array<{ requirementId: number; workflowId: number }>;
	getWorkflowProjection(workflowId: number): WorkflowProjection | undefined;
	executeCommand(input: ExecuteCommandRequest): CommandReceipt;
	getCommandReceipt(workflowId: number, commandId: string): CommandReceipt | undefined;
	close(): void;
}

export async function openHeadlessWorkflowRuntime(
	options: HeadlessWorkflowRuntimeOptions,
): Promise<HeadlessWorkflowRuntime> {
	const contracts = await loadWorkflowContracts();
	const artifactValidator = compileWorkflowSchema(contracts, "artifact-content/v1");
	const policyBundle = {
		schemaVersion: "policy-bundle/v1" as const,
		contracts: contracts.assets
			.map((asset) => ({
				identity: asset.identity,
				digest: options.hashProvider.digest(asset.content),
				content: asset.content,
			}))
			.sort((left, right) => left.identity.localeCompare(right.identity)),
	};
	const store = new WorkflowStore({ ...options, policyBundle });
	return {
		createWorkspace(input) {
			return store.createWorkspace(input);
		},
		createRequirement(input) {
			if (!artifactValidator.check(input.baseline)) {
				throw new Error("Requirement baseline does not match artifact/requirement/v1");
			}
			return store.createRequirement(input);
		},
		listRequirements(workspaceId) {
			return store.listRequirements(workspaceId);
		},
		getWorkflowProjection(workflowId) {
			return store.getWorkflowProjection(workflowId);
		},
		executeCommand(input) {
			if (input.schemaVersion !== undefined && input.schemaVersion !== "workflow-command/v1") {
				throw new Error("Command envelope schema is invalid");
			}
			const validTypes: readonly WorkflowCommandType[] = ["start", "pause", "resume"];
			if (!validTypes.includes(input.type)) {
				throw new Error("Command envelope schema is invalid");
			}
			if (!store.getWorkflowProjection(input.workflowId)) {
				throw new Error("Command envelope schema is invalid");
			}
			const { schemaVersion: _omitted, ...envelope } = input;
			void _omitted;
			return store.executeCommand(envelope as ExecuteCommandInput);
		},
		getCommandReceipt(workflowId, commandId) {
			return store.getCommandReceipt(workflowId, commandId);
		},
		close() {
			store.close();
		},
	};
}
