export const ATTEMPT_EXECUTION_MIGRATION = {
	version: 5,
	name: "attempt-execution-governance",
	sql: `
alter table task_attempts add column context_manifest_document_id integer references snapshot_documents(id) on delete restrict;
alter table task_attempts add column role_contract_document_id integer references snapshot_documents(id) on delete restrict;

alter table runs add column model_ref text;
alter table runs add column result_document_id integer references snapshot_documents(id) on delete restrict;
alter table runs add column mode text not null default 'governance' check (mode in ('governance', 'diagnostic'));
alter table runs add column role text check (role is null or role in ('orchestrator', 'analyst', 'architect', 'critic'));

create trigger task_attempt_context_manifest_valid
before insert on task_attempts
when new.context_manifest_document_id is not null begin
	select case when not exists (
		select 1 from snapshot_documents document
		where document.id = new.context_manifest_document_id
		and document.kind = 'context_manifest'
	) then raise(abort, 'Context Manifest document is invalid') end;
end;

create trigger task_attempt_context_manifest_immutable
before update of context_manifest_document_id, role_contract_document_id on task_attempts begin
	select raise(abort, 'Task Attempt context is immutable');
end;

create trigger task_attempt_role_contract_valid
before insert on task_attempts
when new.role_contract_document_id is not null begin
	select case when not exists (
		select 1 from snapshot_documents document
		where document.id = new.role_contract_document_id
		and document.kind = 'role_contract'
	) then raise(abort, 'Role Contract document is invalid') end;
end;

create trigger run_result_document_valid
before insert on runs
when new.result_document_id is not null begin
	select case when not exists (
		select 1 from snapshot_documents document
		where document.id = new.result_document_id
		and document.kind = 'run_result'
	) then raise(abort, 'Run result document is invalid') end;
end;

create trigger run_role_mode_immutable
before update of attempt_id, workflow_id, session_file, session_id, model_ref, mode, role, created_at on runs begin
	select raise(abort, 'Run content is immutable');
end;

create table attempt_effects (
	id integer primary key,
	workflow_id integer not null references workflows(id) on delete restrict,
	task_id integer not null references tasks(id) on delete restrict,
	attempt_id integer not null references task_attempts(id) on delete restrict,
	effect_type text not null check (effect_type in ('artifact_revision')),
	logical_key text not null,
	artifact_kind text not null check (artifact_kind in ('analysis', 'scenario', 'usecase', 'function', 'design', 'architecture', 'data', 'api')),
	effect_version integer not null check (effect_version > 0),
	payload_document_id integer not null references snapshot_documents(id) on delete restrict,
	payload_digest text not null,
	state text not null check (state in ('staged', 'published', 'discarded')),
	published_artifact_revision_id integer references artifact_revisions(id) on delete restrict,
	created_at text not null,
	unique(attempt_id, logical_key, effect_version)
);

create trigger attempt_effect_content_immutable
before update of workflow_id, task_id, attempt_id, effect_type, logical_key, artifact_kind, effect_version, payload_document_id, payload_digest, created_at on attempt_effects begin
	select raise(abort, 'Attempt Effect content is immutable');
end;

create trigger attempt_effect_immutable_delete
before delete on attempt_effects begin
	select raise(abort, 'Attempt Effect is immutable');
end;

create trigger attempt_effect_payload_valid
before insert on attempt_effects begin
	select case when not exists (
		select 1 from snapshot_documents document
		where document.id = new.payload_document_id
		and document.kind = 'artifact_content'
	) then raise(abort, 'Attempt Effect payload document is invalid') end;
end;

create trigger attempt_effect_published_revision_valid
before insert on attempt_effects
when new.published_artifact_revision_id is not null and new.state != 'published' begin
	select raise(abort, 'Published effect must reference published revision');
end;

create trigger attempt_effect_published_revision_match
before insert on attempt_effects
when new.published_artifact_revision_id is not null begin
	select case when not exists (
		select 1 from artifact_revisions revision
		where revision.id = new.published_artifact_revision_id
		and revision.source_attempt_id = new.attempt_id
	) then raise(abort, 'Published effect revision must belong to this attempt') end;
end;
`,
} as const;
