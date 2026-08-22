/**
 * 0015-production-role-kind.ts — 任务/运行角色闭集扩展为生产角色（#17 决议：8 生产角色 + critic，
 * 过渡保留 orchestrator/analyst/architect，#25 移除）。SQLite 不能 ALTER CHECK，
 * 按 0006/0013 既有重建配方：建新表 → 拷贝 → drop → rename。
 */
export const PRODUCTION_ROLE_KIND_MIGRATION = {
	version: 15,
	name: "production-role-kind",
	sql: `
-- tasks.role: 8 生产角色 + critic + 过渡角色
create table tasks_new (
	id integer primary key autoincrement,
	workflow_id integer not null references workflows(id) on delete restrict,
	plan_revision_id integer references plan_revisions(id) on delete restrict,
	key text not null,
	kind text not null check (kind in ('plan', 'analyze', 'design', 'review', 'rework', 'verify')),
	role text not null check (role in ('analysis-analyst', 'scenario-analyst', 'usecase-analyst', 'function-analyst', 'design-architect', 'architecture-architect', 'data-architect', 'api-architect', 'critic', 'orchestrator', 'analyst', 'architect')),
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

-- runs.role: 同样放开（诊断 Run 可带任意新角色）
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
	status text not null check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
	mode text not null default 'governance' check (mode in ('governance', 'diagnostic')),
	role text check (role is null or role in ('analysis-analyst', 'scenario-analyst', 'usecase-analyst', 'function-analyst', 'design-architect', 'architecture-architect', 'data-architect', 'api-architect', 'critic', 'orchestrator', 'analyst', 'architect'))
);

insert into runs_new (id, attempt_id, workflow_id, session_file, session_id, model_ref, result_document_id, created_at, completed_at, status, mode, role)
select id, attempt_id, workflow_id, session_file, session_id, model_ref, result_document_id, created_at, completed_at, status, mode, role
from runs;

drop table runs;
alter table runs_new rename to runs;
`,
	checksum: "production-role-kind-v1",
} as const;