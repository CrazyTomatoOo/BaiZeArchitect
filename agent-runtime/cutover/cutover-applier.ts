import Database from "better-sqlite3";
import type { CutoverReport } from "./cutover-types.js";
import { runCutoverCheck } from "./cutover-checker.js";
import type { WorkflowStore } from "../persistence/workflow-store.js";
import type { RequirementBaseline } from "../workflow/requirement.js";

export interface CutoverApplyResult {
	attestationDocumentId: number;
	reportDigest: string;
	importedRequirements: number;
	archivedWorkflows: number;
	pendingWorkflows: number;
	reusableAssetsImported: number;
}

/**
 * CutoverApplier — transforms a legacy SQLite database into governance DB rows.
 *
 * The apply is write-paused, idempotent, and crash-safe:
 * - Verifies the CutoverReport digest, input fingerprints, applyEligible, and no
 *   active legacy Runs before any business write.
 * - Stores the CutoverReport and a Migration Attestation as immutable snapshot
 *   documents so repeated apply returns the existing attestation.
 * - For legacy_archived items: creates an archived Workflow with a
 *   legacy_pre_policy DesignPackage (no fabricated ApprovalPacket or Approval).
 * - For pending_reentry items: creates a pending Workflow (baseline only, no old
 *   Run output imported as current governed Artifact).
 * - For manual_asset_source items: creates workspace-level Reusable Assets with
 *   source='migration' (no fake Requirement or Run).
 * - All origin legacy ids are kept as audit scalars (no FK), per cutover policy.
 */
export class CutoverApplier {
	constructor(
		private readonly store: WorkflowStore,
		private readonly crashInjector: { reach(point: string): void },
	) {}

	apply(legacyDbPath: string, sessionDir: string, report: CutoverReport): CutoverApplyResult {
		this.verifyReport(legacyDbPath, sessionDir, report);

		const existing = this.store.getMigrationAttestation();
		if (existing) {
			return {
				attestationDocumentId: existing.attestationDocumentId,
				reportDigest: existing.reportDigest,
				importedRequirements: 0,
				archivedWorkflows: 0,
				pendingWorkflows: 0,
				reusableAssetsImported: 0,
			};
		}

		const legacyDb = new Database(legacyDbPath, { readonly: true, fileMustExist: true });
		try {
			return this.store.applyCutover(legacyDb, report, this.crashInjector);
		} finally {
			legacyDb.close();
		}
	}

	private verifyReport(legacyDbPath: string, sessionDir: string, report: CutoverReport): void {
		if (!report.applyEligible) {
			throw new Error(`Cutover Report is not eligible: ${report.blockingReasons.join("; ")}`);
		}
		if (report.blockingReasons.length > 0) {
			throw new Error(`Cutover Report has blocking reasons: ${report.blockingReasons.join("; ")}`);
		}

		const recomputed = runCutoverCheck(legacyDbPath, sessionDir);
		if (recomputed.reportDigest !== report.reportDigest) {
			throw new Error("Cutover Report digest does not match recomputed digest");
		}
		if (recomputed.inputFingerprints.databaseSchema !== report.inputFingerprints.databaseSchema) {
			throw new Error("Cutover Report database schema fingerprint does not match");
		}
		if (recomputed.inputFingerprints.databaseContent !== report.inputFingerprints.databaseContent) {
			throw new Error("Cutover Report database content fingerprint does not match");
		}
		if (recomputed.inputFingerprints.sessionTree !== report.inputFingerprints.sessionTree) {
			throw new Error("Cutover Report session tree fingerprint does not match");
		}
		for (const classification of report.classifications) {
			if (classification.hasActiveRun) {
				throw new Error(`Requirement ${classification.requirementId} has an active legacy Run`);
			}
		}
	}
}
