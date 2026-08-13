import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildLegacyFixture } from "./cutover/legacy-fixture-builder.js";
import { runCutoverCheck } from "./cutover/cutover-checker.js";
import type { LegacyFixtureManifest, CutoverReport } from "./cutover/cutover-types.js";

function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `cutover-${prefix}-`));
}

function runFixture(manifest: LegacyFixtureManifest): {
	report: CutoverReport;
	cleanup: () => void;
} {
	const dir = tempDir(manifest.name);
	const fixture = buildLegacyFixture(dir, manifest);
	const report = runCutoverCheck(fixture.dbPath, fixture.sessionDir);
	return { report, cleanup: fixture.cleanup };
}

// ---------------------------------------------------------------------------
// Fixture 1: empty database
// ---------------------------------------------------------------------------

const EMPTY_MANIFEST: LegacyFixtureManifest = {
	name: "empty",
	description: "Empty database with no requirements",
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

test("fixture: empty database — no requirements, eligible for apply", () => {
	const { report, cleanup } = runFixture(EMPTY_MANIFEST);
	try {
		assert.strictEqual(report.classifications.length, 0);
		assert.strictEqual(report.counts.requirements, 0);
		assert.strictEqual(report.applyEligible, true);
		assert.deepStrictEqual(report.blockingReasons, []);
		assert.ok(report.reportDigest.startsWith("sha256:"));
		assert.strictEqual(report.schemaVersion, "cutover-report/v1");
		assert.strictEqual(report.policyVersion, "cutover-policy/v1");
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Fixture 2: complete legacy archive
// ---------------------------------------------------------------------------

const ARCHIVE_MANIFEST: LegacyFixtureManifest = {
	name: "complete-archive",
	description: "Archived requirement with design package",
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

test("fixture: complete legacy archive — classified as legacy_archived, eligible", () => {
	const { report, cleanup } = runFixture(ARCHIVE_MANIFEST);
	try {
		assert.strictEqual(report.classifications.length, 1);
		assert.strictEqual(report.classifications[0].classification, "legacy_archived");
		assert.strictEqual(report.classifications[0].hasDesignPackage, true);
		assert.strictEqual(report.classifications[0].hasActiveRun, false);
		assert.strictEqual(report.counts.requirements, 1);
		assert.strictEqual(report.counts.design_packages, 1);
		assert.strictEqual(report.applyEligible, true);
		assert.deepStrictEqual(report.blockingReasons, []);
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Fixture 3: missing attachment
// ---------------------------------------------------------------------------

const MISSING_ATTACHMENT_MANIFEST: LegacyFixtureManifest = {
	name: "missing-attachment",
	description: "Session file referenced but not on disk",
	workspace: { repoPath: "/repo", name: "test" },
	requirements: [
		{
			title: "Missing Attachment",
			archived: false,
			hasDesignPackage: false,
			sessionFile: "missing-file",
			runs: [{ kind: "main", status: "completed" }],
			artifacts: [],
		},
	],
	expected: {
		classifications: [{ requirementIndex: 0, classification: "pending_reentry" }],
		anomalies: [{ type: "missing_attachment", requirementIndex: 0, blocking: false }],
		counts: { requirements: 1 },
		applyEligible: true,
		blockingReasons: [],
	},
};

test("fixture: missing attachment — non-blocking anomaly, eligible", () => {
	const { report, cleanup } = runFixture(MISSING_ATTACHMENT_MANIFEST);
	try {
		const missingAnomalies = report.anomalies.filter((a) => a.type === "missing_attachment");
		assert.ok(missingAnomalies.length > 0, "should have missing_attachment anomaly");
		assert.strictEqual(missingAnomalies[0].blocking, false);
		assert.strictEqual(report.applyEligible, true);
		assert.deepStrictEqual(report.blockingReasons, []);
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Fixture 4: pending re-entry
// ---------------------------------------------------------------------------

const PENDING_REENTRY_MANIFEST: LegacyFixtureManifest = {
	name: "pending-reentry",
	description: "Normal unarchived requirement",
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

test("fixture: pending re-entry — classified as pending_reentry, eligible", () => {
	const { report, cleanup } = runFixture(PENDING_REENTRY_MANIFEST);
	try {
		assert.strictEqual(report.classifications[0].classification, "pending_reentry");
		assert.strictEqual(report.classifications[0].hasDesignPackage, false);
		assert.strictEqual(report.applyEligible, true);
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Fixture 5: manual asset source
// ---------------------------------------------------------------------------

const MANUAL_ASSET_MANIFEST: LegacyFixtureManifest = {
	name: "manual-asset",
	description: "Manual asset source requirement",
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
					revisions: [{ content: { name: "scenario 1" }, status: "approved" }],
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

test("fixture: manual asset source — classified as manual_asset_source, eligible", () => {
	const { report, cleanup } = runFixture(MANUAL_ASSET_MANIFEST);
	try {
		assert.strictEqual(report.classifications[0].classification, "manual_asset_source");
		assert.strictEqual(report.applyEligible, true);
		assert.deepStrictEqual(report.blockingReasons, []);
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Fixture 6: three-class mixed
// ---------------------------------------------------------------------------

const MIXED_MANIFEST: LegacyFixtureManifest = {
	name: "three-class-mixed",
	description: "Archive + pending + manual in one database",
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
			artifacts: [],
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

test("fixture: three-class mixed — all three classifications present, eligible", () => {
	const { report, cleanup } = runFixture(MIXED_MANIFEST);
	try {
		assert.strictEqual(report.classifications.length, 3);
		assert.strictEqual(report.classifications[0].classification, "legacy_archived");
		assert.strictEqual(report.classifications[1].classification, "pending_reentry");
		assert.strictEqual(report.classifications[2].classification, "manual_asset_source");
		assert.strictEqual(report.counts.requirements, 3);
		assert.strictEqual(report.applyEligible, true);
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Fixture 7: active legacy run blocks cutover
// ---------------------------------------------------------------------------

const ACTIVE_RUN_MANIFEST: LegacyFixtureManifest = {
	name: "active-run",
	description: "Queued/running Run blocks cutover",
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

test("fixture: active legacy run — blocks cutover, no override", () => {
	const { report, cleanup } = runFixture(ACTIVE_RUN_MANIFEST);
	try {
		const activeRunAnomalies = report.anomalies.filter((a) => a.type === "active_run");
		assert.ok(activeRunAnomalies.length > 0, "should have active_run anomaly");
		assert.strictEqual(activeRunAnomalies[0].blocking, true);
		assert.strictEqual(report.classifications[0].hasActiveRun, true);
		assert.strictEqual(report.applyEligible, false);
		assert.ok(report.blockingReasons.length > 0);
		assert.ok(report.blockingReasons.some((r) => r.includes("active_run")));
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Fixture 8: DB/Session fingerprint mismatch
// ---------------------------------------------------------------------------

const FINGERPRINT_MISMATCH_MANIFEST: LegacyFixtureManifest = {
	name: "fingerprint-mismatch",
	description: "DB refers to a session file that does not match the session tree",
	workspace: { repoPath: "/repo", name: "test" },
	requirements: [
		{
			title: "Mismatched Session",
			archived: false,
			hasDesignPackage: false,
			sessionFile: "missing-file",
			runs: [{ kind: "main", status: "completed" }],
			artifacts: [],
		},
	],
	expected: {
		classifications: [{ requirementIndex: 0, classification: "pending_reentry" }],
		anomalies: [{ type: "fingerprint_mismatch", requirementIndex: 0, blocking: false }],
		counts: { requirements: 1 },
		applyEligible: true,
		blockingReasons: [],
	},
};

test("fixture: DB/Session fingerprint mismatch — missing_attachment recorded, not silently dropped", () => {
	const dir = tempDir("fingerprint-mismatch");
	const fixture = buildLegacyFixture(dir, FINGERPRINT_MISMATCH_MANIFEST);
	try {
		const report1 = runCutoverCheck(fixture.dbPath, fixture.sessionDir);
		// The session file is missing → missing_attachment anomaly
		const missing = report1.anomalies.filter((a) => a.type === "missing_attachment");
		assert.ok(missing.length > 0, "missing_attachment must be recorded");

		// Running again against the SAME inputs yields the SAME fingerprint and digest
		const report2 = runCutoverCheck(fixture.dbPath, fixture.sessionDir);
		assert.strictEqual(report1.reportDigest, report2.reportDigest);
		assert.deepStrictEqual(report1.inputFingerprints, report2.inputFingerprints);
	} finally {
		fixture.cleanup();
	}
});

// ---------------------------------------------------------------------------
// Fixture 9: invalid legacy JSON
// ---------------------------------------------------------------------------

const INVALID_JSON_MANIFEST: LegacyFixtureManifest = {
	name: "invalid-json",
	description: "Invalid JSON in session file",
	workspace: { repoPath: "/repo", name: "test" },
	requirements: [
		{
			title: "Invalid JSON Session",
			archived: false,
			hasDesignPackage: false,
			sessionFile: "invalid-json",
			runs: [{ kind: "main", status: "completed" }],
			artifacts: [],
		},
	],
	expected: {
		classifications: [{ requirementIndex: 0, classification: "pending_reentry" }],
		anomalies: [{ type: "invalid_json", requirementIndex: 0, blocking: false }],
		counts: { requirements: 1 },
		applyEligible: true,
		blockingReasons: [],
	},
};

test("fixture: invalid legacy JSON — recorded as anomaly, not silently dropped", () => {
	const { report, cleanup } = runFixture(INVALID_JSON_MANIFEST);
	try {
		const invalidJsonAnomalies = report.anomalies.filter((a) => a.type === "invalid_json");
		assert.ok(invalidJsonAnomalies.length > 0, "invalid_json anomaly must be recorded");
		assert.strictEqual(invalidJsonAnomalies[0].blocking, false);
		// Non-blocking, so cutover is still eligible
		assert.strictEqual(report.applyEligible, true);
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Fixture 10: repeated apply (check is idempotent/repeatable)
// ---------------------------------------------------------------------------

const REPEATED_APPLY_MANIFEST: LegacyFixtureManifest = {
	name: "repeated-apply",
	description: "Check is idempotent — same inputs always yield same report",
	workspace: { repoPath: "/repo", name: "test" },
	requirements: [
		{
			title: "Repeatable",
			archived: false,
			hasDesignPackage: false,
			sessionFile: "valid",
			runs: [{ kind: "main", status: "completed" }],
			artifacts: [],
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

test("fixture: repeated apply — check is read-only and idempotent", () => {
	const dir = tempDir("repeated-apply");
	const fixture = buildLegacyFixture(dir, REPEATED_APPLY_MANIFEST);
	try {
		const report1 = runCutoverCheck(fixture.dbPath, fixture.sessionDir);
		const report2 = runCutoverCheck(fixture.dbPath, fixture.sessionDir);
		const report3 = runCutoverCheck(fixture.dbPath, fixture.sessionDir);

		// All three reports have identical digests and fingerprints
		assert.strictEqual(report1.reportDigest, report2.reportDigest);
		assert.strictEqual(report2.reportDigest, report3.reportDigest);
		assert.deepStrictEqual(report1.inputFingerprints, report2.inputFingerprints);
		assert.deepStrictEqual(report2.inputFingerprints, report3.inputFingerprints);

		// The check did not modify the legacy database (read-only)
		// Verify by checking that counts are stable
		assert.strictEqual(report1.counts.requirements, report2.counts.requirements);
		assert.strictEqual(report2.counts.requirements, report3.counts.requirements);
	} finally {
		fixture.cleanup();
	}
});

// ---------------------------------------------------------------------------
// Cross-cutting: removed surface manifest is always present
// ---------------------------------------------------------------------------

test("cutover report always includes removed surface manifest", () => {
	const { report, cleanup } = runFixture(EMPTY_MANIFEST);
	try {
		assert.ok(report.removedSurface.obsoleteTables.length > 0);
		assert.ok(report.removedSurface.removedHttpPaths.length > 0);
		assert.ok(report.removedSurface.removedCodeSymbols.length > 0);
		// Verify specific entries from cutover policy
		assert.ok(report.removedSurface.obsoleteTables.includes("run_locks"));
		assert.ok(
			report.removedSurface.removedHttpPaths.includes("GET /api/runs/stream"),
		);
	} finally {
		cleanup();
	}
});

// ---------------------------------------------------------------------------
// Cross-cutting: report is content-addressed
// ---------------------------------------------------------------------------

test("cutover report is content-addressed — different inputs yield different digests", () => {
	const dir1 = tempDir("content-1");
	const dir2 = tempDir("content-2");
	const fixture1 = buildLegacyFixture(dir1, EMPTY_MANIFEST);
	const fixture2 = buildLegacyFixture(dir2, PENDING_REENTRY_MANIFEST);
	try {
		const report1 = runCutoverCheck(fixture1.dbPath, fixture1.sessionDir);
		const report2 = runCutoverCheck(fixture2.dbPath, fixture2.sessionDir);
		assert.notStrictEqual(report1.reportDigest, report2.reportDigest);
		assert.notDeepStrictEqual(
			report1.inputFingerprints.databaseContent,
			report2.inputFingerprints.databaseContent,
		);
	} finally {
		fixture1.cleanup();
		fixture2.cleanup();
	}
});

// ---------------------------------------------------------------------------
// Cross-cutting: per-table digests are present and stable
// ---------------------------------------------------------------------------

test("cutover report includes per-table PK digests, stable across repeated checks", () => {
	const dir = tempDir("digest");
	const fixture = buildLegacyFixture(dir, ARCHIVE_MANIFEST);
	try {
		const report1 = runCutoverCheck(fixture.dbPath, fixture.sessionDir);
		assert.ok(Object.keys(report1.digests).length > 0);
		assert.ok(report1.digests.requirements?.startsWith("sha256:"));
		assert.ok(report1.digests.workspaces?.startsWith("sha256:"));
		// Running the check again against the SAME database yields identical digests
		const report2 = runCutoverCheck(fixture.dbPath, fixture.sessionDir);
		assert.deepStrictEqual(report1.digests, report2.digests);
	} finally {
		fixture.cleanup();
	}
});
