export const RECOVERY_GOVERNANCE_MIGRATION = {
	version: 3,
	name: "recovery-governance",
	sql: `
alter table outbox_jobs add column delivery_failures integer not null default 0 check (delivery_failures >= 0);
alter table outbox_jobs add column next_attempt_at text;

create table workflow_incidents (
	id integer primary key,
	workflow_id integer not null references workflows(id) on delete restrict,
	incident_type text not null check (incident_type in ('outbox_exhausted', 'recoverable_reconciliation_failure', 'invariant_violation')),
	failure_code text not null check (failure_code in ('outbox_exhausted', 'reconciliation_failed', 'invariant_violation')),
	subject_type text not null check (subject_type in ('outbox_job', 'workflow', 'attempt', 'run')),
	subject_id integer,
	subject_version integer not null default 0 check (subject_version >= 0),
	status text not null check (status in ('open', 'resolved')),
	created_at text not null,
	resolved_at text,
	unique(workflow_id, incident_type, subject_id)
);

create trigger workflow_incident_content_immutable
before update of workflow_id, incident_type, failure_code, subject_type, subject_id, subject_version, created_at on workflow_incidents begin
	select raise(abort, 'Workflow Incident content is immutable');
end;

create trigger workflow_incident_immutable_delete
before delete on workflow_incidents begin
	select raise(abort, 'Workflow Incident is immutable');
end;
`,
} as const;
