export const CRITIC_GOVERNANCE_MIGRATION = {
	version: 8,
	name: "critic-governance",
	sql: `
create table finding_threads(
	id integer primary key,
	workflow_id integer not null references workflows(id),
	fingerprint text not null,
	rework_count integer not null default 0,
	status text not null default 'open' check(status in ('open', 'resolved', 'risk_accepted', 'human_gate')),
	created_at text not null,
	updated_at text not null,
	unique(workflow_id, fingerprint)
);

create trigger finding_thread_rework_count_immutable
before update of rework_count on finding_threads
when new.rework_count < old.rework_count
begin
	select raise(abort, 'Finding thread rework count cannot decrease');
end;

create trigger finding_thread_status_transition
before update of status on finding_threads
when old.status = 'resolved' and new.status != 'resolved'
begin
	select raise(abort, 'Resolved finding thread cannot transition');
end;

create table findings(
	id integer primary key,
	workflow_id integer not null references workflows(id),
	task_attempt_id integer not null references task_attempts(id),
	thread_id integer not null references finding_threads(id),
	fingerprint text not null,
	severity text not null check(severity in ('critical', 'major', 'minor', 'info')),
	status text not null default 'open' check(status in ('open', 'resolved', 'risk_accepted', 'disclosed')),
	summary text not null,
	target_revision_id integer not null references artifact_revisions(id),
	target_artifact_kind text not null,
	source_ref text not null,
	evidence_json text,
	created_at text not null,
	resolved_at text,
	risk_accepted_by text,
	risk_acceptance_reason text,
	unique(workflow_id, fingerprint, target_revision_id)
);

create trigger finding_content_immutable
before update of fingerprint, severity, summary, target_revision_id, target_artifact_kind, source_ref, evidence_json, task_attempt_id, thread_id on findings
begin
	select raise(abort, 'Finding content is immutable');
end;

create trigger finding_status_transition
before update of status on findings
when old.status = 'resolved' and new.status != 'resolved'
begin
	select raise(abort, 'Resolved finding cannot transition');
end;

create trigger finding_risk_acceptance_severity
before update of risk_accepted_by on findings
when new.risk_accepted_by is not null and old.severity = 'critical'
begin
	select raise(abort, 'Critical finding cannot be risk accepted');
end;
`,
};
