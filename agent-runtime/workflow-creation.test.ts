import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
	createCrashInjector,
	createFixtureClock,
	createHashProvider,
	createOutboxTransport,
} from "./testing/deterministic-fixtures.ts";
import {
	openHeadlessWorkflowRuntime,
	type RequirementBaseline,
} from "./workflow/headless-runtime.js";

const BASELINE: RequirementBaseline = {
	schemaVersion: "artifact/requirement/v1",
	artifactKind: "requirement",
	summary: "Add expiry reminders and controlled compensation.",
	sourceRefs: [],
	title: "Points expiry and compensation",
	description: "Add expiry reminders and controlled compensation.",
};

function runtimeOptions(databasePath: string, crashPoints: readonly string[] = []) {
	return {
		databasePath,
		clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector(crashPoints),
		outboxTransport: createOutboxTransport(),
	};
}

async function withRuntime(
	work: (fixture: {
		databasePath: string;
		runtime: Awaited<ReturnType<typeof openHeadlessWorkflowRuntime>>;
	}) => Promise<void> | void,
	crashPoints: readonly string[] = [],
): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-workflow-create-"));
	const databasePath = path.join(directory, "workflow.db");
	const runtime = await openHeadlessWorkflowRuntime(runtimeOptions(databasePath, crashPoints));
	try {
		await work({ databasePath, runtime });
	} finally {
		runtime.close();
		await rm(directory, { recursive: true, force: true });
	}
}

test("creates a Requirement with its complete pending governance projection atomically", async () => {
	await withRuntime(async ({ runtime }) => {
		const workspaceId = runtime.createWorkspace({
			repoPath: "/tmp/baize-target-workspace",
			name: "Target workspace",
		});

		const created = runtime.createRequirement({ workspaceId, baseline: BASELINE });
		assert.deepEqual(created, {
			requirementId: created.requirementId,
			workflowId: created.workflowId,
			workflowState: "pending",
			workflowVersion: 0,
			lastEventSeq: 1,
		});

		const projection = runtime.getWorkflowProjection(created.workflowId);
		assert.ok(projection);
		assert.deepEqual(projection.requirement, {
			id: created.requirementId,
			workspaceId,
			title: BASELINE.title,
			version: 1,
			currentRevision: {
				artifactId: projection.requirement.currentRevision.artifactId,
				id: projection.requirement.currentRevision.id,
				revisionNo: 1,
				status: "pending",
				schemaRef: "artifact/requirement/v1",
				contentDocumentId: projection.requirement.currentRevision.contentDocumentId,
				contentDigest: projection.requirement.currentRevision.contentDigest,
				content: BASELINE,
			},
		});
		assert.deepEqual(projection.designSession, {
			id: projection.designSession.id,
			status: "active",
			sessionFile: `workflow-sessions/requirement-${created.requirementId}.jsonl`,
			sessionId: `design-session:${created.requirementId}`,
		});
		assert.equal(projection.workflow.state, "pending");
		assert.equal(projection.workflow.version, 0);
		assert.equal(projection.workflow.lastEventSeq, 1);
		assert.equal(projection.workflow.currentPlanRevisionId, null);
		assert.equal(projection.workflow.currentApprovalPacketId, null);
		assert.equal(projection.workflow.currentFailureCode, null);
		assert.equal(projection.workflow.policyBundle.schemaRef, "policy-bundle/v1");
		assert.match(projection.workflow.policyBundle.digest, /^sha256:[a-f0-9]{64}$/);
		assert.equal(projection.workflow.policyBundle.content.contracts.length, 12);
		for (const contract of projection.workflow.policyBundle.content.contracts) {
			assert.equal(typeof contract.identity, "string");
			assert.match(contract.digest, /^sha256:[a-f0-9]{64}$/);
			assert.equal(typeof contract.content, "object");
		}
		assert.deepEqual(projection.events, [
			{
				workflowId: created.workflowId,
				seq: 1,
				type: "workflow_created",
				typeVersion: 1,
				schemaVersion: "workflow-event/v1",
				workflowVersion: 0,
				entity: { type: "workflow", id: created.workflowId, version: 0 },
				payload: {
					requirementId: created.requirementId,
					requirementRevisionId: projection.requirement.currentRevision.id,
					designSessionId: projection.designSession.id,
					policyBundleDocumentId: projection.workflow.policyBundle.documentId,
					policyBundleDigest: projection.workflow.policyBundle.digest,
				},
				createdAt: "2026-08-12T10:00:00.000Z",
			},
		]);
	});
});

test("persists per-workflow modelRoles and exposes them in projections and the created event", async () => {
	await withRuntime(async ({ runtime }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
		// 部分覆盖（#15 决议）：任意角色子集，未传回落部署默认
		const modelRoles = {
			"analysis-analyst": { provider: "qwen-token-plan-cn", modelId: "qwen-max" },
			"scenario-analyst": { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
		};
		const created = runtime.createRequirement({ workspaceId, baseline: BASELINE, modelRoles });

		const projection = runtime.getWorkflowProjection(created.workflowId);
		assert.ok(projection);
		assert.deepEqual(projection.workflow.modelRoles, modelRoles);

		const detail = runtime.getRequirementDetail(created.requirementId);
		assert.ok(detail);
		assert.deepEqual(detail.modelRoles, modelRoles);

		const bounded = runtime.getBoundedProjection(created.workflowId);
		assert.ok(bounded);
		assert.deepEqual(bounded.workflow.modelRoles, modelRoles);

		const createdEvent = projection.events.find((event) => event.type === "workflow_created");
		assert.ok(createdEvent);
		assert.deepEqual((createdEvent.payload as { modelRoles?: typeof modelRoles }).modelRoles, modelRoles);
	});
});

test("deduplicates immutable baseline and Policy Bundle documents", async () => {
	await withRuntime(async ({ runtime }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
		const first = runtime.createRequirement({ workspaceId, baseline: BASELINE });
		const second = runtime.createRequirement({ workspaceId, baseline: BASELINE });
		const firstProjection = runtime.getWorkflowProjection(first.workflowId);
		const secondProjection = runtime.getWorkflowProjection(second.workflowId);
		assert.ok(firstProjection && secondProjection);
		assert.equal(
			firstProjection.requirement.currentRevision.contentDocumentId,
			secondProjection.requirement.currentRevision.contentDocumentId,
		);
		assert.equal(
			firstProjection.workflow.policyBundle.documentId,
			secondProjection.workflow.policyBundle.documentId,
		);

		const reordered: RequirementBaseline = {
			description: BASELINE.description,
			title: BASELINE.title,
			sourceRefs: [],
			summary: BASELINE.summary,
			artifactKind: "requirement",
			schemaVersion: "artifact/requirement/v1",
		};
		const third = runtime.createRequirement({ workspaceId, baseline: reordered });
		const thirdProjection = runtime.getWorkflowProjection(third.workflowId);
		assert.ok(thirdProjection);
		assert.equal(
			firstProjection.requirement.currentRevision.contentDocumentId,
			thirdProjection.requirement.currentRevision.contentDocumentId,
		);
	});
});

test("database invariants prevent a second Workflow and Policy Bundle replacement", async () => {
	await withRuntime(async ({ databasePath, runtime }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
		const created = runtime.createRequirement({ workspaceId, baseline: BASELINE });
		const projection = runtime.getWorkflowProjection(created.workflowId);
		assert.ok(projection);
		const database = new Database(databasePath);
		try {
			assert.throws(
				() =>
					database
						.prepare(
							"insert into workflows(requirement_id, state, version, last_event_seq, policy_bundle_document_id, created_at, updated_at) values (?, 'pending', 0, 0, ?, ?, ?)",
						)
						.run(
							created.requirementId,
							projection.workflow.policyBundle.documentId,
							"2026-08-12T10:00:00.000Z",
							"2026-08-12T10:00:00.000Z",
						),
				/UNIQUE constraint failed: workflows.requirement_id/,
			);
			assert.throws(
				() =>
					database
						.prepare("update workflows set policy_bundle_document_id = policy_bundle_document_id + 1 where id = ?")
						.run(created.workflowId),
				/Workflow Policy Bundle is immutable/,
			);
			assert.throws(
				() =>
					database
						.prepare("delete from snapshot_documents where id = ?")
						.run(projection.workflow.policyBundle.documentId),
				/Snapshot Document is immutable/,
			);
		} finally {
			database.close();
		}
	});
});

test("database constraints protect immutable Workflow aggregate references and events", async () => {
	await withRuntime(async ({ databasePath, runtime }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
		const first = runtime.createRequirement({ workspaceId, baseline: BASELINE });
		const second = runtime.createRequirement({ workspaceId, baseline: BASELINE });
		const firstProjection = runtime.getWorkflowProjection(first.workflowId);
		const secondProjection = runtime.getWorkflowProjection(second.workflowId);
		assert.ok(firstProjection && secondProjection);

		const database = new Database(databasePath);
		try {
			database.pragma("foreign_keys = ON");
			assert.throws(
				() => database.prepare("insert into snapshot_documents(kind, schema_ref, media_type, content, digest, created_at) values ('unknown', 'x/v1', 'application/json', '{}', ?, ?)").run(
					"sha256:0000000000000000000000000000000000000000000000000000000000000000",
					"2026-08-12T10:00:00.000Z",
				),
				/CHECK constraint failed/,
			);
			assert.throws(
				() => database.prepare("insert into snapshot_documents(kind, schema_ref, media_type, content, digest, created_at) values ('artifact_content', 'x/v1', 'application/json', '{}', ?, ?)").run(
					"sha256:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
					"2026-08-12T10:00:00.000Z",
				),
				/CHECK constraint failed/,
			);
			assert.throws(
				() => database.prepare("insert into requirements(id, workspace_id, title, version, current_revision_id, created_at, updated_at) values (999, ?, 'invalid', 1, ?, ?, ?)").run(
					workspaceId,
					firstProjection.requirement.currentRevision.id,
					"2026-08-12T10:00:00.000Z",
					"2026-08-12T10:00:00.000Z",
				),
				/Requirement current revision must belong to its requirement Artifact/,
			);
			assert.throws(
				() => database.prepare("insert into workflows(requirement_id, state, version, last_event_seq, policy_bundle_document_id, created_at, updated_at) values (?, 'pending', 0, 0, ?, ?, ?)").run(
					999,
					firstProjection.requirement.currentRevision.contentDocumentId,
					"2026-08-12T10:00:00.000Z",
					"2026-08-12T10:00:00.000Z",
				),
				/Workflow Policy Bundle reference is invalid|FOREIGN KEY constraint failed/,
			);
			assert.throws(
				() => database.prepare("update requirements set current_revision_id = ? where id = ?").run(
					secondProjection.requirement.currentRevision.id,
					first.requirementId,
				),
				/Requirement current revision must belong to its requirement Artifact/,
			);
			assert.throws(
				() => database.prepare("insert into artifacts(id, requirement_id, kind, title, current_revision_id, created_at) values (999, ?, 'requirement', 'invalid', ?, ?)").run(
					first.requirementId,
					secondProjection.requirement.currentRevision.id,
					"2026-08-12T10:00:00.000Z",
				),
				/Artifact current revision must belong to the Artifact/,
			);
			assert.throws(
				() => database.prepare("update artifacts set current_revision_id = ? where id = ?").run(
					secondProjection.requirement.currentRevision.id,
					firstProjection.requirement.currentRevision.artifactId,
				),
				/Artifact current revision must belong to the Artifact/,
			);
			assert.throws(
				() => database.prepare("update artifact_revisions set content_digest = ? where id = ?").run(
					"sha256:0000000000000000000000000000000000000000000000000000000000000000",
					firstProjection.requirement.currentRevision.id,
				),
				/Artifact revision content identity does not match its Snapshot Document/,
			);
			assert.throws(
				() => database.prepare("update workflow_events set type = 'tampered' where workflow_id = ? and seq = 1").run(first.workflowId),
				/Workflow Event is immutable/,
			);
			assert.throws(
				() => database.prepare("update workflows set last_event_seq = 9 where id = ?").run(first.workflowId),
				/Workflow last event sequence is managed by event insertion/,
			);
			assert.throws(
				() => database.prepare("insert into workflow_events(workflow_id, seq, type, type_version, schema_version, workflow_version, payload, created_at) values (?, 3, 'gap', 1, 'workflow-event\/v1', 0, '{}', ?)").run(
					first.workflowId,
					"2026-08-12T10:00:00.000Z",
				),
				/Workflow Event sequence must be contiguous/,
			);
			assert.throws(
				() => database.prepare("delete from workflow_events where workflow_id = ? and seq = 1").run(first.workflowId),
				/Workflow Event is immutable/,
			);
			assert.throws(
				() => database.prepare("delete from workflows where id = ?").run(first.workflowId),
				/Workflow is lifetime-bound to its Requirement/,
			);
		} finally {
			database.close();
		}
	});
});

test("a late creation failure rolls back every governance row and snapshot", async () => {
	await withRuntime(async ({ databasePath, runtime }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
		assert.throws(
			() => runtime.createRequirement({ workspaceId, baseline: BASELINE }),
			/crash point reached: create_requirement.before_commit/,
		);
		assert.deepEqual(runtime.listRequirements(workspaceId), []);

		const database = new Database(databasePath, { readonly: true });
		try {
			for (const table of [
				"requirements",
				"artifacts",
				"artifact_revisions",
				"design_sessions",
				"workflows",
				"workflow_events",
				"snapshot_documents",
			]) {
				const row = database.prepare(`select count(*) as count from ${table}`).get() as { count: number };
				assert.equal(row.count, 0, `${table} must roll back`);
			}
		} finally {
			database.close();
		}

		const retried = runtime.createRequirement({ workspaceId, baseline: BASELINE });
		assert.equal(runtime.getWorkflowProjection(retried.workflowId)?.events.length, 1);
	}, ["create_requirement.before_commit"]);
});

test("invalid baseline content creates no partial Requirement", async () => {
	await withRuntime(async ({ runtime }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
		assert.throws(
			() =>
				runtime.createRequirement({
					workspaceId,
					baseline: { ...BASELINE, description: "" },
				}),
			/Requirement baseline does not match artifact\/requirement\/v1/,
		);
		assert.deepEqual(runtime.listRequirements(workspaceId), []);
	});
});

test("startup refuses an unknown newer Workflow schema migration", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-workflow-future-"));
	const databasePath = path.join(directory, "workflow.db");
	const runtime = await openHeadlessWorkflowRuntime(runtimeOptions(databasePath));
	runtime.close();
	const database = new Database(databasePath);
		database.prepare("insert into schema_migrations(version, name, checksum, applied_at) values (99, 'future', 'sha256:future', ?)").run("2026-08-12T10:00:00.000Z");
	database.close();
	try {
		await assert.rejects(
			openHeadlessWorkflowRuntime(runtimeOptions(databasePath)),
			/Workflow database migration 99 is newer than supported version 15/,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("startup refuses a changed migration checksum", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-workflow-checksum-"));
	const databasePath = path.join(directory, "workflow.db");
	const runtime = await openHeadlessWorkflowRuntime(runtimeOptions(databasePath));
	runtime.close();
	const database = new Database(databasePath);
	database.prepare("update schema_migrations set checksum = 'sha256:tampered' where version = 1").run();
	database.close();
	try {
		await assert.rejects(
			openHeadlessWorkflowRuntime(runtimeOptions(databasePath)),
			/Workflow migration 1 is missing or has a checksum mismatch/,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
