
export const DECISIONS_AND_READINESS_MIGRATION = {
	version: 9,
	name: "decisions_and_readiness",
	sql: `
-- Recreate command_receipts with expanded command_type enum (adds 'dispose-decision')
create table command_receipts_new (
	command_id text not null primary key,
	workflow_id integer not null references workflows(id) on delete restrict,
	request_digest text not null check (length(request_digest) = 71 and substr(request_digest, 1, 7) = 'sha256:' and substr(request_digest, 8) not glob '*[^0-9a-f]*'),
	command_type text not null check (
		command_type in ('start', 'pause', 'resume', 'retry-recovery', 'cancel-run', 'dispose-decision')
	),
	expected_workflow_version integer not null,
	actor_snapshot_document_id integer references snapshot_documents(id),
	outcome text not null check (
		outcome in ('accepted', 'capability_denied', 'version_conflict', 'state_conflict', 'business_rule_rejected', 'idempotency_conflict')
	),
	http_status integer not null check (http_status in (200, 201, 403, 409, 422)),
	workflow_version integer not null,
	last_event_seq integer not null,
	created_at text not null,
	foreign key (workflow_id) references workflows(id) on delete restrict
);

insert into command_receipts_new (
	command_id, workflow_id, request_digest, command_type, expected_workflow_version,
	actor_snapshot_document_id, outcome, http_status, workflow_version, last_event_seq, created_at
)
select command_id, workflow_id, request_digest, command_type, expected_workflow_version,
	actor_snapshot_document_id, outcome, http_status, workflow_version, last_event_seq, created_at
from command_receipts;

drop table command_receipts;
alter table command_receipts_new rename to command_receipts;

create trigger command_receipt_immutable_update
before update on command_receipts begin
	select raise(abort, 'Command Receipt is immutable');
end;

create trigger command_receipt_immutable_delete
before delete on command_receipts begin
	select raise(abort, 'Command Receipt is immutable');
end;

create trigger command_receipt_actor_snapshot_valid
before insert on command_receipts
when new.actor_snapshot_document_id is not null begin
	select case when not exists (
		select 1 from snapshot_documents document
		where document.id = new.actor_snapshot_document_id
		and document.kind = 'actor_snapshot'
	) then raise(abort, 'Command Receipt actor snapshot is invalid') end;
end;
create table decisions(
	id integer primary key,
	workflow_id integer not null references workflows(id),
	task_attempt_id integer not null references task_attempts(id),
	severity text not null check(severity in ('critical','major','minor')),
	summary text not null,
	status text not null default 'open' check(status in ('open','accepted','rejected','deferred')),
	reason text,
	owner text,
	follow_up_target text,
	created_at text not null,
	disposed_at text
);

create index decisions_by_workflow on decisions(workflow_id);

create trigger decision_content_immutable
before update of summary, severity, task_attempt_id, workflow_id on decisions
begin
	select raise(abort, 'Decision content is immutable');
end;

create trigger decision_status_forward
before update of status on decisions
when old.status in ('accepted','rejected','deferred') and new.status != old.status
begin
	select raise(abort, 'Decision disposition is irreversible');
end;

create trigger decision_dispose_minor_requires_fields
before update of status on decisions
when new.status = 'deferred' and (new.reason is null or new.owner is null or new.follow_up_target is null)
begin
	select raise(abort, 'Deferred Decision requires reason, owner, and follow-up target');
end;

create table critic_coverage_targets(
	id integer primary key,
	workflow_id integer not null references workflows(id),
	task_attempt_id integer not null references task_attempts(id),
	revision_id integer not null references artifact_revisions(id),
	artifact_kind text not null,
	created_at text not null
);

create index critic_coverage_targets_by_workflow on critic_coverage_targets(workflow_id);
create index critic_coverage_targets_by_attempt on critic_coverage_targets(task_attempt_id);

create trigger critic_coverage_target_immutable
before update on critic_coverage_targets
begin
	select raise(abort, 'Critic coverage target is immutable');
end;

create trigger critic_coverage_target_immutable_delete
before delete on critic_coverage_targets
begin
	select raise(abort, 'Critic coverage target is immutable');
end;

create table approval_packets(
	id integer primary key,
	workflow_id integer not null references workflows(id),
	digest text not null,
	content_json text not null,
	created_at text not null
);

create index approval_packets_by_workflow on approval_packets(workflow_id);

create trigger approval_packet_immutable
before update on approval_packets
begin
	select raise(abort, 'ApprovalPacket is immutable');
end;

create trigger approval_packet_immutable_delete
before delete on approval_packets
begin
	select raise(abort, 'ApprovalPacket is immutable');
end;
`,
};
