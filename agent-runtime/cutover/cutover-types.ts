import type { LegacyArtifactKind as ArtifactKind } from "./legacy-schema.js";

/**
 * Cutover preflight types — declarative fixture manifests, read-only check
 * inputs, and the content-addressed CutoverReport snapshot document.
 *
 * The checker is read-only and repeatable: it never creates a Workflow,
 * modifies legacy data, or deletes legacy surfaces.
 */

// ---------------------------------------------------------------------------
// Fixture manifest (declarative input to LegacyFixtureBuilder)
// ---------------------------------------------------------------------------

export interface FixtureRunSpec {
	kind: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	prompt?: string;
}

export interface FixtureArtifactSpec {
	kind: ArtifactKind;
	title?: string;
	revisions: Array<{
		content: unknown;
		status: "draft" | "pending" | "approved" | "rejected";
	}>;
}

export interface FixtureDecisionSpec {
	title: string;
	severity?: string;
	status?: "open" | "accepted" | "rejected" | "deferred";
}

export interface FixtureFindingSpec {
	severity: string;
	title: string;
}

export interface FixtureRequirementSpec {
	title: string;
	description?: string;
	source?: string; // "manual-assets" for manual asset source
	archived: boolean;
	hasDesignPackage: boolean;
	sessionFile: "valid" | "invalid-json" | "missing-file" | null;
	runs: FixtureRunSpec[];
	artifacts: FixtureArtifactSpec[];
	decisions?: FixtureDecisionSpec[];
	findings?: FixtureFindingSpec[];
	hasEvidenceSnapshot?: boolean;
	requirementGenes?: string[];
}

export interface LegacyFixtureManifest {
	name: string;
	description: string;
	workspace: { repoPath: string; name: string };
	requirements: FixtureRequirementSpec[];
	expected: {
		classifications: Array<{
			requirementIndex: number;
			classification: Classification;
		}>;
		anomalies: Array<{
			type: AnomalyType;
			requirementIndex?: number;
			blocking: boolean;
		}>;
		counts: Partial<Record<string, number>>;
		applyEligible: boolean;
		blockingReasons: string[];
	};
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type Classification = "legacy_archived" | "pending_reentry" | "manual_asset_source";

// ---------------------------------------------------------------------------
// Anomalies
// ---------------------------------------------------------------------------

export type AnomalyType =
	| "missing_attachment"
	| "invalid_json"
	| "fingerprint_mismatch"
	| "active_run"
	| "mixed_provenance";

export interface CutoverAnomaly {
	type: AnomalyType;
	requirementId: number | null;
	detail: string;
	blocking: boolean;
}

// ---------------------------------------------------------------------------
// Removed surface manifest
// ---------------------------------------------------------------------------

export interface RemovedSurface {
	obsoleteTables: string[];
	removedHttpPaths: string[];
	removedCodeSymbols: string[];
}

// ---------------------------------------------------------------------------
// Input fingerprints
// ---------------------------------------------------------------------------

export interface InputFingerprints {
	databaseSchema: string;
	databaseContent: string;
	sessionTree: string;
}

// ---------------------------------------------------------------------------
// Per-requirement classification record
// ---------------------------------------------------------------------------

export interface RequirementClassification {
	requirementId: number;
	title: string;
	source: string;
	classification: Classification;
	hasDesignPackage: boolean;
	hasActiveRun: boolean;
}

// ---------------------------------------------------------------------------
// CutoverReport (content-addressed, immutable snapshot document)
// ---------------------------------------------------------------------------

export interface CutoverReport {
	schemaVersion: "cutover-report/v1";
	policyVersion: string;
	inputFingerprints: InputFingerprints;
	classifications: RequirementClassification[];
	anomalies: CutoverAnomaly[];
	counts: Record<string, number>;
	digests: Record<string, string>;
	removedSurface: RemovedSurface;
	applyEligible: boolean;
	blockingReasons: string[];
	reportDigest: string;
}
