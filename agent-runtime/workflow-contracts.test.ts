import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	ContractValidationError,
	defaultContractAssetDirectory,
	loadWorkflowContracts,
} from "./workflow/contracts/loader.ts";

async function copyContractAssets(): Promise<string> {
	const source = defaultContractAssetDirectory();
	const target = await mkdtemp(path.join(tmpdir(), "baize-contracts-"));
	const contracts = await loadWorkflowContracts(source);
	await Promise.all(
		contracts.assets.map(async ({ fileName }) => {
			const content = await readFile(path.join(source, fileName), "utf8");
			await writeFile(path.join(target, fileName), content);
		}),
	);
	return target;
}

test("loads every versioned Workflow contract through one validated catalog", async () => {
	const contracts = await loadWorkflowContracts();

	assert.equal(contracts.assets.length, 11);
	assert.deepEqual(
		contracts.assets.map(({ identity }) => identity).sort(),
		[
			"artifact-content/v1",
			"concurrency-policy/v1",
			"cutover-policy/v1",
			"implementation-plan/v1",
			"operator-experience/v1",
			"persistence-model/v1",
			"plan-proposal/v1",
			"readiness-policy/v1",
			"recovery-policy/v1",
			"workflow-api/v1",
			"workflow-event-catalog/v1",
		].sort(),
	);
	assert.equal(contracts.get("plan-proposal/v1").fileName, "plan-proposal-v1.schema.json");
	assert.deepEqual(
		contracts.get("implementation-plan/v1").content.nonNegotiableContracts,
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
		],
	);
});

test("keeps packaged runtime contracts byte-identical to the Wayfinder source", async () => {
	const source = path.resolve(
		process.cwd(),
		"../.wayfinder/2026-08-auto-orchestration/assets",
	);
	const packaged = path.resolve(process.cwd(), "contracts");
	const contracts = await loadWorkflowContracts(packaged);
	for (const { fileName } of contracts.assets) {
		assert.equal(
			await readFile(path.join(packaged, fileName), "utf8"),
			await readFile(path.join(source, fileName), "utf8"),
			`${fileName} must be copied without modification`,
		);
	}
});


test("rejects structurally incomplete machine contracts", async () => {
	const directory = await copyContractAssets();
	try {
		const file = path.join(directory, "recovery-policy-v1.json");
		const contract = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
		delete contract.startupGate;
		await writeFile(file, `${JSON.stringify(contract, null, 2)}\n`);
		await assert.rejects(
			loadWorkflowContracts(directory),
			(error: unknown) =>
				error instanceof ContractValidationError &&
				error.code === "contract_structure_invalid" &&
				error.fileName === "recovery-policy-v1.json",
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("rejects malformed nested contract structures", async (t) => {
	const cases = [
		{
			name: "null object section",
			fileName: "concurrency-policy-v1.json",
			mutate: (contract: Record<string, unknown>) => {
				contract.governanceExecution = null;
			},
		},
		{
			name: "wrong event catalog section type",
			fileName: "workflow-event-catalog-v1.json",
			mutate: (contract: Record<string, unknown>) => {
				contract.workflowEventTypes = [];
			},
		},
	] as const;

	for (const fixture of cases) {
		await t.test(fixture.name, async () => {
			const directory = await copyContractAssets();
			try {
				const file = path.join(directory, fixture.fileName);
				const contract = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
				fixture.mutate(contract);
				await writeFile(file, `${JSON.stringify(contract, null, 2)}\n`);
				await assert.rejects(
					loadWorkflowContracts(directory),
					(error: unknown) =>
						error instanceof ContractValidationError &&
						error.code === "contract_structure_invalid" &&
						error.fileName === fixture.fileName,
				);
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		});
	}
});

test("rejects an unknown contract version", async () => {
	const directory = await copyContractAssets();
	try {
		const file = path.join(directory, "concurrency-policy-v1.json");
		const contract = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
		contract.schemaVersion = "concurrency-policy/v2";
		await writeFile(file, `${JSON.stringify(contract, null, 2)}\n`);

		await assert.rejects(
			loadWorkflowContracts(directory),
			(error: unknown) =>
				error instanceof ContractValidationError &&
				error.code === "unknown_contract_version" &&
				error.fileName === "concurrency-policy-v1.json",
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("rejects inconsistent references between contracts", async (t) => {
	await t.test("API replacement plan schema", async () => {
		const directory = await copyContractAssets();
		try {
			const file = path.join(directory, "workflow-api-v1.json");
			const contract = JSON.parse(await readFile(file, "utf8")) as {
				commands: Record<string, { proposalSchema?: string }>;
			};
			contract.commands["replace-plan"].proposalSchema = "plan-proposal/v2";
			await writeFile(file, `${JSON.stringify(contract, null, 2)}\n`);
			await assert.rejects(
				loadWorkflowContracts(directory),
				(error: unknown) =>
					error instanceof ContractValidationError &&
					error.code === "contract_reference_mismatch" &&
					error.fileName === "workflow-api-v1.json",
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	await t.test("Cutover target tables", async () => {
		const directory = await copyContractAssets();
		try {
			const file = path.join(directory, "cutover-policy-v1.json");
			const contract = JSON.parse(await readFile(file, "utf8")) as {
				targetSchemaAdditions: { tables: string[] };
			};
			contract.targetSchemaAdditions.tables = ["legacy_imports"];
			await writeFile(file, `${JSON.stringify(contract, null, 2)}\n`);
			await assert.rejects(
				loadWorkflowContracts(directory),
				(error: unknown) =>
					error instanceof ContractValidationError &&
					error.code === "contract_reference_mismatch" &&
					error.fileName === "cutover-policy-v1.json",
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	await t.test("Readiness global planning budget", async () => {
		const directory = await copyContractAssets();
		try {
			const file = path.join(directory, "readiness-policy-v1.json");
			const contract = JSON.parse(await readFile(file, "utf8")) as {
				findingPolicy: { globalPlanRevisionBudgetRef: string };
			};
			contract.findingPolicy.globalPlanRevisionBudgetRef =
				"orchestrator-plan-policy/v2#maxConsecutivePlanRevisionsWithoutHuman";
			await writeFile(file, `${JSON.stringify(contract, null, 2)}\n`);
			await assert.rejects(
				loadWorkflowContracts(directory),
				(error: unknown) =>
					error instanceof ContractValidationError &&
					error.code === "contract_reference_mismatch" &&
					error.fileName === "readiness-policy-v1.json",
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	await t.test("Readiness ImpactProfile schema", async () => {
		const directory = await copyContractAssets();
		try {
			const file = path.join(directory, "readiness-policy-v1.json");
			const contract = JSON.parse(await readFile(file, "utf8")) as {
				artifactRequirementPolicy: { impactProfileSchemaVersion: string };
			};
			contract.artifactRequirementPolicy.impactProfileSchemaVersion = "artifact/analysis/v2";
			await writeFile(file, `${JSON.stringify(contract, null, 2)}\n`);
			await assert.rejects(
				loadWorkflowContracts(directory),
				(error: unknown) =>
					error instanceof ContractValidationError &&
					error.code === "contract_reference_mismatch" &&
					error.fileName === "readiness-policy-v1.json",
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	await t.test("Legacy Requirement Bundle schema", async () => {
		const directory = await copyContractAssets();
		try {
			const file = path.join(directory, "cutover-policy-v1.json");
			const contract = JSON.parse(await readFile(file, "utf8")) as {
				legacyRequirementBundle: { schemaRef: string };
			};
			contract.legacyRequirementBundle.schemaRef = "legacy-requirement-bundle/v2";
			await writeFile(file, `${JSON.stringify(contract, null, 2)}\n`);
			await assert.rejects(
				loadWorkflowContracts(directory),
				(error: unknown) =>
					error instanceof ContractValidationError &&
					error.code === "contract_reference_mismatch" &&
					error.fileName === "cutover-policy-v1.json",
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
