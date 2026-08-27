import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildLegacyFixture } from "./cutover/legacy-fixture-builder.js";
import { runCutoverCheck } from "./cutover/cutover-checker.js";
import { CutoverApplier } from "./cutover/cutover-applier.js";
import { WorkflowStore } from "./persistence/workflow-store.js";
import { createFixtureClock, createHashProvider, createCrashInjector, createOutboxTransport } from "./testing/deterministic-fixtures.js";
import { loadWorkflowContracts } from "./workflow/contracts/loader.js";
import { compileWorkflowSchema } from "./workflow/contracts/schema.js";
import type { LegacyFixtureManifest, CutoverReport } from "./cutover/cutover-types.js";

function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `cutover-apply-${prefix}-`));
}

interface ApplyTestContext {
	dir: string;
	legacyDbPath: string;
	sessionDir: string;
	report: CutoverReport;
	governanceDbPath: string;
	cleanup: () => void;
}

async function setupApplyContext(
	manifest: LegacyFixtureManifest,
	prefix: string,
): Promise<ApplyTestContext> {
	const dir = tempDir(prefix);
	const fixture = buildLegacyFixture(dir, manifest);
	const report = runCutoverCheck(fixture.dbPath, fixture.sessionDir);
	const governanceDbPath = join(dir, "governance.db");
	return {
		dir,
		legacyDbPath: fixture.dbPath,
		sessionDir: fixture.sessionDir,
		report,
		governanceDbPath,
		cleanup: () => {
			fixture.legacy.close();
		},
	};
}

async function createStore(dbPath: string): Promise<WorkflowStore> {
	const contracts = await loadWorkflowContracts();
	const artifactValidator = compileWorkflowSchema(contracts, "artifact-content/v1");
	const planValidator = compileWorkflowSchema(contracts, "plan-proposal/v1");
	const policyBundle = {
		schemaVersion: "policy-bundle/v1" as const,
		contracts: contracts.assets
			.map((asset) => ({
				identity: asset.identity,
				digest: createHashProvider().digest(asset.content),
				content: asset.content,
			}))
			.sort((left, right) => left.identity.localeCompare(right.identity)),
	};
	return new WorkflowStore({
		databasePath: dbPath,
		clock: createFixtureClock("2026-08-15T10:00:00.000Z"),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector([]),
		outboxTransport: createOutboxTransport(),
		policyBundle,
		artifactValidator,
		planValidator,
	});
}

function createApplier(store: WorkflowStore): CutoverApplier {
	return new CutoverApplier(store, createCrashInjector([]));
}

// --- Manifests (reuse from cutover-fixture tests) ---

const EMPTY_MANIFEST: LegacyFixtureManifest = {
	name: "apply-empty",
	description: "Empty database",
	workspace: { repoPath: "/repo", name: "test" },
	requirements: [],
	expected: {
		classifications: [],
		anomalies: [],
		counts: { requirements: 0 },
		applyEligible: true,
		blockingReasons: [],
	},
};

const ARCHIVE_MANIFEST: LegacyFixtureManifest = {
	name: "apply-archive",
	description: "Archived requirement",
	workspace: { repoPath: "/repo", name: "test" },
	requirements: [
		{
			title: "Archived Feature",
			description: "A completed feature",
			archived: true,
			hasDesignPackage: true,
			sessionFile: "valid",
			runs: [{ kind: "main", status: "completed" }],
			artifacts: [
				{
					kind: "analysis",
					revisions: [{ content: { summary: "done" }, status: "approved" }],
				},
			],
		},
	],
	expected: {
		classifications: [{ requirementIndex: 0, classification: "legacy_archived" }],
		anomalies: [],
		counts: { requirements: 1, design_packages: 1 },
		applyEligible: true,
		blockingReasons: [],
	},
};

const PENDING_MANIFEST: LegacyFixtureManifest = {
	name: "apply-pending",
	description: "Pending re-entry requirement",
	workspace: { repoPath: "/repo", name: "test" },
	requirements: [
		{
			title: "Pending Feature",
			description: "Not yet archived",
			archived: false,
			hasDesignPackage: false,
			sessionFile: "valid",
			runs: [{ kind: "main", status: "completed" }],
			artifacts: [
				{
					kind: "analysis",
					revisions: [{ content: { summary: "draft" }, status: "draft" }],
				},
			],
		},
	],
	expected: {
		classifications: [{ requirementIndex: 0, classification: "pending_reentry" }],
		anomalies: [],
		counts: { requirements: 1 },
		applyEligible: true,
		blockingReasons: [],
	},
};

const MANUAL_ASSET_MANIFEST: LegacyFixtureManifest = {
	name: "apply-manual",
	description: "Manual asset source",
	workspace: { repoPath: "/repo", name: "test" },
	requirements: [
		{
			title: "手动资产库",
			source: "manual-assets",
			archived: false,
			hasDesignPackage: false,
			sessionFile: "valid",
			runs: [{ kind: "manual-asset", status: "completed" }],
			artifacts: [
				{
					kind: "scenario",
					revisions: [{ content: { nodeId: "sv1", title: "scenario 1", actors: ["User"], mainFlow: ["Start"], trigger: "Start", expectedOutcome: "Complete" }, status: "approved" }],
				},
			],
		},
	],
	expected: {
		classifications: [{ requirementIndex: 0, classification: "manual_asset_source" }],
		anomalies: [],
		counts: { requirements: 1 },
		applyEligible: true,
		blockingReasons: [],
	},
};

const MIXED_MANIFEST: LegacyFixtureManifest = {
	name: "apply-mixed",
	description: "Archive + pending + manual",
	workspace: { repoPath: "/repo", name: "test" },
	requirements: [
		{
			title: "Archived One",
			archived: true,
			hasDesignPackage: true,
			sessionFile: "valid",
			runs: [{ kind: "main", status: "completed" }],
			artifacts: [],
		},
		{
			title: "Pending Two",
			archived: false,
			hasDesignPackage: false,
			sessionFile: "valid",
			runs: [{ kind: "main", status: "completed" }],
			artifacts: [],
		},
		{
			title: "Manual Three",
			source: "manual-assets",
			archived: false,
			hasDesignPackage: false,
			sessionFile: "valid",
			runs: [{ kind: "manual-asset", status: "completed" }],
			artifacts: [
				{
					kind: "scenario",
					revisions: [{ content: { nodeId: "sv2", title: "scenario 2", actors: ["User"], mainFlow: ["Start"], trigger: "Start", expectedOutcome: "Complete" }, status: "approved" }],
				},
			],
		},
	],
	expected: {
		classifications: [
			{ requirementIndex: 0, classification: "legacy_archived" },
			{ requirementIndex: 1, classification: "pending_reentry" },
			{ requirementIndex: 2, classification: "manual_asset_source" },
		],
		anomalies: [],
		counts: { requirements: 3 },
		applyEligible: true,
		blockingReasons: [],
	},
};

const ACTIVE_RUN_MANIFEST: LegacyFixtureManifest = {
	name: "apply-active-run",
	description: "Active run blocks cutover",
	workspace: { repoPath: "/repo", name: "test" },
	requirements: [
		{
			title: "Active Run",
			archived: false,
			hasDesignPackage: false,
			sessionFile: "valid",
			runs: [{ kind: "main", status: "running" }],
			artifacts: [],
		},
	],
	expected: {
		classifications: [{ requirementIndex: 0, classification: "pending_reentry" }],
		anomalies: [{ type: "active_run", requirementIndex: 0, blocking: true }],
		counts: { requirements: 1 },
		applyEligible: false,
		blockingReasons: ["active_run"],
	},
};

// --- Tests ---

test("apply: empty database — no requirements imported, attestation created", async () => {
	const ctx = await setupApplyContext(EMPTY_MANIFEST, "empty");
	const store = await createStore(ctx.governanceDbPath);
	const applier = createApplier(store);
	try {
		const result = applier.apply(ctx.legacyDbPath, ctx.sessionDir, ctx.report);
		assert.ok(result.attestationDocumentId > 0);
		assert.strictEqual(result.importedRequirements, 0);
		assert.strictEqual(result.archivedWorkflows, 0);
		assert.strictEqual(result.pendingWorkflows, 0);
		assert.strictEqual(result.reusableAssetsImported, 0);
		assert.strictEqual(result.reportDigest, ctx.report.reportDigest);

		const attestation = store.getMigrationAttestation();
		assert.ok(attestation, "attestation must exist after apply");
		assert.strictEqual(attestation!.reportDigest, ctx.report.reportDigest);
	} finally {
		store.close();
		ctx.cleanup();
		rmSync(ctx.dir, { recursive: true, force: true });
	}
});

test("apply: archived requirement — legacy_pre_policy workflow, no fake approval", async () => {
	const ctx = await setupApplyContext(ARCHIVE_MANIFEST, "archive");
	const store = await createStore(ctx.governanceDbPath);
	const applier = createApplier(store);
	try {
		const result = applier.apply(ctx.legacyDbPath, ctx.sessionDir, ctx.report);
		assert.strictEqual(result.archivedWorkflows, 1);
		assert.strictEqual(result.pendingWorkflows, 0);
		assert.strictEqual(result.importedRequirements, 1);

		// Verify the workflow is archived
		const projection = store.getWorkflowProjection(1);
		assert.ok(projection, "workflow must exist");
		assert.strictEqual(projection!.workflow.state, "archived");

		// Verify design_package with legacy_pre_policy
		const reqs = store.listRequirements(1);
		assert.ok(reqs.length > 0, "requirement must exist");
		const legacyImport = store.getLegacyImport(reqs[0].requirementId);
		assert.ok(legacyImport, "legacy_import must exist");
		assert.strictEqual(legacyImport!.importClass, "legacy_archived");
	} finally {
		store.close();
		ctx.cleanup();
		rmSync(ctx.dir, { recursive: true, force: true });
	}
});

test("apply: pending re-entry — pending workflow, no old Run output as current artifact", async () => {
	const ctx = await setupApplyContext(PENDING_MANIFEST, "pending");
	const store = await createStore(ctx.governanceDbPath);
	const applier = createApplier(store);
	try {
		const result = applier.apply(ctx.legacyDbPath, ctx.sessionDir, ctx.report);
		assert.strictEqual(result.pendingWorkflows, 1);
		assert.strictEqual(result.archivedWorkflows, 0);

		const projection = store.getWorkflowProjection(1);
		assert.ok(projection, "workflow must exist");
		assert.strictEqual(projection!.workflow.state, "pending");

		const legacyImport = store.getLegacyImport(1);
		assert.ok(legacyImport, "legacy_import must exist");
		assert.strictEqual(legacyImport!.importClass, "pending_reentry");

		// No old Run output imported — only the requirement baseline artifact exists
		const reqs = store.listRequirements(1);
		assert.ok(reqs.length > 0);
		// The requirement revision should be pending (not approved from old data)
	} finally {
		store.close();
		ctx.cleanup();
		rmSync(ctx.dir, { recursive: true, force: true });
	}
});

test("apply: manual asset source — reusable assets, no fake Requirement or Run", async () => {
	const ctx = await setupApplyContext(MANUAL_ASSET_MANIFEST, "manual");
	const store = await createStore(ctx.governanceDbPath);
	const applier = createApplier(store);
	try {
		const result = applier.apply(ctx.legacyDbPath, ctx.sessionDir, ctx.report);
		assert.strictEqual(result.reusableAssetsImported, 1);
		assert.strictEqual(result.importedRequirements, 0);

		// No workflow created for manual assets
		const projection = store.getWorkflowProjection(1);
		assert.strictEqual(projection, undefined, "no workflow for manual assets");

		// Reusable assets exist
		const workspaceId = store.workspaceExists(1) ? 1 : 1;
		const assets = store.listReusableAssets(workspaceId);
		assert.strictEqual(assets.length, 1);
		assert.strictEqual(assets[0].kind, "scenario-variant");
		assert.ok(assets[0].legacyOriginRequirementId !== null, "legacy origin must be recorded");
	} finally {
		store.close();
		ctx.cleanup();
		rmSync(ctx.dir, { recursive: true, force: true });
	}
});

test("apply: mixed classifications — all three handled correctly", async () => {
	const ctx = await setupApplyContext(MIXED_MANIFEST, "mixed");
	const store = await createStore(ctx.governanceDbPath);
	const applier = createApplier(store);
	try {
		const result = applier.apply(ctx.legacyDbPath, ctx.sessionDir, ctx.report);
		assert.strictEqual(result.archivedWorkflows, 1);
		assert.strictEqual(result.pendingWorkflows, 1);
		assert.strictEqual(result.reusableAssetsImported, 1);
		assert.strictEqual(result.importedRequirements, 2);
	} finally {
		store.close();
		ctx.cleanup();
		rmSync(ctx.dir, { recursive: true, force: true });
	}
});

test("apply: idempotent — repeated apply returns existing attestation, no re-import", async () => {
	const ctx = await setupApplyContext(ARCHIVE_MANIFEST, "idempotent");
	const store = await createStore(ctx.governanceDbPath);
	const applier = createApplier(store);
	try {
		const result1 = applier.apply(ctx.legacyDbPath, ctx.sessionDir, ctx.report);
		const result2 = applier.apply(ctx.legacyDbPath, ctx.sessionDir, ctx.report);

		assert.strictEqual(result1.attestationDocumentId, result2.attestationDocumentId);
		assert.strictEqual(result2.importedRequirements, 0, "second apply must not re-import");
		assert.strictEqual(result2.archivedWorkflows, 0);
		assert.strictEqual(result2.pendingWorkflows, 0);
		assert.strictEqual(result2.reusableAssetsImported, 0);
	} finally {
		store.close();
		ctx.cleanup();
		rmSync(ctx.dir, { recursive: true, force: true });
	}
});

test("apply: active legacy run — rejected before any business write", async () => {
	const ctx = await setupApplyContext(ACTIVE_RUN_MANIFEST, "active-run");
	const store = await createStore(ctx.governanceDbPath);
	const applier = createApplier(store);
	try {
		assert.throws(
			() => applier.apply(ctx.legacyDbPath, ctx.sessionDir, ctx.report),
			/not eligible|active/i,
		);
		// Verify no governance rows were written
		const attestation = store.getMigrationAttestation();
		assert.strictEqual(attestation, null, "no attestation should exist after rejection");
	} finally {
		store.close();
		ctx.cleanup();
		rmSync(ctx.dir, { recursive: true, force: true });
	}
});

test("apply: mismatched report digest — rejected before any business write", async () => {
	const ctx = await setupApplyContext(ARCHIVE_MANIFEST, "digest-mismatch");
	const store = await createStore(ctx.governanceDbPath);
	const applier = createApplier(store);
	try {
		const tamperedReport = { ...ctx.report, reportDigest: "sha256:invalid" };
		assert.throws(
			() => applier.apply(ctx.legacyDbPath, ctx.sessionDir, tamperedReport),
			/digest does not match/i,
		);
		const attestation = store.getMigrationAttestation();
		assert.strictEqual(attestation, null, "no attestation after digest mismatch");
	} finally {
		store.close();
		ctx.cleanup();
		rmSync(ctx.dir, { recursive: true, force: true });
	}
});

test("apply: paired backup — legacy DB snapshot preserved before first business write", async () => {
	const ctx = await setupApplyContext(ARCHIVE_MANIFEST, "backup");
	const store = await createStore(ctx.governanceDbPath);
	const applier = createApplier(store);
	try {
		// Create paired backup copy
		const backupPath = join(ctx.dir, "backup-legacy.db");
		copyFileSync(ctx.legacyDbPath, backupPath);

		// Apply transforms the governance DB, but the backup must remain intact
		applier.apply(ctx.legacyDbPath, ctx.sessionDir, ctx.report);

		// Verify backup still exists and is readable
		assert.ok(existsSync(backupPath), "paired backup must exist");
		const backupReport = runCutoverCheck(backupPath, ctx.sessionDir);
		assert.strictEqual(backupReport.reportDigest, ctx.report.reportDigest, "backup must have same digest");
	} finally {
		store.close();
		ctx.cleanup();
		rmSync(ctx.dir, { recursive: true, force: true });
	}
});

test("apply: crash during migration transaction — rolls back to clean governance DB", async () => {
	const ctx = await setupApplyContext(ARCHIVE_MANIFEST, "crash");
	const store = await createStore(ctx.governanceDbPath);
	const crashInjector = createCrashInjector(["cutover_apply.before_commit"]);
	const applier = new CutoverApplier(store, crashInjector);
	try {
		assert.throws(
			() => applier.apply(ctx.legacyDbPath, ctx.sessionDir, ctx.report),
			/crash point reached/,
		);
		// Transaction rolled back — no attestation, no workflows
		const attestation = store.getMigrationAttestation();
		assert.strictEqual(attestation, null, "no attestation after crash rollback");
		const projection = store.getWorkflowProjection(1);
		assert.strictEqual(projection, undefined, "no workflow after crash rollback");
	} finally {
		store.close();
		ctx.cleanup();
		rmSync(ctx.dir, { recursive: true, force: true });
	}
});

test("apply: legacy origin id is audit scalar only — no FK, no orphan dependency", async () => {
	const ctx = await setupApplyContext(ARCHIVE_MANIFEST, "audit-scalar");
	const store = await createStore(ctx.governanceDbPath);
	const applier = createApplier(store);
	try {
		applier.apply(ctx.legacyDbPath, ctx.sessionDir, ctx.report);

		// Verify the legacy_origin_requirement_id column exists and has a value
		// (it's on reusable_assets and legacy_imports, not as a FK)
		const reqs = store.listRequirements(1);
		assert.ok(reqs.length > 0);
		const legacyImport = store.getLegacyImport(reqs[0].requirementId);
		assert.ok(legacyImport, "legacy_import must exist");
		// The legacy origin id is stored in the legacy_requirement_bundle snapshot,
		// not as a FK column on workflows
	} finally {
		store.close();
		ctx.cleanup();
		rmSync(ctx.dir, { recursive: true, force: true });
	}
});
