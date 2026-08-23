/**
 * 0017-finalize-role-set.ts — 移除过渡保留的旧角色 analyst/architect（#25）。
 * tasks.role 与 runs.role 的 CHECK 闭集从 12 收敛到 10（8 生产角色 + critic + orchestrator）。
 * SQLite 不能 ALTER CHECK，按 0015 既有重建配方：建新表 → 拷贝 → drop → rename，
 * 且随表重建连带重建 0004/0005 定义的不可变触发器。
 */
export const FINALIZE_ROLE_SET_MIGRATION = {
	version: 17,
	name: "finalize-role-set",
	sql: `
create table tasks_new (
	id integer primary key autoincrement,
	workflow_id integer not null references workflows(id) on delete restrict,
	plan_revision_id integer references plan_revisions(id) on delete restrict,
	key text not null,
	kind text not null check (kind in ('plan', 'analyze', 'design', 'review', 'rework', 'verify')),
	role text not null check (role in ('analysis-analyst', 'scenario-analyst', 'usecase-analyst', 'function-analyst', 'design-architect', 'architecture-architect', 'data-architect', 'api-architect', 'critic', 'orchestrator')),
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

create table runs_new (
	id integer primary key autoincrement,
	attempt_id integer not null references task_attempts(id) on delete restrict,
	workflow_id integer not null references workflows(id) on delete restrict,
	session_file text not null,
	session_id text not null,
	model_ref text,
	result_document_id integer references snapshot_documents(id) on delete restrict,
	created_at text not null,
	completed_at text,
	status text not null default 'running' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
	mode text not null default 'governance' check (mode in ('governance', 'diagnostic')),
	role text check (role is null or role in ('analysis-analyst', 'scenario-analyst', 'usecase-analyst', 'function-analyst', 'design-architect', 'architecture-architect', 'data-architect', 'api-architect', 'critic', 'orchestrator'))
);

insert into runs_new (id, attempt_id, workflow_id, session_file, session_id, model_ref, result_document_id, created_at, completed_at, status, mode, role)
select id, attempt_id, workflow_id, session_file, session_id, model_ref, result_document_id, created_at, completed_at, status, mode, role
from runs;

drop table runs;
alter table runs_new rename to runs;

-- 表重建连带 drop 了 0004/0005 定义的触发器，逐一重建以维持不可变契约
create trigger task_content_immutable
before update of workflow_id, plan_revision_id, key, kind, role, objective, depends_on_json, inputs_json, expected_artifact_effects_json, completion_policy_ref, max_attempts, created_at on tasks begin
	select raise(abort, 'Task content is immutable');
end;

create trigger task_immutable_delete
before delete on tasks begin
	select raise(abort, 'Task is immutable');
end;

create trigger run_content_immutable
before update of attempt_id, workflow_id, session_file, session_id, created_at on runs begin
	select raise(abort, 'Run content is immutable');
end;

create trigger run_immutable_delete
before delete on runs begin
	select raise(abort, 'Run is immutable');
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
`,
	checksum: "finalize-role-set-v1",
} as const;