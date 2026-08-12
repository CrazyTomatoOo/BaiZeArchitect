export const DEPENDENT_TASK_SAFETY_MIGRATION = {
	version: 6,
	name: "dependent-task-safety",
	sql: `
-- Recreate command_receipts with expanded command_type enum (adds 'cancel-run')
create table command_receipts_new (
	command_id text not null primary key,
	workflow_id integer not null references workflows(id) on delete restrict,
	request_digest text not null check (length(request_digest) = 71 and substr(request_digest, 1, 7) = 'sha256:' and substr(request_digest, 8) not glob '*[^0-9a-f]*'),
	command_type text not null check (
		command_type in ('start', 'pause', 'resume', 'retry-recovery', 'cancel-run')
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

-- Recreate immutability and actor-snapshot triggers lost when dropping command_receipts
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
-- Recreate tasks with expanded status enum (adds 'blocked', 'replan_requested')
create table tasks_new (
	id integer primary key autoincrement,
	workflow_id integer not null references workflows(id) on delete restrict,
	plan_revision_id integer references plan_revisions(id) on delete restrict,
	key text not null,
	kind text not null check (kind in ('plan', 'analyze', 'design', 'review', 'rework', 'verify')),
	role text not null check (role in ('orchestrator', 'analyst', 'architect', 'critic')),
	objective text not null,
	depends_on_json text not null default '[]',
	inputs_json text not null default '[]',
	expected_artifact_effects_json text not null default '[]',
	completion_policy_ref text,
	max_attempts integer not null check (max_attempts >= 1 and max_attempts <= 3),
	status text not null check (status in ('pending', 'in_progress', 'completed', 'failed', 'superseded', 'blocked', 'replan_requested')),
	created_at text not null,
	foreign key (workflow_id) references workflows(id) on delete restrict
);

insert into tasks_new (id, workflow_id, plan_revision_id, key, kind, role, objective, depends_on_json, inputs_json, expected_artifact_effects_json, completion_policy_ref, max_attempts, status, created_at)
select id, workflow_id, plan_revision_id, key, kind, role, objective, depends_on_json, inputs_json, expected_artifact_effects_json, completion_policy_ref, max_attempts, status, created_at
from tasks;

drop table tasks;
alter table tasks_new rename to tasks;

-- Recreate task_attempts with expanded status enum (adds 'cancelled', 'blocked', 'replan_requested')
create table task_attempts_new (
	id integer primary key autoincrement,
	task_id integer not null references tasks(id) on delete restrict,
	workflow_id integer not null references workflows(id) on delete restrict,
	attempt_no integer not null check (attempt_no >= 1),
	status text not null check (status in ('pending', 'running', 'succeeded', 'failed', 'superseded', 'cancelled', 'blocked', 'replan_requested')),
	planning_context_digest text,
	base_workflow_version integer,
	context_manifest_document_id integer references snapshot_documents(id) on delete restrict,
	role_contract_document_id integer references snapshot_documents(id) on delete restrict,
	result_outcome text check (
		result_outcome is null or result_outcome in ('blocked', 'replan_requested')
	),
	created_at text not null,
	completed_at text,
	foreign key (task_id) references tasks(id) on delete restrict,
	foreign key (workflow_id) references workflows(id) on delete restrict
);

insert into task_attempts_new (id, task_id, workflow_id, attempt_no, status, planning_context_digest, base_workflow_version, context_manifest_document_id, role_contract_document_id, created_at, completed_at)
select id, task_id, workflow_id, attempt_no, status, planning_context_digest, base_workflow_version, context_manifest_document_id, role_contract_document_id, created_at, completed_at
from task_attempts;

drop table task_attempts;
alter table task_attempts_new rename to task_attempts;

-- Recreate runs with expanded status enum (already has 'cancelled', ensure it's there)
-- runs already has 'cancelled' in its CHECK constraint, so no change needed.

-- Triggers: task_attempts result_outcome immutability
create trigger task_attempt_result_outcome_immutable
before update of result_outcome on task_attempts
when old.result_outcome is not null and new.result_outcome is not null and old.result_outcome != new.result_outcome
begin
	select raise(abort, 'Task attempt result_outcome is immutable once set');
end;
`,
};
