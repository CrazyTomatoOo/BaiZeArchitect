import assert from "node:assert/strict";
import test from "node:test";
import { openStore, RunInProgressError } from "./store.js";

test("persists design sessions, run events, and requirement run locks", () => {
	const store = openStore(":memory:");
	try {
		const workspaceId = store.addWorkspace(
			"/tmp/baize-store-test",
			"Test workspace",
		);
		const requirementId = store.addRequirement(workspaceId, "Design a feature");
		const session = store.createDesignSession(
			requirementId,
			"/tmp/baize-sessions/session.jsonl",
			"session-1",
		);

		assert.equal(session.requirement_id, requirementId);
		assert.equal(session.status, "active");
		assert.deepEqual(store.getDesignSession(requirementId), session);

		const run = store.createRun(
			requirementId,
			session.id,
			"stage",
			"分析",
			"Analyze it",
		);
		assert.equal(run.status, "queued");
		assert.equal(store.getActiveRun(requirementId)?.id, run.id);
		assert.deepEqual(
			store.listRunEvents(run.id).map((event) => event.type),
			["run_queued"],
		);

		assert.throws(
			() => store.createRun(requirementId, session.id, "stage", "场景"),
			(error: unknown) =>
				error instanceof RunInProgressError && error.runId === run.id,
		);

		const token = store.appendRunEvent(run.id, "token", { text: "hello" });
		assert.equal(token.seq, 2);
		assert.deepEqual(store.listRunEvents(run.id, 1)[0]?.payload, {
			text: "hello",
		});

		store.setRunStatus(run.id, "running");
		store.setRunStatus(run.id, "completed");
		assert.equal(store.getRun(run.id)?.status, "completed");
		assert.equal(store.getActiveRun(requirementId), undefined);
		assert.ok(
			store.listRunEvents(run.id).some((event) => event.type === "run_status"),
		);

		const nextRun = store.createRun(requirementId, session.id, "stage", "场景");
		assert.equal(nextRun.status, "queued");
	} finally {
		store.close();
	}
});

test("stores artifact revisions, decisions, evidence, and approvals as domain entities", () => {
	const store = openStore(":memory:");
	try {
		const workspaceId = store.addWorkspace("/tmp/baize-domain-test", "Domain workspace");
		const requirementId = store.addRequirement(workspaceId, "Model the domain");
		const session = store.createDesignSession(requirementId, "/tmp/domain-session.jsonl", "domain-session");
		const run = store.createRun(requirementId, session.id, "stage", "分析");
		store.setRunStatus(run.id, "running");

		const artifact = store.createArtifact(requirementId, "design", "Checkout design");
		const firstRevision = store.createArtifactRevision(
			artifact.id,
			run.id,
			{ version: 1, decision: "redirect" },
			"pending",
		);
		const secondRevision = store.createArtifactRevision(
			artifact.id,
			run.id,
			{ version: 2, decision: "inline" },
			"draft",
			firstRevision.id,
		);
		const transactionalRevision = store.transaction(() =>
			store.createArtifactRevision(artifact.id, run.id, { version: 3 }),
		);
		assert.equal(transactionalRevision.revision_no, 3);
		assert.equal(secondRevision.revision_no, 2);
		assert.equal(secondRevision.fork_from_revision_id, firstRevision.id);
		assert.deepEqual(store.listArtifactRevisions(artifact.id)[1]?.content, {
			version: 2,
			decision: "inline",
		});

		const decision = store.createDecision(
			requirementId,
			run.id,
			"Choose checkout flow",
			"Should checkout redirect or stay inline?",
		);
		const option = store.addDecisionOption(decision.id, "Inline", "Keep the user in checkout");
		assert.equal(store.selectDecisionOption(decision.id, option.id).status, "accepted");
		assert.equal(store.getDecision(decision.id)?.selected_option_id, option.id);

		const finding = store.createFinding(
			requirementId,
			run.id,
			"high",
			"Missing failure path",
			{ filePath: "src/checkout.ts", line: 12 },
		);
		assert.deepEqual(finding.content, { filePath: "src/checkout.ts", line: 12 });

		store.captureEvidenceSnapshot(requirementId, { nodes: ["checkout"] }, "abc123", run.id);
		const trace = store.createTraceLink(
			requirementId,
			run.id,
			"artifact_revision",
			secondRevision.id,
			requirementId,
			"src/checkout.ts",
			"submitOrder",
			12,
			18,
			{ nodeId: "checkout.submit" },
		);
		assert.equal(trace.source_id, secondRevision.id);
		assert.deepEqual(store.listTraceLinks(requirementId)[0]?.node, { nodeId: "checkout.submit" });

		const approval = store.createApproval(
			requirementId,
			run.id,
			"artifact_revision",
			secondRevision.id,
			"approved",
			"reviewer",
			"Matches the evidence",
			{ previousRevision: firstRevision.id },
		);
		assert.deepEqual(approval.diff, { previousRevision: firstRevision.id });

		store.saveDesignPackage(
			requirementId,
			workspaceId,
			"Checkout package",
			"# Checkout",
			"ADR-1",
			run.id,
			{ artifactRevisionId: secondRevision.id, evidenceRunId: run.id },
			"approved",
		);
		const pkg = store.getDesignPackageByReq(requirementId) as { run_id: number; snapshot: string; status: string };
		assert.equal(pkg.run_id, run.id);
		assert.equal(pkg.status, "approved");
		assert.deepEqual(JSON.parse(pkg.snapshot), { artifactRevisionId: secondRevision.id, evidenceRunId: run.id });
		assert.ok(store.counts().artifact_revisions >= 2);
		store.deleteWorkspace(workspaceId);
		assert.equal(store.counts().artifacts, 0);
		assert.equal(store.counts().artifact_revisions, 0);
		assert.equal(store.counts().decisions, 0);
		assert.equal(store.counts().findings, 0);
		assert.equal(store.counts().approvals, 0);
		assert.equal(store.counts().trace_links, 0);
	} finally {
		store.close();
	}
});

test("recovers queued and running runs after a gateway restart", () => {
	const store = openStore(":memory:");
	try {
		const workspaceId = store.addWorkspace(
			"/tmp/baize-recovery-test",
			"Recovery workspace",
		);
		const queuedRequirementId = store.addRequirement(
			workspaceId,
			"Recover queued run",
		);
		const queuedSession = store.createDesignSession(
			queuedRequirementId,
			"/tmp/queued-session.jsonl",
			"session-2",
		);
		const queued = store.createRun(
			queuedRequirementId,
			queuedSession.id,
			"stage",
			"分析",
		);
		const runningRequirementId = store.addRequirement(
			workspaceId,
			"Recover running run",
		);
		const runningSession = store.createDesignSession(
			runningRequirementId,
			"/tmp/running-session.jsonl",
			"session-3",
		);
		const running = store.createRun(
			runningRequirementId,
			runningSession.id,
			"stage",
			"场景",
		);
		store.setRunStatus(running.id, "running");

		const recovered = store.recoverActiveRuns();
		assert.deepEqual(recovered, [queued.id, running.id]);
		for (const runId of [queued.id, running.id]) {
			assert.equal(store.getRun(runId)?.status, "failed");
			assert.equal(
				store.getRun(runId)?.error,
				"Gateway restarted before Run completed",
			);
			assert.equal(
				store.getActiveRun(
					runId === queued.id ? queuedRequirementId : runningRequirementId,
				),
				undefined,
			);
			assert.ok(
				store
					.listRunEvents(runId)
					.some((event) => event.type === "run_recovered"),
			);
		}
	} finally {
		store.close();
	}
});
