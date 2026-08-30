import type Database from "better-sqlite3";
import type { FixtureClock } from "../testing/deterministic-fixtures.js";

export class BusyWorkspaceError extends Error {
	constructor(
		readonly activeRuns: number,
		readonly activeClaims: number,
	) {
		super(`Workspace is busy: ${activeRuns} active Run(s), ${activeClaims} active Claim(s)`);
	}
}

export interface WorkspaceSummary {
	id: number;
	name: string;
	repoPath: string;
	createdAt: string;
	requirementCount: number;
	assetCount: number;
}

/**
 * workspace-store.ts — Store（存储域）子域：Workspace registry 与级联删除面。
 *
 * 删除 = 单事务内级联销毁其下全部治理事实（含 BusyWorkspaceError 前置检查，
 * 与删除同事务、无 TOCTOU 窗口）；对治理行的读/删是 Store 域唯一反向依赖。
 * 子域边界见 docs/adr/ADR-006-store-subdomain-boundary.md。
 */
export class WorkspaceStore {
	/** The workflow-id subquery scoping every workflow-dependent table to one workspace. */
	static readonly WORKFLOW_SCOPE =
		"workflow_id in (select id from workflows where requirement_id in (select id from requirements where workspace_id = ?))";

	static readonly REQUIREMENT_SCOPE =
		"requirement_id in (select id from requirements where workspace_id = ?)";

	// Reverse-topological deletion order for a workspace subtree (research ticket 07).
	// Child rows always die before the parents they reference; `defer_foreign_keys`
	// defers the remaining FK checks (self-referential revisions) to commit time
	// where every referencing row is already gone. The same list drives trigger
	// capture: any BEFORE DELETE trigger on these tables is suspended in-transaction.
	static readonly WORKSPACE_DELETE_ORDER: ReadonlyArray<{ table: string; where: string; params: readonly number[] }> = [
		{ table: "run_events", where: `run_id in (select id from runs where ${WorkspaceStore.WORKFLOW_SCOPE})`, params: [1] },
		{ table: "trace_links", where: `evidence_snapshot_id in (select id from evidence_snapshots where ${WorkspaceStore.WORKFLOW_SCOPE}) or artifact_revision_id in (select id from artifact_revisions where artifact_id in (select id from artifacts where requirement_id in (select id from requirements where workspace_id = ?)))`, params: [1, 1] },
		{ table: "workflow_events", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "command_receipts", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "outbox_jobs", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "evidence_snapshots", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "impact_profiles", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "legacy_imports", where: WorkspaceStore.REQUIREMENT_SCOPE, params: [1] },
		{ table: "design_packages", where: WorkspaceStore.REQUIREMENT_SCOPE, params: [1] },
		{ table: "approval_records", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "human_gates", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "human_directives", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "diagnostic_runs", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "critic_coverage_targets", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "findings", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "finding_threads", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "decisions", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "approval_packets", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "attempt_effects", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "governance_claims", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "runs", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "task_attempts", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "tasks", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "plan_revisions", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "workflow_incidents", where: WorkspaceStore.WORKFLOW_SCOPE, params: [1] },
		{ table: "workflows", where: WorkspaceStore.REQUIREMENT_SCOPE, params: [1] },
		{ table: "artifact_revisions", where: "artifact_id in (select id from artifacts where requirement_id in (select id from requirements where workspace_id = ?))", params: [1] },
		{ table: "artifacts", where: WorkspaceStore.REQUIREMENT_SCOPE, params: [1] },
		{ table: "design_sessions", where: WorkspaceStore.REQUIREMENT_SCOPE, params: [1] },
		{ table: "requirements", where: "workspace_id = ?", params: [1] },
		{ table: "reusable_asset_revisions", where: "reusable_asset_id in (select id from reusable_assets where workspace_id = ?)", params: [1] },
		{ table: "reusable_assets", where: "workspace_id = ?", params: [1] },
		{ table: "workspaces", where: "id = ?", params: [1] },
	];

	constructor(
		private readonly database: Database.Database,
		private readonly clock: FixtureClock,
	) {}

	createWorkspace(input: { repoPath: string; name: string }): number {
		const timestamp = this.clock.now().toISOString();
		return Number(
			this.database
				.prepare("insert into workspaces(repo_path, name, created_at) values (?, ?, ?)")
				.run(input.repoPath, input.name, timestamp).lastInsertRowid,
		);
	}

	workspaceExists(workspaceId: number): boolean {
		return this.database
			.prepare("select 1 from workspaces where id = ?")
			.get(workspaceId) !== undefined;
	}
	listWorkspaces(): readonly WorkspaceSummary[] {
		const rows = this.database
			.prepare(`
				select w.id, w.repo_path, w.name, w.created_at,
					(select count(*) from requirements r where r.workspace_id = w.id) as requirement_count,
					(select count(*) from reusable_assets a where a.workspace_id = w.id) as asset_count
				from workspaces w
				order by w.id
			`)
			.all() as Array<{ id: number; repo_path: string; name: string; created_at: string; requirement_count: number; asset_count: number }>;
		return rows.map((row) => ({
			id: row.id,
			name: row.name,
			repoPath: row.repo_path,
			createdAt: row.created_at,
			requirementCount: row.requirement_count,
			assetCount: row.asset_count,
		}));
	}

	/** BEFORE DELETE triggers on the deleted tables — suspended in-transaction and restored verbatim. */
	private deleteBlockingTriggers(): Array<{ name: string; sql: string }> {
		const tables = new Set(WorkspaceStore.WORKSPACE_DELETE_ORDER.map((entry) => entry.table));
		const triggers = this.database
			.prepare("select name, tbl_name, sql from sqlite_master where type = 'trigger'")
			.all() as Array<{ name: string; tbl_name: string; sql: string | null }>;
		return triggers
			.filter(
				(trigger) =>
					tables.has(trigger.tbl_name)
					&& /before\s+delete/i.test(trigger.sql ?? ""),
			)
			.map((trigger) => ({ name: trigger.name, sql: trigger.sql as string }));
	}

	deleteWorkspace(workspaceId: number): boolean {
		const blockers = this.deleteBlockingTriggers();
		const runner = this.database.transaction(() => {
			// Re-checked inside the write transaction: a concurrent delete of the same
			// workspace commits first, and this second delete must report false.
			if (!this.workspaceExists(workspaceId)) return false;
			const busy = this.database
				.prepare(
					`select
						(select count(*) from runs where ${WorkspaceStore.WORKFLOW_SCOPE} and status in ('queued', 'running')) as active_runs,
						(select count(*) from governance_claims where ${WorkspaceStore.WORKFLOW_SCOPE} and status = 'active') as active_claims`,
				)
				.get(workspaceId, workspaceId) as { active_runs: number; active_claims: number };
			if (busy.active_runs > 0 || busy.active_claims > 0) {
				throw new BusyWorkspaceError(busy.active_runs, busy.active_claims);
			}

			this.database.pragma("defer_foreign_keys = ON");
			// The governance kernel enforces row immutability through BEFORE DELETE triggers;
			// suspending them for this transaction is what makes the cascade possible at all.
			for (const trigger of blockers) {
				this.database.exec(`drop trigger "${trigger.name}"`);
			}

			for (const entry of WorkspaceStore.WORKSPACE_DELETE_ORDER) {
				const where = entry.where.replace(/\?/g, () => String(workspaceId));
				this.database.prepare(`delete from ${entry.table} where ${where}`).run();
			}

			const violations = this.database.pragma("foreign_key_check") as unknown[];
			if (violations.length > 0) {
				throw new Error(`Workspace cascade delete left foreign key violations: ${JSON.stringify(violations)}`);
			}

			for (const trigger of blockers) {
				this.database.exec(trigger.sql);
			}
			return true;
		});

		try {
			return runner.immediate();
		} catch (error) {
			// Any failure rolls back the whole transaction including the trigger DDL.
			throw error;
		}
	}
}