export const HUMAN_GOVERNANCE_MIGRATION = {
	version: 10,
	name: "human-governance",
	sql: `
-- Recreate command_receipts with expanded command_type enum (adds human governance + archive commands)
create table command_receipts_new (
	command_id text not null primary key,
	workflow_id integer not null references workflows(id) on delete restrict,
	request_digest text not null check (length(request_digest) = 71 and substr(request_digest, 1, 7) = 'sha256:' and substr(request_digest, 8) not glob '*[^0-9a-f]*'),
	command_type text not null check (
		command_type in (
			'start', 'pause', 'resume', 'retry-recovery', 'cancel-run', 'dispose-decision',
			'steer', 'retry-task', 'retry-planning', 'replace-plan', 'diagnostic-run',
			'provide-human-input', 'revise-requirement',
			'approve-artifact', 'reject-artifact', 'accept-finding-risk',
			'revoke-approval', 'approve-packet', 'reject-packet'
		)
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

-- Human Directives recorded by steer commands (append-only)
create table human_directives (
	id integer primary key autoincrement,
	workflow_id integer not null references workflows(id) on delete restrict,
	directive_text text not null check (length(directive_text) > 0),
	actor_snapshot_document_id integer not null references snapshot_documents(id) on delete restrict,
	command_id text not null,
	created_at text not null
);

create index human_directives_by_workflow on human_directives(workflow_id);

create trigger human_directive_immutable_update
before update on human_directives begin
	select raise(abort, 'Human Directive is immutable');
end;

create trigger human_directive_immutable_delete
before delete on human_directives begin
	select raise(abort, 'Human Directive is immutable');
end;

-- Human Gates: exact subjects awaiting human input or disposition
create table human_gates (
	id integer primary key autoincrement,
	workflow_id integer not null references workflows(id) on delete restrict,
	gate_type text not null check (gate_type in ('human_input', 'finding_disposition')),
	subject_type text not null,
	subject_id integer not null,
	status text not null check (status in ('open', 'resolved')),
	resolution_json text,
	opened_at text not null,
	resolved_at text
);

create index human_gates_by_workflow on human_gates(workflow_id, status);

create trigger human_gate_content_immutable
before update of workflow_id, gate_type, subject_type, subject_id, opened_at on human_gates begin
	select raise(abort, 'Human Gate content is immutable');
end;

create trigger human_gate_status_irreversible
before update of status on human_gates
when old.status = 'resolved' and new.status != 'resolved' begin
	select raise(abort, 'Human Gate resolution is irreversible');
end;

create trigger human_gate_immutable_delete
before delete on human_gates begin
	select raise(abort, 'Human Gate is immutable');
end;

-- Approval Records: immutable audit for all human governance dispositions
create table approval_records (
	id integer primary key autoincrement,
	workflow_id integer not null references workflows(id) on delete restrict,
	record_type text not null check (record_type in (
		'artifact_approval', 'artifact_rejection', 'finding_risk_acceptance',
		'packet_approval', 'packet_rejection', 'approval_revocation'
	)),
	subject_type text not null,
	subject_id integer not null,
	subject_digest text,
	reason text,
	targets_json text,
	actor_snapshot_document_id integer not null references snapshot_documents(id) on delete restrict,
	command_id text not null,
	created_at text not null
);

create index approval_records_by_workflow on approval_records(workflow_id);

create trigger approval_record_immutable_update
before update on approval_records begin
	select raise(abort, 'Approval Record is immutable');
end;

create trigger approval_record_immutable_delete
before delete on approval_records begin
	select raise(abort, 'Approval Record is immutable');
end;

-- Diagnostic Runs: read-only inspection runs, no attempt, no side effects
create table diagnostic_runs (
	id integer primary key autoincrement,
	workflow_id integer not null references workflows(id) on delete restrict,
	purpose text not null check (length(purpose) > 0),
	status text not null check (status in ('completed')),
	actor_snapshot_document_id integer not null references snapshot_documents(id) on delete restrict,
	command_id text not null,
	created_at text not null
);

create index diagnostic_runs_by_workflow on diagnostic_runs(workflow_id);

create trigger diagnostic_run_immutable_update
before update on diagnostic_runs begin
	select raise(abort, 'Diagnostic Run is immutable');
end;

create trigger diagnostic_run_immutable_delete
before delete on diagnostic_runs begin
	select raise(abort, 'Diagnostic Run is immutable');
end;

-- Recreate approval_packets with rejection status (rejected digest cannot be resubmitted until inputs change)
create table approval_packets_new (
	id integer primary key,
	workflow_id integer not null references workflows(id),
	digest text not null,
	content_json text not null,
	status text not null default 'current' check (status in ('current', 'rejected')),
	created_at text not null
);

insert into approval_packets_new (id, workflow_id, digest, content_json, status, created_at)
select id, workflow_id, digest, content_json, 'current', created_at
from approval_packets;

drop table approval_packets;
alter table approval_packets_new rename to approval_packets;

create index approval_packets_by_workflow on approval_packets(workflow_id);

create trigger approval_packet_content_immutable
before update of workflow_id, digest, content_json, created_at on approval_packets begin
	select raise(abort, 'ApprovalPacket content is immutable');
end;

create trigger approval_packet_status_forward
before update of status on approval_packets
when old.status = 'rejected' and new.status != 'rejected' begin
	select raise(abort, 'ApprovalPacket rejection is irreversible');
end;

create trigger approval_packet_immutable_delete
before delete on approval_packets begin
	select raise(abort, 'ApprovalPacket is immutable');
end;
`,
};
