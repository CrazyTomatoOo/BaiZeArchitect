import assert from "node:assert/strict";
import test from "node:test";
import { openStore, RunInProgressError } from "./store.js";

test("persists design sessions, run events, and requirement run locks", () => {
	const store = openStore(":memory:");
	try {
		const workspaceId = store.addWorkspace("/tmp/baize-store-test", "Test workspace");
		const requirementId = store.addRequirement(workspaceId, "Design a feature");
		const session = store.createDesignSession(
			requirementId,
			"/tmp/baize-sessions/session.jsonl",
			"session-1",
		);

		assert.equal(session.requirement_id, requirementId);
		assert.equal(session.status, "active");
		assert.deepEqual(store.getDesignSession(requirementId), session);

		const run = store.createRun(requirementId, session.id, "stage", "分析", "Analyze it");
		assert.equal(run.status, "queued");
		assert.equal(store.getActiveRun(requirementId)?.id, run.id);
		assert.deepEqual(store.listRunEvents(run.id).map((event) => event.type), ["run_queued"]);

		assert.throws(
			() => store.createRun(requirementId, session.id, "stage", "场景"),
			(error: unknown) =>
				error instanceof RunInProgressError && error.runId === run.id,
		);

		const token = store.appendRunEvent(run.id, "token", { text: "hello" });
		assert.equal(token.seq, 2);
		assert.deepEqual(store.listRunEvents(run.id, 1)[0]?.payload, { text: "hello" });

		store.setRunStatus(run.id, "running");
		store.setRunStatus(run.id, "completed");
		assert.equal(store.getRun(run.id)?.status, "completed");
		assert.equal(store.getActiveRun(requirementId), undefined);
		assert.ok(store.listRunEvents(run.id).some((event) => event.type === "run_status"));

		const nextRun = store.createRun(requirementId, session.id, "stage", "场景");
		assert.equal(nextRun.status, "queued");
	} finally {
		store.close();
	}
});

test("recovers queued and running runs after a gateway restart", () => {
	const store = openStore(":memory:");
	try {
		const workspaceId = store.addWorkspace("/tmp/baize-recovery-test", "Recovery workspace");
		const queuedRequirementId = store.addRequirement(workspaceId, "Recover queued run");
		const queuedSession = store.createDesignSession(
			queuedRequirementId,
			"/tmp/queued-session.jsonl",
			"session-2",
		);
		const queued = store.createRun(queuedRequirementId, queuedSession.id, "stage", "分析");
		const runningRequirementId = store.addRequirement(workspaceId, "Recover running run");
		const runningSession = store.createDesignSession(
			runningRequirementId,
			"/tmp/running-session.jsonl",
			"session-3",
		);
		const running = store.createRun(runningRequirementId, runningSession.id, "stage", "场景");
		store.setRunStatus(running.id, "running");

		const recovered = store.recoverActiveRuns();
		assert.deepEqual(recovered, [queued.id, running.id]);
		for (const runId of [queued.id, running.id]) {
			assert.equal(store.getRun(runId)?.status, "failed");
			assert.equal(store.getRun(runId)?.error, "Gateway restarted before Run completed");
			assert.equal(
				store.getActiveRun(runId === queued.id ? queuedRequirementId : runningRequirementId),
				undefined,
			);
			assert.ok(store.listRunEvents(runId).some((event) => event.type === "run_recovered"));
		}
	} finally {
		store.close();
	}
});
