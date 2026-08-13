import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import type {
	CutoverReport,
	CutoverAnomaly,
	RequirementClassification,
	Classification,
	RemovedSurface,
	InputFingerprints,
} from "./cutover-types.js";

const POLICY_VERSION = "cutover-policy/v1";

/**
 * CutoverChecker — read-only preflight check.
 *
 * Computes DB/Session fingerprints, classifies Requirements, detects anomalies,
 * counts rows, computes per-table PK digests, and lists removed surfaces.
 * The check is read-only, repeatable, and never creates a Workflow, modifies
 * legacy data, or deletes legacy surfaces.
 *
 * The output CutoverReport is content-addressed (reportDigest = SHA-256 of
 * the canonical report body) and bound to input fingerprints + policy version.
 */
export function runCutoverCheck(
	dbPath: string,
	sessionDir: string,
): CutoverReport {
	const db = new Database(dbPath, { readonly: true, fileMustExist: true });
	try {
		const fingerprints = computeFingerprints(db, sessionDir);
		const classifications = classifyRequirements(db);
		const anomalies = detectAnomalies(db, sessionDir, classifications);
		const counts = countRows(db);
		const digests = computeTableDigests(db);
		const removedSurface = computeRemovedSurface();
		const blockingReasons = collectBlockingReasons(anomalies, classifications);
		const applyEligible = blockingReasons.length === 0;

		const report = {
			schemaVersion: "cutover-report/v1" as const,
			policyVersion: POLICY_VERSION,
			inputFingerprints: fingerprints,
			classifications,
			anomalies,
			counts,
			digests,
			removedSurface,
			applyEligible,
			blockingReasons,
			reportDigest: "",
		};
		return { ...report, reportDigest: computeReportDigest(report) };
	} finally {
		db.close();
	}
}

// ---------------------------------------------------------------------------
// Fingerprints
// ---------------------------------------------------------------------------

function computeFingerprints(
	db: Database.Database,
	sessionDir: string,
): InputFingerprints {
	const schemaSql = db
		.prepare(
			"select sql from sqlite_master where type='table' and name not like 'sqlite_%' order by name",
		)
		.all() as Array<{ sql: string }>;
	const databaseSchema = `sha256:${createHash("sha256")
		.update(schemaSql.map((r) => r.sql).join("\n"))
		.digest("hex")}`;

	const tableNames = (
		db
			.prepare(
				"select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name",
			)
			.all() as Array<{ name: string }>
	).map((r) => r.name);
	const contentParts: string[] = [];
	for (const table of tableNames) {
		const rows = db.prepare(`select * from "${table}" order by rowid`).all();
		contentParts.push(`${table}:${JSON.stringify(rows)}`);
	}
	const databaseContent = `sha256:${createHash("sha256")
		.update(contentParts.join("\n"))
		.digest("hex")}`;

	const sessionTree = computeSessionTreeDigest(sessionDir);

	return { databaseSchema, databaseContent, sessionTree };
}

function computeSessionTreeDigest(sessionDir: string): string {
	if (!existsSync(sessionDir)) return "sha256:";
	const entries: SessionEntry[] = [];
	collectSessionEntries(sessionDir, sessionDir, entries);
	entries.sort();
	const content = entries.map((e) => `${e.path}:${e.hash}`).join("\n");
	return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

interface SessionEntry {
	path: string;
	hash: string;
}

function collectSessionEntries(
	root: string,
	current: string,
	entries: SessionEntry[],
): void {
	const items = readdirSync(current);
	for (const item of items) {
		const fullPath = join(current, item);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			collectSessionEntries(root, fullPath, entries);
		} else {
			const content = readFileSync(fullPath);
			const relPath = relative(root, fullPath);
			entries.push({
				path: relPath,
				hash: createHash("sha256").update(content).digest("hex"),
			});
		}
	}
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function classifyRequirements(db: Database.Database): RequirementClassification[] {
	const requirements = db
		.prepare(
			"select id, title, source from requirements order by id",
		)
		.all() as Array<{ id: number; title: string; source: string }>;

	return requirements.map((req) => {
		const hasDesignPackage = (
			db
				.prepare("select count(*) as c from design_packages where requirement_id = ?")
				.get(req.id) as { c: number }
		).c > 0;

		const activeRun = (
			db
				.prepare(
					"select count(*) as c from runs where requirement_id = ? and status in ('queued','running')",
				)
				.get(req.id) as { c: number }
		).c;
		const hasActiveRun = activeRun > 0;

		const session = (
			db
				.prepare("select status from design_sessions where requirement_id = ?")
				.get(req.id) as { status: string } | undefined
		);
		const isArchived = session?.status === "archived";

		let classification: Classification;
		if (req.source === "manual-assets") {
			classification = "manual_asset_source";
		} else if (isArchived && hasDesignPackage) {
			classification = "legacy_archived";
		} else {
			classification = "pending_reentry";
		}

		return {
			requirementId: req.id,
			title: req.title,
			source: req.source,
			classification,
			hasDesignPackage,
			hasActiveRun,
		};
	});
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

function detectAnomalies(
	db: Database.Database,
	sessionDir: string,
	classifications: RequirementClassification[],
): CutoverAnomaly[] {
	const anomalies: CutoverAnomaly[] = [];

	// Active runs
	const activeRuns = db
		.prepare(
			"select id, requirement_id, status from runs where status in ('queued','running') order by id",
		)
		.all() as Array<{ id: number; requirement_id: number; status: string }>;
	for (const run of activeRuns) {
		anomalies.push({
			type: "active_run",
			requirementId: run.requirement_id,
			detail: `Run ${run.id} is ${run.status}`,
			blocking: true,
		});
	}

	// Missing attachments (session file referenced but not on disk)
	const sessions = db
		.prepare(
			"select requirement_id, session_file from design_sessions order by requirement_id",
		)
		.all() as Array<{ requirement_id: number; session_file: string }>;
	for (const session of sessions) {
		if (!existsSync(session.session_file)) {
			anomalies.push({
				type: "missing_attachment",
				requirementId: session.requirement_id,
				detail: `Session file not found: ${session.session_file}`,
				blocking: false,
			});
		} else {
			// Check for invalid JSON in session file
			const content = readFileSync(session.session_file, "utf8");
			for (const line of content.split("\n").filter(Boolean)) {
				try {
					JSON.parse(line);
				} catch {
					anomalies.push({
						type: "invalid_json",
						requirementId: session.requirement_id,
						detail: `Invalid JSON in session file: ${session.session_file}`,
						blocking: false,
					});
					break;
				}
			}
		}
	}

	// Invalid JSON in artifact revision content
	const badArtifacts = db
		.prepare(
			"select ar.id, ar.artifact_id, a.requirement_id, ar.content from artifact_revisions ar join artifacts a on a.id = ar.artifact_id order by ar.id",
		)
		.all() as Array<{ id: number; artifact_id: number; requirement_id: number; content: string }>;
	for (const ar of badArtifacts) {
		try {
			JSON.parse(ar.content);
		} catch {
			anomalies.push({
				type: "invalid_json",
				requirementId: ar.requirement_id,
				detail: `Invalid JSON in artifact revision ${ar.id}`,
				blocking: false,
			});
		}
	}

	// Mixed provenance: manual_asset_source with governance facts
	const manualReqs = classifications.filter(
		(c) => c.classification === "manual_asset_source",
	);
	for (const req of manualReqs) {
		const hasDesignPackage = req.hasDesignPackage;
		if (hasDesignPackage) {
			anomalies.push({
				type: "mixed_provenance",
				requirementId: req.requirementId,
				detail: `Manual asset source ${req.requirementId} has a design package`,
				blocking: true,
			});
		}
	}

	return anomalies;
}

// ---------------------------------------------------------------------------
// Row counts
// ---------------------------------------------------------------------------

function countRows(db: Database.Database): Record<string, number> {
	const tableNames = (
		db
			.prepare(
				"select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name",
			)
			.all() as Array<{ name: string }>
	).map((r) => r.name);
	const counts: Record<string, number> = {};
	for (const table of tableNames) {
		counts[table] = (
			db.prepare(`select count(*) as c from "${table}"`).get() as { c: number }
		).c;
	}
	return counts;
}

// ---------------------------------------------------------------------------
// Per-table PK digests
// ---------------------------------------------------------------------------

function computeTableDigests(db: Database.Database): Record<string, string> {
	const tableNames = (
		db
			.prepare(
				"select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name",
			)
			.all() as Array<{ name: string }>
	).map((r) => r.name);
	const digests: Record<string, string> = {};
	for (const table of tableNames) {
		const pkInfo = db.pragma(`table_info("${table}")`) as Array<{
			name: string;
			pk: number;
		}>;
		const pkColumns = pkInfo.filter((c) => c.pk > 0).map((c) => c.name);
		const orderBy = pkColumns.length > 0 ? pkColumns.join(", ") : "rowid";
		const rows = db
			.prepare(`select * from "${table}" order by ${orderBy}`)
			.all() as Array<Record<string, unknown>>;
		const rowDigests = rows.map((row) =>
			createHash("sha256").update(JSON.stringify(row)).digest("hex"),
		);
		digests[table] = `sha256:${createHash("sha256")
			.update(rowDigests.join("\n"))
			.digest("hex")}`;
	}
	return digests;
}

// ---------------------------------------------------------------------------
// Removed surface manifest
// ---------------------------------------------------------------------------

function computeRemovedSurface(): RemovedSurface {
	return {
		obsoleteTables: [
			"run_locks",
			"runs.session_id foreign key to design_sessions",
			"runs.parent_run_id manual chaining semantics",
			"runs.kind main/critic/manual-asset semantics",
			"mutable decisions.status and selected_option_id as write authority",
			"legacy approvals decision/actor/diff shape",
			"single-row evidence_snapshots requirement_id key",
			"legacy Artifact revision run_id provenance",
			"legacy DesignPackage approved status as archive authority",
		],
		removedHttpPaths: [
			"GET /api/requirements/:id/runs",
			"POST /api/requirements/:id/runs",
			"POST /api/runs/:id/steer",
			"POST /api/runs/:id/cancel",
			"POST /api/requirements/:id/archive",
			"GET /api/runs/stream",
			"GET /api/requirements/:id/evidence-snapshot",
			"GET /api/requirements/:id/design-package",
		],
		removedCodeSymbols: [
			"agent-runtime/agent.ts: reviewer AgentRole",
			"agent-runtime/gateway.ts: manual role Run handler",
			"agent-runtime/store.ts: RunInProgressError",
			"agent-runtime/store.ts: run_locks schema and DAO",
			"agent-runtime/store.ts: Store.ensureAssetRequirement",
			"agent-runtime/store.ts: Store.ensureManualAssetRun",
			"web/src/baize-requirement.ts: AgentRole and ROLES",
			"web/src/baize-run-rail.ts: legacy Run rail",
			".pi/skills/reviewer/SKILL.md: entire file",
		],
	};
}

// ---------------------------------------------------------------------------
// Blocking reasons
// ---------------------------------------------------------------------------

function collectBlockingReasons(
	anomalies: CutoverAnomaly[],
	classifications: RequirementClassification[],
): string[] {
	const reasons: string[] = [];
	for (const a of anomalies) {
		if (a.blocking) {
			reasons.push(`${a.type}: ${a.detail}`);
		}
	}
	for (const c of classifications) {
		if (c.hasActiveRun) {
			reasons.push(`active_run: Requirement ${c.requirementId} has active runs`);
		}
	}
	return [...new Set(reasons)];
}

// ---------------------------------------------------------------------------
// Report digest (content-addressed)
// ---------------------------------------------------------------------------

function computeReportDigest(
	report: CutoverReport,
): string {
	const body = { ...report };
	body.reportDigest = "";
	const canonical = JSON.stringify(body, Object.keys(body).sort());
	return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}
