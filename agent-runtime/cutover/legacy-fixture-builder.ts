import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../store.js";
import { openStore } from "../store.js";
import type { LegacyFixtureManifest, FixtureRequirementSpec } from "./cutover-types.js";

/**
 * LegacyFixtureBuilder — generates real legacy SQLite databases and Pi Session
 * file trees in a temporary directory from a declarative manifest.
 *
 * The builder uses the real Store class to create actual schema and rows.
 * Session files are written as real JSONL files on disk.
 *
 * Nothing opaque is committed: the fixture lives in a temp dir that is cleaned
 * up by the caller.
 */
export interface BuiltFixture {
	tempDir: string;
	dbPath: string;
	sessionDir: string;
	store: Store;
	cleanup: () => void;
}

export function buildLegacyFixture(
	tempDir: string,
	manifest: LegacyFixtureManifest,
): BuiltFixture {
	const dbPath = join(tempDir, "legacy.db");
	const sessionDir = join(tempDir, "sessions");
	mkdirSync(sessionDir, { recursive: true });

	const store = openStore(dbPath);
	const workspaceId = store.addWorkspace(
		manifest.workspace.repoPath,
		manifest.workspace.name,
	);

	manifest.requirements.forEach((spec, index) => {
		buildRequirement(store, workspaceId, spec, index, sessionDir);
	});

	return {
		tempDir,
		dbPath,
		sessionDir,
		store,
		cleanup: () => {
			store.close();
			rmSync(tempDir, { recursive: true, force: true });
		},
	};
}

function buildRequirement(
	store: Store,
	workspaceId: number,
	spec: FixtureRequirementSpec,
	index: number,
	sessionDir: string,
): void {
	const reqId = store.addRequirement(
		workspaceId,
		spec.title,
		spec.description ?? "",
		spec.source ?? "",
	);

	// Design session + session file
	if (spec.sessionFile !== null) {
		const sessionFile = join(sessionDir, `req-${index}-session.jsonl`);
		const sessionId = `session-${index}`;

		if (spec.sessionFile === "missing-file") {
			// Reference a session file path but don't write it
			store.createDesignSession(reqId, sessionFile, sessionId);
		} else if (spec.sessionFile === "invalid-json") {
			// Write invalid JSON to the session file
			writeFileSync(sessionFile, "{not valid json\n");
			store.createDesignSession(reqId, sessionFile, sessionId);
		} else {
			// Write valid JSONL session content
			writeFileSync(
				sessionFile,
				JSON.stringify({ role: "user", content: "test session" }) + "\n",
			);
			store.createDesignSession(reqId, sessionFile, sessionId);
		}
	}

	// Runs
	let firstRunId: number | null = null;
	const runIds: number[] = [];
	const session = store.getDesignSession(reqId);
	for (const runSpec of spec.runs) {
		if (!session) throw new Error(`cannot create run without session for req ${index}`);
		const run = store.createRun(
			reqId,
			session.id,
			runSpec.kind,
			runSpec.prompt ?? "",
			session.session_file,
		);
		runIds.push(run.id);
		if (firstRunId === null) firstRunId = run.id;
		// Set status (createRun starts as queued, need to transition)
		if (runSpec.status !== "queued") {
			store.setRunStatus(run.id, runSpec.status);
		}
	}

	// Artifacts + revisions
	for (const artifactSpec of spec.artifacts) {
		const artifact = store.createArtifact(
			reqId,
			artifactSpec.kind,
			artifactSpec.title ?? "",
		);
		for (const revSpec of artifactSpec.revisions) {
			const runId = firstRunId ?? runIds[0] ?? 1;
			store.createArtifactRevision(
				artifact.id,
				runId,
				revSpec.content,
				revSpec.status,
			);
		}
	}

	// Decisions
	if (spec.decisions) {
		for (const decSpec of spec.decisions) {
			const runId = firstRunId ?? runIds[0] ?? 1;
			store.createDecision(
				reqId,
				runId,
				decSpec.title,
				"",
				decSpec.severity ?? "major",
			);
		}
	}

	// Findings
	if (spec.findings) {
		for (const findSpec of spec.findings) {
			const runId = firstRunId ?? runIds[0] ?? 1;
			store.createFinding(
				reqId,
				runId,
				findSpec.severity,
				findSpec.title,
			);
		}
	}

	// Evidence snapshot
	if (spec.hasEvidenceSnapshot) {
		const runId = firstRunId ?? runIds[0] ?? null;
		store.captureEvidenceSnapshot(reqId, {}, "abc123", runId);
	}

	// Requirement genes
	if (spec.requirementGenes) {
		for (const geneId of spec.requirementGenes) {
			store.addRequirementGene(reqId, geneId, "auto");
		}
	}

	// Design package (for archived requirements)
	if (spec.hasDesignPackage) {
		store.saveDesignPackage(
			reqId,
			workspaceId,
			spec.title,
			"legacy design content",
			"legacy adr",
			firstRunId ?? null,
			{},
			"approved",
		);
	}

	// Archive the design session if the requirement is archived
	if (spec.archived) {
		store.archiveDesignSession(reqId);
	}
}
