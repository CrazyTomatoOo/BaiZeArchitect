export const COMMAND_GOVERNANCE_MIGRATION = {
	version: 2,
	name: "command-governance",
	sql: `
create table command_receipts (
	command_id text primary key,
	workflow_id integer not null references workflows(id) on delete restrict,
	request_digest text not null check (
		length(request_digest) = 71
		and substr(request_digest, 1, 7) = 'sha256:'
		and substr(request_digest, 8) not glob '*[^0-9a-f]*'
	),
	command_type text not null check (command_type in ('start','pause','resume','steer','cancel-run','retry-task','retry-planning','retry-recovery','replace-plan','diagnostic-run','provide-human-input','revise-requirement','dispose-decision','approve-artifact','reject-artifact','accept-major-finding-risk','revoke-approval','approve-approval-packet','reject-approval-packet')),
	expected_workflow_version integer not null check (expected_workflow_version >= 0),
	actor_snapshot_document_id integer references snapshot_documents(id) on delete restrict,
	outcome text not null check (outcome in ('accepted','capability_denied','version_conflict','state_conflict','subject_conflict','business_rule_rejected')),
	http_status integer not null,
	workflow_version integer not null check (workflow_version >= 0),
	last_event_seq integer not null check (last_event_seq >= 0),
	created_at text not null
);

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

create table outbox_jobs (
	id integer primary key,
	workflow_id integer not null references workflows(id) on delete restrict,
	event_seq integer not null,
	delivery_type text not null check (delivery_type in ('workflow_event')),
	payload text not null,
	created_at text not null,
	delivered_at text
);

create trigger outbox_job_content_immutable
before update of workflow_id, event_seq, delivery_type, payload, created_at on outbox_jobs begin
	select raise(abort, 'Outbox Job content is immutable');
end;
`,
} as const;
