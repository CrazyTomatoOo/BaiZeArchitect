import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	createLegacyDatabase,
	addLegacyWorkspace,
	addLegacyRequirement,
	createLegacyDesignSession,
	getLegacyDesignSession,
	archiveLegacyDesignSession,
	createLegacyRun,
	setLegacyRunStatus,
	createLegacyArtifact,
	createLegacyArtifactRevision,
	createLegacyDecision,
	createLegacyFinding,
	captureLegacyEvidenceSnapshot,
	addLegacyRequirementGene,
	saveLegacyDesignPackage,
	type LegacyDatabase,
} from "./legacy-schema.js";
import type { LegacyFixtureManifest, FixtureRequirementSpec } from "./cutover-types.js";

/**
 * LegacyFixtureBuilder — generates real legacy SQLite databases and Pi Session
 * file trees in a temporary directory from a declarative manifest.
 *
 * The builder uses raw SQL against the legacy schema (extracted from the
 * deleted store.ts) to create actual schema and rows. Session files are
 * written as real JSONL files on disk.
 *
 * Nothing opaque is committed: the fixture lives in a temp dir that is cleaned
 * up by the caller.
 */
export interface BuiltFixture {
	tempDir: string;
	dbPath: string;
	sessionDir: string;
	legacy: LegacyDatabase;
	cleanup: () => void;
}

export function buildLegacyFixture(
	tempDir: string,
	manifest: LegacyFixtureManifest,
): BuiltFixture {
	const dbPath = join(tempDir, "legacy.db");
	const sessionDir = join(tempDir, "sessions");
	mkdirSync(sessionDir, { recursive: true });

	const legacy = createLegacyDatabase(dbPath);
	const db = legacy.db;
	const workspaceId = addLegacyWorkspace(
		db,
		manifest.workspace.repoPath,
		manifest.workspace.name,
	);

	manifest.requirements.forEach((spec, index) => {
		buildRequirement(db, workspaceId, spec, index, sessionDir);
	});

	return {
		tempDir,
		dbPath,
		sessionDir,
		legacy,
		cleanup: () => {
			legacy.close();
			rmSync(tempDir, { recursive: true, force: true });
		},
	};
}

function buildRequirement(
	db: LegacyDatabase["db"],
	workspaceId: number,
	spec: FixtureRequirementSpec,
	index: number,
	sessionDir: string,
): void {
	const reqId = addLegacyRequirement(
		db,
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
			createLegacyDesignSession(db, reqId, sessionFile, sessionId);
		} else if (spec.sessionFile === "invalid-json") {
			// Write invalid JSON to the session file
			writeFileSync(sessionFile, "{not valid json\n");
			createLegacyDesignSession(db, reqId, sessionFile, sessionId);
		} else {
			// Write valid JSONL session content
			writeFileSync(
				sessionFile,
				JSON.stringify({ role: "user", content: "test session" }) + "\n",
			);
			createLegacyDesignSession(db, reqId, sessionFile, sessionId);
		}
	}

	// Runs
	let firstRunId: number | null = null;
	const runIds: number[] = [];
	const session = getLegacyDesignSession(db, reqId);
	for (const runSpec of spec.runs) {
		if (!session) throw new Error(`cannot create run without session for req ${index}`);
		const runId = createLegacyRun(
			db,
			reqId,
			session.id,
			runSpec.kind,
			runSpec.prompt ?? "",
			session.session_file,
			null,
		);
		runIds.push(runId);
		if (firstRunId === null) firstRunId = runId;
		// Set status (createRun starts as queued, need to transition)
		if (runSpec.status !== "queued") {
			setLegacyRunStatus(db, runId, runSpec.status);
		}
	}

	// Artifacts + revisions
	for (const artifactSpec of spec.artifacts) {
		const artifactId = createLegacyArtifact(
			db,
			reqId,
			artifactSpec.kind,
			artifactSpec.title ?? "",
		);
		for (const revSpec of artifactSpec.revisions) {
			const runId = firstRunId ?? runIds[0] ?? 1;
			createLegacyArtifactRevision(
				db,
				artifactId,
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
			createLegacyDecision(
				db,
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
			createLegacyFinding(
				db,
				reqId,
				runId,
				findSpec.severity,
				findSpec.title,
				{},
			);
		}
	}

	// Evidence snapshot
	if (spec.hasEvidenceSnapshot) {
		const runId = firstRunId ?? runIds[0] ?? null;
		captureLegacyEvidenceSnapshot(db, reqId, {}, "abc123", runId);
	}

	// Requirement genes
	if (spec.requirementGenes) {
		for (const geneId of spec.requirementGenes) {
			addLegacyRequirementGene(db, reqId, geneId, "auto");
		}
	}

	// Design package (for archived requirements)
	if (spec.hasDesignPackage) {
		saveLegacyDesignPackage(
			db,
			reqId,
			workspaceId,
			spec.title,
			"legacy design content",
			"legacy adr",
			firstRunId,
			{},
			"approved",
		);
	}

	// Archive the design session if the requirement is archived
	if (spec.archived) {
		archiveLegacyDesignSession(db, reqId);
	}
}
