export const REQUIRED_ARTIFACTS_AND_EVIDENCE_MIGRATION = {
	version: 7,
	name: "required-artifacts-and-evidence",
	sql: `
create table evidence_snapshots(
	id integer primary key autoincrement,
	workflow_id integer not null references workflows(id),
	repo_digest text not null,
	files_document_id integer not null references snapshot_documents(id),
	created_at text not null,
	unique(workflow_id, repo_digest)
);

create trigger evidence_snapshot_immutable_update
before update on evidence_snapshots
for each row begin
	select raise(abort, 'Evidence snapshots are immutable');
end;

create trigger evidence_snapshot_immutable_delete
before delete on evidence_snapshots
for each row begin
	select raise(abort, 'Evidence snapshots are immutable');
end;

create trigger evidence_snapshot_files_valid
before insert on evidence_snapshots
for each row begin
	select case when not exists (
		select 1 from snapshot_documents document
		where document.id = new.files_document_id
		and document.kind = 'repository_manifest'
	) then raise(abort, 'Evidence snapshot files document is invalid') end;
end;

create table trace_links(
	id integer primary key autoincrement,
	artifact_revision_id integer not null references artifact_revisions(id),
	evidence_snapshot_id integer not null references evidence_snapshots(id),
	source_ref_json text not null,
	created_at text not null
);

create trigger trace_link_immutable_update
before update on trace_links
for each row begin
	select raise(abort, 'Trace links are immutable');
end;

create trigger trace_link_immutable_delete
before delete on trace_links
for each row begin
	select raise(abort, 'Trace links are immutable');
end;

create table impact_profiles(
	id integer primary key autoincrement,
	workflow_id integer not null references workflows(id),
	profile_json text not null,
	required_kinds_json text not null,
	blocking_dimensions_json text not null,
	complete integer not null check (complete in (0, 1)),
	created_at text not null
);

create trigger impact_profile_immutable_update
before update on impact_profiles
for each row begin
	select raise(abort, 'Impact profiles are immutable');
end;

create trigger impact_profile_immutable_delete
before delete on impact_profiles
for each row begin
	select raise(abort, 'Impact profiles are immutable');
end;
`,
} as const;
