const SNAPSHOT_DOCUMENT_KINDS = [
	"plan_proposal",
	"task_spec",
	"context_manifest",
	"diagnostic_context",
	"effect_publication_token",
	"role_contract",
	"role_contract_bundle",
	"skill",
	"input_schema",
	"output_schema",
	"policy_bundle",
	"artifact_content",
	"run_result",
	"approval_packet",
	"actor_snapshot",
	"command_request",
	"command_response",
	"outbox_payload",
	"repository_manifest",
	"cutover_report",
	"migration_attestation",
	"legacy_requirement_bundle",
	"reusable_asset_content",
] as const;

const SNAPSHOT_DOCUMENT_KIND_SQL = SNAPSHOT_DOCUMENT_KINDS.map((kind) => `'${kind}'`).join(",");

export const WORKFLOW_GOVERNANCE_MIGRATION = {
	version: 1,
	name: "workflow-governance-kernel",
	sql: `
create table schema_migrations (
	version integer primary key,
	name text not null,
	checksum text not null,
	applied_at text not null
);

create table workspaces (
	id integer primary key,
	repo_path text not null unique,
	name text not null,
	created_at text not null
);

create table snapshot_documents (
	id integer primary key,
	kind text not null check (kind in (${SNAPSHOT_DOCUMENT_KIND_SQL})),
	schema_ref text not null,
	media_type text not null,
	content text not null,
	digest text not null check (
		length(digest) = 71
		and substr(digest, 1, 7) = 'sha256:'
		and substr(digest, 8) not glob '*[^0-9a-f]*'
	),
	created_at text not null,
	unique(kind, digest)
);

create trigger snapshot_documents_immutable_update
before update on snapshot_documents begin
	select raise(abort, 'Snapshot Document is immutable');
end;

create trigger snapshot_documents_immutable_delete
before delete on snapshot_documents begin
	select raise(abort, 'Snapshot Document is immutable');
end;

create table requirements (
	id integer primary key,
	workspace_id integer not null references workspaces(id) on delete restrict,
	title text not null check (length(title) > 0),
	version integer not null check (version >= 1),
	current_revision_id integer,
	created_at text not null,
	updated_at text not null
);

create trigger requirement_current_revision_insert_forbidden
before insert on requirements
when new.current_revision_id is not null begin
	select raise(abort, 'Requirement current revision must belong to its requirement Artifact');
end;
create table artifacts (
	id integer primary key,
	requirement_id integer not null references requirements(id) on delete restrict,
	kind text not null check (kind in ('requirement','analysis','scenario','usecase','function','design','architecture','data','api')),
	title text not null,
	current_revision_id integer,
	created_at text not null,
	unique(requirement_id, kind)
);

create table artifact_revisions (
	id integer primary key,
	artifact_id integer not null references artifacts(id) on delete restrict,
	revision_no integer not null check (revision_no > 0),
	content_document_id integer not null references snapshot_documents(id) on delete restrict,
	content_digest text not null,
	schema_ref text not null,
	status text not null check (status in ('draft','pending','approved','rejected')),
	source_attempt_id integer,
	source_command_id text,
	source_migration_document_id integer references snapshot_documents(id) on delete restrict,
	base_revision_id integer references artifact_revisions(id) on delete restrict,
	created_at text not null,
	unique(artifact_id, revision_no)
);

create trigger artifact_current_revision_insert_forbidden
before insert on artifacts
when new.current_revision_id is not null begin
	select raise(abort, 'Artifact current revision must belong to the Artifact');
end;
create trigger artifact_current_revision_ownership
before update of current_revision_id on artifacts
when new.current_revision_id is not null begin
	select case when not exists (
		select 1 from artifact_revisions revision
		where revision.id = new.current_revision_id
		and revision.artifact_id = new.id
	) then raise(abort, 'Artifact current revision must belong to the Artifact') end;
end;

create trigger artifact_revision_content_identity_insert
before insert on artifact_revisions begin
	select case when not exists (
		select 1 from snapshot_documents document
		where document.id = new.content_document_id
		and document.kind = 'artifact_content'
		and document.digest = new.content_digest
		and document.schema_ref = new.schema_ref
	) then raise(abort, 'Artifact revision content identity does not match its Snapshot Document') end;
end;

create trigger artifact_revision_content_identity_update
before update of content_document_id, content_digest, schema_ref on artifact_revisions begin
	select case when not exists (
		select 1 from snapshot_documents document
		where document.id = new.content_document_id
		and document.kind = 'artifact_content'
		and document.digest = new.content_digest
		and document.schema_ref = new.schema_ref
	) then raise(abort, 'Artifact revision content identity does not match its Snapshot Document') end;
end;

create trigger requirement_current_revision_ownership
before update of current_revision_id on requirements
when new.current_revision_id is not null begin
	select case when not exists (
		select 1 from artifact_revisions revision
		join artifacts artifact on artifact.id = revision.artifact_id
		where revision.id = new.current_revision_id
		and artifact.requirement_id = new.id
		and artifact.kind = 'requirement'
	) then raise(abort, 'Requirement current revision must belong to its requirement Artifact') end;
end;

create table design_sessions (
	id integer primary key,
	requirement_id integer not null unique references requirements(id) on delete restrict,
	session_file text not null,
	session_id text not null,
	status text not null check (status in ('active','archived')),
	created_at text not null,
	updated_at text not null,
	archived_at text
);

create table workflows (
	id integer primary key,
	requirement_id integer not null unique references requirements(id) on delete restrict,
	state text not null check (state in ('pending','running','waiting_for_human','paused','failed','ready_to_archive','archived')),
	version integer not null check (version >= 0),
	last_event_seq integer not null check (last_event_seq >= 0),
	current_plan_revision_id integer,
	policy_bundle_document_id integer not null references snapshot_documents(id) on delete restrict,
	current_approval_packet_id integer,
	current_failure_code text,
	current_failure_subject_id integer,
	created_at text not null,
	updated_at text not null,
	archived_at text
);

create trigger workflow_policy_bundle_valid_insert
before insert on workflows begin
	select case when not exists (
		select 1 from snapshot_documents document
		where document.id = new.policy_bundle_document_id
		and document.kind = 'policy_bundle'
		and document.schema_ref = 'policy-bundle/v1'
	) then raise(abort, 'Workflow Policy Bundle reference is invalid') end;
end;

create trigger workflow_delete_forbidden
before delete on workflows begin
	select raise(abort, 'Workflow is lifetime-bound to its Requirement');
end;
create trigger workflow_last_event_seq_managed
before update of last_event_seq on workflows
when new.last_event_seq != old.last_event_seq
and (
	new.last_event_seq != old.last_event_seq + 1
	or not exists (
		select 1 from workflow_events event
		where event.workflow_id = new.id and event.seq = new.last_event_seq
	)
) begin
	select raise(abort, 'Workflow last event sequence is managed by event insertion');
end;

create trigger workflow_policy_bundle_immutable
before update of policy_bundle_document_id on workflows
when old.policy_bundle_document_id != new.policy_bundle_document_id begin
	select raise(abort, 'Workflow Policy Bundle is immutable');
end;

create table workflow_events (
	workflow_id integer not null references workflows(id) on delete restrict,
	seq integer not null check (seq > 0),
	type text not null,
	type_version integer not null check (type_version > 0),
	schema_version text not null,
	workflow_version integer not null check (workflow_version >= 0),
	entity_type text,
	entity_id integer,
	entity_version integer,
	command_id text,
	actor_snapshot_document_id integer references snapshot_documents(id) on delete restrict,
	payload text not null,
	created_at text not null,
	primary key(workflow_id, seq)
) without rowid;

create trigger workflow_events_immutable_update
before update on workflow_events begin
	select raise(abort, 'Workflow Event is immutable');
end;

create trigger workflow_events_immutable_delete
before delete on workflow_events begin
	select raise(abort, 'Workflow Event is immutable');
end;

create trigger workflow_event_sequence_insert
before insert on workflow_events begin
	select case when new.seq != coalesce((
		select max(seq) + 1 from workflow_events where workflow_id = new.workflow_id
	), 1) then raise(abort, 'Workflow Event sequence must be contiguous') end;
	select case when new.seq != (
		select last_event_seq + 1 from workflows where id = new.workflow_id
	) then raise(abort, 'Workflow Event sequence must follow Workflow last_event_seq') end;
end;

create trigger workflow_event_sequence_advance
after insert on workflow_events begin
	update workflows set last_event_seq = new.seq where id = new.workflow_id;
end;
`,
} as const;
