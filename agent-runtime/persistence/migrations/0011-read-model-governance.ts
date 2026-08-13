export const READ_MODEL_GOVERNANCE_MIGRATION = {
	version: 11,
	name: "read-model-governance",
	sql: `
create table reusable_assets (
	id integer primary key,
	workspace_id integer not null references workspaces(id) on delete restrict,
	kind text not null check (kind in ('scenario','usecase','function')),
	title text not null,
	current_revision_id integer,
	legacy_origin_requirement_id integer,
	created_at text not null,
	updated_at text not null
);

create index reusable_assets_workspace on reusable_assets(workspace_id, id);

create table reusable_asset_revisions (
	id integer primary key,
	reusable_asset_id integer not null references reusable_assets(id) on delete cascade,
	revision_no integer not null check (revision_no > 0),
	content_document_id integer not null references snapshot_documents(id) on delete restrict,
	content_digest text not null,
	source text not null check (source in ('manual','import','migration')),
	actor_snapshot_document_id integer references snapshot_documents(id) on delete restrict,
	migration_attestation_document_id integer references snapshot_documents(id) on delete restrict,
	created_at text not null,
	unique(reusable_asset_id, revision_no)
);

create trigger reusable_asset_revision_content_immutable
before update on reusable_asset_revisions
when old.reusable_asset_id != new.reusable_asset_id
	or old.revision_no != new.revision_no
	or old.content_document_id != new.content_document_id
	or old.content_digest != new.content_digest
	or old.source != new.source
	or old.created_at != new.created_at
begin
	select raise(abort, 'ReusableAssetRevision content is immutable');
end;


create table design_packages (
	id integer primary key,
	requirement_id integer not null references requirements(id) on delete restrict,
	workspace_id integer not null references workspaces(id) on delete restrict,
	document_id integer not null references snapshot_documents(id) on delete restrict,
	digest text not null,
	approval_packet_id integer references approval_packets(id) on delete restrict,
	approval_id integer references approval_records(id) on delete restrict,
	migration_attestation_document_id integer references snapshot_documents(id) on delete restrict,
	archive_class text not null check (archive_class in ('governed','legacy_pre_policy')),
	archived_at text not null,
	unique(requirement_id)
);

create trigger design_package_class_shape
before insert on design_packages
when (new.archive_class = 'governed' and (new.approval_packet_id is null or new.approval_id is null or new.migration_attestation_document_id is not null))
	or (new.archive_class = 'legacy_pre_policy' and (new.migration_attestation_document_id is null or new.approval_packet_id is not null or new.approval_id is not null))
begin
	select raise(abort, 'DesignPackage archive class shape is invalid');
end;

create trigger design_packages_immutable
before update on design_packages
begin
	select raise(abort, 'DesignPackage is immutable');
end;

create trigger design_packages_no_delete
before delete on design_packages
begin
	select raise(abort, 'DesignPackage cannot be deleted');
end;

create table legacy_imports (
	requirement_id integer primary key references requirements(id) on delete restrict,
	workflow_id integer not null references workflows(id) on delete restrict,
	import_class text not null check (import_class in ('legacy_archived','pending_reentry')),
	bundle_document_id integer not null references snapshot_documents(id) on delete restrict,
	attestation_document_id integer not null references snapshot_documents(id) on delete restrict,
	anomaly_count integer not null check (anomaly_count >= 0),
	created_at text not null
);

create trigger legacy_imports_immutable
before update on legacy_imports
begin
	select raise(abort, 'LegacyImport is immutable');
end;

create trigger legacy_imports_no_delete
before delete on legacy_imports
begin
	select raise(abort, 'LegacyImport cannot be deleted');
end;
`,
} as const;
