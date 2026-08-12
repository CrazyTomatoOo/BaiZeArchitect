export const PLANNING_GOVERNANCE_MIGRATION = {
	version: 4,
	name: "planning-governance",
	sql: `
alter table workflows add column consecutive_plan_revisions integer not null default 0 check (consecutive_plan_revisions >= 0);

create table plan_revisions (
	id integer primary key,
	workflow_id integer not null references workflows(id) on delete restrict,
	revision_no integer not null check (revision_no > 0),
	proposal_document_id integer not null references snapshot_documents(id) on delete restrict,
	proposal_digest text not null,
	base_plan_revision_id integer references plan_revisions(id) on delete restrict,
	planning_context_digest text not null,
	status text not null check (status in ('active', 'superseded')),
	created_at text not null,
	unique(workflow_id, revision_no)
);

create trigger plan_revision_content_immutable
before update of workflow_id, revision_no, proposal_document_id, proposal_digest, base_plan_revision_id, planning_context_digest, created_at on plan_revisions begin
	select raise(abort, 'Plan Revision content is immutable');
end;

create trigger plan_revision_immutable_delete
before delete on plan_revisions begin
	select raise(abort, 'Plan Revision is immutable');
end;

create trigger plan_revision_proposal_snapshot_valid
before insert on plan_revisions begin
	select case when not exists (
		select 1 from snapshot_documents document
		where document.id = new.proposal_document_id
		and document.kind = 'plan_proposal'
	) then raise(abort, 'Plan Revision proposal document is invalid') end;
end;

create table tasks (
	id integer primary key,
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
	max_attempts integer not null default 1 check (max_attempts >= 1 and max_attempts <= 3),
	status text not null check (status in ('pending', 'in_progress', 'completed', 'failed', 'superseded')),
	created_at text not null
);

create trigger task_content_immutable
before update of workflow_id, plan_revision_id, key, kind, role, objective, depends_on_json, inputs_json, expected_artifact_effects_json, completion_policy_ref, max_attempts, created_at on tasks begin
	select raise(abort, 'Task content is immutable');
end;

create trigger task_immutable_delete
before delete on tasks begin
	select raise(abort, 'Task is immutable');
end;

create table task_attempts (
	id integer primary key,
	task_id integer not null references tasks(id) on delete restrict,
	workflow_id integer not null references workflows(id) on delete restrict,
	attempt_no integer not null check (attempt_no > 0),
	status text not null check (status in ('pending', 'running', 'succeeded', 'failed', 'superseded')),
	planning_context_digest text,
	base_workflow_version integer check (base_workflow_version is null or base_workflow_version >= 0),
	result_document_id integer references snapshot_documents(id) on delete restrict,
	created_at text not null,
	completed_at text,
	unique(task_id, attempt_no)
);

create trigger task_attempt_content_immutable
before update of task_id, workflow_id, attempt_no, planning_context_digest, base_workflow_version, created_at on task_attempts begin
	select raise(abort, 'Task Attempt content is immutable');
end;

create trigger task_attempt_immutable_delete
before delete on task_attempts begin
	select raise(abort, 'Task Attempt is immutable');
end;

create trigger task_attempt_result_snapshot_valid
before insert on task_attempts
when new.result_document_id is not null begin
	select case when not exists (
		select 1 from snapshot_documents document
		where document.id = new.result_document_id
		and document.kind = 'run_result'
	) then raise(abort, 'Task Attempt result document is invalid') end;
end;

create table runs (
	id integer primary key,
	attempt_id integer not null references task_attempts(id) on delete restrict,
	workflow_id integer not null references workflows(id) on delete restrict,
	session_file text not null,
	session_id text not null,
	status text not null check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
	created_at text not null,
	completed_at text
);

create trigger run_content_immutable
before update of attempt_id, workflow_id, session_file, session_id, created_at on runs begin
	select raise(abort, 'Run content is immutable');
end;

create trigger run_immutable_delete
before delete on runs begin
	select raise(abort, 'Run is immutable');
end;

create table governance_claims (
	id integer primary key,
	workflow_id integer not null references workflows(id) on delete restrict,
	attempt_id integer not null references task_attempts(id) on delete restrict,
	status text not null check (status in ('active', 'released')),
	created_at text not null,
	released_at text
);

create trigger governance_claim_single_active
before insert on governance_claims
when new.status = 'active' and exists (
	select 1 from governance_claims
	where workflow_id = new.workflow_id
	and status = 'active'
) begin
	select raise(abort, 'Only one active governance claim per workflow');
end;
create trigger governance_claim_single_active_on_update
before update of status on governance_claims
when new.status = 'active' and exists (
	select 1 from governance_claims
	where workflow_id = new.workflow_id
	and id != new.id
	and status = 'active'
) begin
	select raise(abort, 'Only one active governance claim per workflow');
end;

create trigger governance_claim_content_immutable
before update of workflow_id, attempt_id, created_at on governance_claims begin
	select raise(abort, 'Governance Claim content is immutable');
end;

create trigger governance_claim_immutable_delete
before delete on governance_claims begin
	select raise(abort, 'Governance Claim is immutable');
end;
`,
} as const;
