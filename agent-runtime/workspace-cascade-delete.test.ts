import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createCrashInjector,
	createFixtureClock,
	createFixtureOperator,
	createHashProvider,
	createOutboxTransport,
} from "./testing/deterministic-fixtures.ts";

import {
	openHeadlessWorkflowRuntime,
	type HeadlessWorkflowRuntime,
} from "./workflow/headless-runtime.ts";
import { BusyWorkspaceError } from "./persistence/workflow-store.ts";

import type { RequirementBaseline } from "./workflow/requirement.ts";
import type { CriticReport, RoleResult, TraceLinkProposal } from "./workflow/role-result.ts";

const OPERATOR = createFixtureOperator("admin");
const TIMESTAMP = "2026-08-12T10:00:00.000Z";

const BASELINE: RequirementBaseline = {
	schemaVersion: "artifact/requirement/v1",
	artifactKind: "requirement",
	summary: "Cascade delete fixture",
	sourceRefs: [],
	title: "Cascade delete fixture",
	description: "Populated for workspace cascade delete verification.",
};

interface CascadeContext {
	runtime: HeadlessWorkflowRuntime;
	databasePath: string;
}

async function withCascadeRuntime(run: (context: CascadeContext) => Promise<void>): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), "workspace-cascade-"));
	const databasePath = join(directory, "test.db");
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock: createFixtureClock(TIMESTAMP),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector(),
		outboxTransport: createOutboxTransport(),
	});
	try {
		await run({ runtime, databasePath });
	} finally {
		runtime.close();
		rmSync(directory, { recursive: true, force: true });
	}
}

function workspaceBaseline(): RequirementBaseline {
	const baseline = { ...BASELINE };
	return baseline;
}

function createWorkflow(runtime: HeadlessWorkflowRuntime): { workspaceId: number; workflowId: number; requirementId: number } {
	const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
	const created = runtime.createRequirement({ workspaceId, baseline: workspaceBaseline() });
	runtime.executeCommand({
		workflowId: created.workflowId,
		commandId: "cmd-start",
		expectedWorkflowVersion: 0,
		type: "start",
		operator: OPERATOR,
	});
	const projection = runtime.getWorkflowProjection(created.workflowId);
	assert.ok(projection);
	return { workspaceId, workflowId: created.workflowId, requirementId: projection.requirement.id };
}

/** #19：模板规划 —— planWorkflow(workflowId, null) 确定性实例化 13-Task 模板（8 生产 + 5 Critic 复审），无 Orchestrator 模型调用。 */
async function adoptTemplatePlan(runtime: HeadlessWorkflowRuntime, workflowId: number): Promise<void> {
	const result = await runtime.planWorkflow(workflowId, null);
	assert.equal(result.outcome, "adopted");
}


function analysisContent(): unknown {
	const dimension = { status: "no", rationale: "rationale" };
	return {
		schemaVersion: "artifact/analysis/v1",
		artifactKind: "analysis",
		summary: "Analysis",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		goals: ["Understand"],
		nonGoals: ["Design"],
		constraints: ["Backward compatible"],
		acceptanceCriteria: ["Tests pass"],
		impactProfile: { process: dimension, actors: dimension, behavior: dimension, architecture: dimension, data: dimension, api: dimension },
		openQuestions: [],
	};
}



function setupEvidence(runtime: HeadlessWorkflowRuntime, workflowId: number): TraceLinkProposal {
	const snapshot = runtime.bindEvidenceSnapshot(workflowId, "sha256:repo-abc", { files: [] });
	return { evidenceSnapshotId: snapshot.id, sourceRef: { type: "code", path: "/src/analysis.ts" } };
}

function executeAnalystTask(runtime: HeadlessWorkflowRuntime, workflowId: number): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskRole, "analysis-analyst");
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: [{ effectType: "artifact_revision", artifactKind: "analysis", logicalKey: "analysis", content: analysisContent(), baseRevisionId: null, traceLinks: [setupEvidence(runtime, workflowId)] }],
	};
	assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, result).outcome, "published");
}



function getRevisionId(databasePath: string, kind: string): number {
	const db = new Database(databasePath, { readonly: true });
	try {
		const row = db.prepare("select ar.id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.kind = ? order by ar.id desc limit 1").get(kind) as { id: number } | undefined;
		assert.ok(row, `${kind} revision should exist`);
		return row.id;
	} finally {
		db.close();
	}
}

function executeCriticTask(runtime: HeadlessWorkflowRuntime, databasePath: string, workflowId: number): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskRole, "critic");
	const report: CriticReport = {
		schemaVersion: "critic-report/v1",
		workflowId,
		attemptId: begin.attemptId,
		coverageAttestation: {
			reviewTargets: ["requirement", "analysis"].map((kind) => ({ revisionId: getRevisionId(databasePath, kind), artifactKind: kind })),
			complete: true,
		},
		findings: [{ fingerprint: "f1", severity: "major", summary: "Missing edge case", targetRevisionId: getRevisionId(databasePath, "analysis"), targetArtifactKind: "analysis", sourceRef: "review-analysis" }],
	};
	const result: RoleResult = { schemaVersion: "role-result/v1", workflowId, attemptId: begin.attemptId, effects: [], criticReport: report };
	assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, result).outcome, "published");
}

async function buildDeepWorkflow(runtime: HeadlessWorkflowRuntime, databasePath: string): Promise<{ workspaceId: number; workflowId: number; requirementId: number }> {
	const created = createWorkflow(runtime);
	await adoptTemplatePlan(runtime, created.workflowId);
	executeAnalystTask(runtime, created.workflowId);
	executeCriticTask(runtime, databasePath, created.workflowId);
	return created;
}

function seedNicheRows(databasePath: string, ids: { workspaceId: number; workflowId: number; requirementId: number }): void {
	const db = new Database(databasePath);
	try {
		db.pragma("foreign_keys = ON");
		const runId = (db.prepare("select id from runs where workflow_id = ? order by id desc limit 1").get(ids.workflowId) as { id: number }).id;
		const documentId = (db.prepare("select id from snapshot_documents order by id limit 1").get() as { id: number }).id;
		const timestamp = TIMESTAMP;
		db.prepare("insert into run_events(run_id, seq, type, schema_version, payload, created_at) values (?, 1, 'agent_tool_call', 'run-event/v1', '{}', ?)").run(runId, timestamp);
		db.prepare("insert into outbox_jobs(workflow_id, event_seq, delivery_type, payload, created_at) values (?, 1, 'workflow_event', '{}', ?)").run(ids.workflowId, timestamp);

		db.prepare("insert into workflow_incidents(workflow_id, incident_type, failure_code, subject_type, subject_id, subject_version, status, created_at) values (?, 'outbox_exhausted', 'outbox_exhausted', 'outbox_job', 1, 0, 'open', ?)").run(ids.workflowId, timestamp);
		db.prepare("insert into human_directives(workflow_id, directive_text, actor_snapshot_document_id, command_id, created_at) values (?, 'Focus on expiry', ?, 'cmd-steer', ?)").run(ids.workflowId, documentId, timestamp);
		db.prepare("insert into human_gates(workflow_id, gate_type, subject_type, subject_id, status, opened_at) values (?, 'finding_disposition', 'finding', 999, 'open', ?)").run(ids.workflowId, timestamp);
		db.prepare("insert into approval_records(workflow_id, record_type, subject_type, subject_id, reason, targets_json, actor_snapshot_document_id, command_id, created_at) values (?, 'artifact_approval', 'artifact_revision', 1, null, '[]', ?, 'cmd-approve', ?)").run(ids.workflowId, documentId, timestamp);
		db.prepare("insert into approval_packets(workflow_id, digest, content_json, status, created_at) values (?, 'sha256:packet', '{}', 'current', ?)").run(ids.workflowId, timestamp);
		db.prepare("insert into diagnostic_runs(workflow_id, purpose, status, actor_snapshot_document_id, command_id, created_at) values (?, 'inspect state', 'completed', ?, 'cmd-diagnose', ?)").run(ids.workflowId, documentId, timestamp);
		db.prepare("insert into legacy_imports(requirement_id, workflow_id, import_class, bundle_document_id, attestation_document_id, anomaly_count, created_at) values (?, ?, 'legacy_archived', ?, ?, 0, ?)").run(ids.requirementId, ids.workflowId, documentId, documentId, timestamp);
		db.prepare("insert into design_packages(requirement_id, workspace_id, document_id, digest, migration_attestation_document_id, archive_class, archived_at) values (?, ?, ?, 'sha256:design-package', ?, 'legacy_pre_policy', ?)").run(ids.requirementId, ids.workspaceId, documentId, documentId, timestamp);
	} finally {
		db.close();
	}
}

function foreignKeyViolations(databasePath: string): unknown[] {
	const db = new Database(databasePath, { readonly: true });
	try {
		return db.pragma("foreign_key_check") as unknown[];
	} finally {
		db.close();
	}
}

test("deleteWorkspace returns false for an unknown workspace and deletes an empty one (repo_path reusable)", async () => {
	await withCascadeRuntime(async ({ runtime }) => {
		assert.equal(runtime.deleteWorkspace(999), false);
		const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
		assert.equal(runtime.deleteWorkspace(workspaceId), true);
		assert.deepEqual(runtime.listWorkspaces(), []);
		const reclaimed = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo again" });
		assert.ok(reclaimed > 0, "deleted repo_path identity must be reusable");
	});
});

test("deleteWorkspace refuses a workspace with a running run and an active claim", async () => {
	await withCascadeRuntime(async ({ runtime }) => {
		const { workspaceId, workflowId } = createWorkflow(runtime);
		await adoptTemplatePlan(runtime, workflowId);
		const begin = runtime.beginAttempt(workflowId);
		assert.equal(begin.taskRole, "analysis-analyst");
		assert.throws(
			() => runtime.deleteWorkspace(workspaceId),
			(error: unknown) => {
				assert.ok(error instanceof BusyWorkspaceError);
				assert.equal(error.activeRuns, 1);
				assert.equal(error.activeClaims, 1);
				return true;
			},
		);
		assert.equal(runtime.listWorkspaces().length, 1, "workspace must survive a refused delete");
	});
});

test("deleteWorkspace refuses a workspace with a queued run even after the claim is released", async () => {
	await withCascadeRuntime(async ({ runtime, databasePath }) => {
		const { workspaceId, workflowId } = createWorkflow(runtime);
		await adoptTemplatePlan(runtime, workflowId);
		runtime.beginAttempt(workflowId);
		const db = new Database(databasePath);
		try {
			db.prepare("update runs set status = 'queued' where workflow_id = ? and status = 'running'").run(workflowId);
			db.prepare("update governance_claims set status = 'released', released_at = ? where workflow_id = ? and status = 'active'").run(TIMESTAMP, workflowId);
		} finally {
			db.close();
		}
		assert.throws(
			() => runtime.deleteWorkspace(workspaceId),
			(error: unknown) => {
				assert.ok(error instanceof BusyWorkspaceError);
				assert.equal(error.activeRuns, 1);
				assert.equal(error.activeClaims, 0);
				return true;
			},
		);
	});
});

test("deleteWorkspace succeeds once the in-flight attempt completes", async () => {
	await withCascadeRuntime(async ({ runtime }) => {
		const { workspaceId, workflowId } = createWorkflow(runtime);
		await adoptTemplatePlan(runtime, workflowId);
		executeAnalystTask(runtime, workflowId);
		assert.equal(runtime.deleteWorkspace(workspaceId), true);
		assert.deepEqual(runtime.listWorkspaces(), []);
	});
});

test("full cascade delete: deep subtree and sibling workspace isolation, Store FK-clean on reopen", async () => {
	await withCascadeRuntime(async ({ runtime, databasePath }) => {
		const deep = await buildDeepWorkflow(runtime, databasePath);
		runtime.createReusableAsset({ workspaceId: deep.workspaceId, kind: "stakeholder", title: "operator", content: { name: "Operator", description: "System operator" } });
		runtime.createReusableAsset({ workspaceId: deep.workspaceId, kind: "scenario", title: "happy path", content: { title: "happy path", steps: [] } });
		seedNicheRows(databasePath, deep);

		const sibling = runtime.createWorkspace({ repoPath: "/tmp/sibling", name: "Sibling" });
		const siblingRequirement = runtime.createRequirement({ workspaceId: sibling, baseline: workspaceBaseline() });
		runtime.executeCommand({
			workflowId: siblingRequirement.workflowId,
			commandId: "cmd-start-sibling",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: OPERATOR,
		});
		const siblingAsset = runtime.createReusableAsset({ workspaceId: sibling, kind: "scenario", title: "sibling asset", content: { title: "sibling", steps: [] } });
		// Cross-workspace trace link: deep workspace's revision cited from the sibling's evidence.
		const siblingEvidence = runtime.bindEvidenceSnapshot(siblingRequirement.workflowId, "sha256:sibling-evidence", { files: [] });
		const deepAnalysisRevisionId = getRevisionId(databasePath, "analysis");
		const linkDb = new Database(databasePath);
		try {
			linkDb.pragma("foreign_keys = ON");
			linkDb
				.prepare("insert into trace_links(artifact_revision_id, evidence_snapshot_id, source_ref_json, created_at) values (?, ?, '{}', ?)")
				.run(deepAnalysisRevisionId, siblingEvidence.id, TIMESTAMP);
		} finally {
			linkDb.close();
		}

		const projection = runtime.getWorkflowProjection(deep.workflowId);
		assert.ok(projection, "deep workflow must exist before delete");
		assert.ok(runtime.getRequirementDetail(deep.requirementId), "deep requirement must exist before delete");

		assert.equal(runtime.deleteWorkspace(deep.workspaceId), true);

		assert.deepEqual(
			runtime.listWorkspaces().map((workspace) => workspace.id),
			[sibling],
			"sibling workspace must survive",
		);
		assert.equal(runtime.getRequirementDetail(deep.requirementId), undefined, "deep requirement must be gone");
		assert.ok(runtime.getRequirementDetail(siblingRequirement.requirementId), "sibling requirement must survive");
		assert.ok(runtime.getReusableAsset(siblingAsset.assetId), "sibling asset must survive");

		runtime.close();
		assert.deepEqual(foreignKeyViolations(databasePath), [], "database must be FK-clean after cascade delete");

		// Reopen the Store on the same database: migrations + recovery must pass cleanly.
		const reopened = await openHeadlessWorkflowRuntime({
			databasePath,
			clock: createFixtureClock(TIMESTAMP),
			hashProvider: createHashProvider(),
			crashInjector: createCrashInjector(),
			outboxTransport: createOutboxTransport(),
		});
		try {
			assert.deepEqual(
				reopened.listWorkspaces().map((workspace) => workspace.id),
				[sibling],
				"reopened Store must see only the sibling workspace",
			);
		} finally {
			reopened.close();
		}
	});
});