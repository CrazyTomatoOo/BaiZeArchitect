import type Database from "better-sqlite3";

export interface DoctorFinding {
	check: string;
	status: "pass" | "fail";
	detail: string;
}

export interface DoctorReport {
	findings: DoctorFinding[];
	overall: "healthy" | "degraded";
}

export class WorkflowDoctor {
	constructor(private readonly database: Database.Database) {}

	diagnose(): DoctorReport {
		const findings: DoctorFinding[] = [];

		const quickCheck = this.database.pragma("quick_check", { simple: true }) as string;
		findings.push({
			check: "database_integrity",
			status: quickCheck === "ok" ? "pass" : "fail",
			detail: quickCheck,
		});

		const fkErrors = this.database.pragma("foreign_key_check") as unknown[];
		findings.push({
			check: "foreign_key_integrity",
			status: fkErrors.length === 0 ? "pass" : "fail",
			detail: fkErrors.length === 0 ? "ok" : JSON.stringify(fkErrors),
		});

		const mismatched = this.database
			.prepare(
				`select w.id, w.last_event_seq, coalesce(max(e.seq), 0) as actual_max
				from workflows w
				left join workflow_events e on e.workflow_id = w.id
				group by w.id
				having w.last_event_seq != actual_max`,
			)
			.all() as Array<{ id: number; last_event_seq: number; actual_max: number }>;
		findings.push({
			check: "workflow_last_event_seq",
			status: mismatched.length === 0 ? "pass" : "fail",
			detail: mismatched.length === 0 ? "all workflows match" : `${mismatched.length} mismatched`,
		});

		const pendingArchived = this.database
			.prepare(
				`select count(*) as count
				from outbox_jobs j
				join workflows w on w.id = j.workflow_id
				where w.state = 'archived' and j.delivered_at is null`,
			)
			.get() as { count: number };
		findings.push({
			check: "archived_workflow_outbox_clean",
			status: pendingArchived.count === 0 ? "pass" : "fail",
			detail: pendingArchived.count === 0 ? "no pending outbox for archived workflows" : `${pendingArchived.count} pending`,
		});

		const gaps = this.database
			.prepare(
				`select workflow_id, seq
				from workflow_events e
				where seq > 1 and not exists (
					select 1 from workflow_events e2
					where e2.workflow_id = e.workflow_id and e2.seq = e.seq - 1
				)`,
			)
			.all() as Array<{ workflow_id: number; seq: number }>;
		findings.push({
			check: "workflow_event_sequence_contiguous",
			status: gaps.length === 0 ? "pass" : "fail",
			detail: gaps.length === 0 ? "all sequences contiguous" : `${gaps.length} gaps`,
		});

		return {
			findings,
			overall: findings.every((f) => f.status === "pass") ? "healthy" : "degraded",
		};
	}
}
