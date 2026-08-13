/**
 * legacy-schema.ts — old Store schema DDL for cutover fixture construction.
 *
 * This module is TEST-ONLY (cutover fixtures). It recreates the exact SQLite
 * schema that the deleted store.ts produced, including migration columns,
 * so that cutover preflight/apply tests operate against real legacy databases
 * without depending on production code.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type LegacyArtifactKind =
	| "scenario"
	| "usecase"
	| "function"
	| "analysis"
	| "design"
	| "architecture"
	| "data"
	| "api"
	| "requirement";

export const LEGACY_SCHEMA = `
create table if not exists workspaces(
  id integer primary key autoincrement,
  repo_path text not null unique,
  name text not null
);
create table if not exists requirements(
  id integer primary key autoincrement,
  workspace_id integer not null references workspaces(id),
  title text not null,
  description text not null default '',
  source text not null default ''
);
create table if not exists evidence_snapshots(
  requirement_id integer primary key references requirements(id) on delete cascade,
  architecture text not null default '{}',
  head_sha text not null default '',
  captured_at text not null default (datetime('now')),
  run_id integer references runs(id)
);
create table if not exists design_packages(
  id integer primary key autoincrement,
  requirement_id integer not null references requirements(id) on delete cascade,
  workspace_id integer not null references workspaces(id) on delete cascade,
  title text not null default '',
  content text not null default '',
  adr text not null default '',
  archived_at text not null default (datetime('now')),
  run_id integer references runs(id),
  snapshot text not null default '{}',
  status text not null default 'draft'
);
create table if not exists requirement_genes(
  requirement_id integer not null references requirements(id) on delete cascade,
  gene_id text not null,
  source text not null default 'auto',
  primary key (requirement_id, gene_id)
);
create table if not exists design_sessions(
  id integer primary key autoincrement,
  requirement_id integer not null unique references requirements(id) on delete cascade,
  session_file text not null,
  session_id text not null,
  status text not null default 'active',
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  archived_at text
);
create table if not exists runs(
  id integer primary key autoincrement,
  requirement_id integer not null references requirements(id) on delete cascade,
  session_id integer not null references design_sessions(id) on delete cascade,
  session_file text,
  parent_run_id integer references runs(id) on delete set null,
  kind text not null,
  status text not null default 'queued',
  prompt text not null default '',
  error text,
  created_at text not null default (datetime('now')),
  started_at text,
  finished_at text
);
create index if not exists runs_requirement_idx on runs(requirement_id, id desc);
create table if not exists run_locks(
  requirement_id integer primary key references requirements(id) on delete cascade,
  run_id integer not null unique references runs(id) on delete cascade,
  acquired_at text not null default (datetime('now'))
);
create table if not exists run_events(
  id integer primary key autoincrement,
  run_id integer not null references runs(id) on delete cascade,
  seq integer not null,
  type text not null,
  payload text not null default '{}',
  created_at text not null default (datetime('now')),
  unique(run_id, seq)
);
create index if not exists run_events_lookup_idx on run_events(run_id, seq);
create table if not exists tool_calls(
  id integer primary key autoincrement,
  run_id integer not null references runs(id) on delete cascade,
  name text not null,
  input text not null default '{}',
  output text not null default '{}',
  status text not null default 'running',
  error text,
  started_at text not null default (datetime('now')),
  finished_at text
);
create index if not exists tool_calls_run_idx on tool_calls(run_id, id desc);
create table if not exists artifacts(
  id integer primary key autoincrement,
  requirement_id integer not null references requirements(id) on delete cascade,
  kind text not null,
  title text not null default '',
  created_at text not null default (datetime('now'))
);
create index if not exists artifacts_requirement_idx on artifacts(requirement_id, id desc);
create table if not exists artifact_revisions(
  id integer primary key autoincrement,
  artifact_id integer not null references artifacts(id) on delete cascade,
  run_id integer not null references runs(id) on delete cascade,
  revision_no integer not null,
  fork_from_revision_id integer references artifact_revisions(id),
  content text not null default '{}',
  status text not null default 'draft',
  created_at text not null default (datetime('now')),
  unique(artifact_id, revision_no)
);
create index if not exists artifact_revisions_lookup_idx on artifact_revisions(artifact_id, revision_no desc);
create table if not exists decisions(
  id integer primary key autoincrement,
  requirement_id integer not null references requirements(id) on delete cascade,
  run_id integer not null references runs(id) on delete cascade,
  title text not null,
  question text not null default '',
  severity text not null default 'major',
  status text not null default 'open',
  selected_option_id integer,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);
create table if not exists decision_options(
  id integer primary key autoincrement,
  decision_id integer not null references decisions(id) on delete cascade,
  title text not null,
  description text not null default '',
  created_at text not null default (datetime('now'))
);
create index if not exists decisions_requirement_idx on decisions(requirement_id, id desc);
create table if not exists findings(
  id integer primary key autoincrement,
  requirement_id integer not null references requirements(id) on delete cascade,
  run_id integer not null references runs(id) on delete cascade,
  severity text not null default 'medium',
  title text not null,
  content text not null default '{}',
  status text not null default 'open',
  created_at text not null default (datetime('now'))
);
create table if not exists approvals(
  id integer primary key autoincrement,
  requirement_id integer not null references requirements(id) on delete cascade,
  run_id integer not null references runs(id) on delete cascade,
  subject_type text not null,
  subject_id integer not null,
  decision text not null,
  actor text not null,
  reason text not null default '',
  diff text not null default '{}',
  created_at text not null default (datetime('now'))
);
create table if not exists trace_links(
  id integer primary key autoincrement,
  requirement_id integer not null references requirements(id) on delete cascade,
  run_id integer not null references runs(id) on delete cascade,
  source_type text not null,
  source_id integer not null,
  evidence_snapshot_id integer not null references evidence_snapshots(requirement_id) on delete cascade,
  file_path text not null,
  symbol text not null default '',
  line_start integer,
  line_end integer,
  node text not null default '{}',
  created_at text not null default (datetime('now'))
);
create index if not exists trace_links_source_idx on trace_links(source_type, source_id);
`;

export interface LegacyDatabase {
	db: Database.Database;
	close(): void;
}

export function createLegacyDatabase(dbPath: string): LegacyDatabase {
	mkdirSync(dirname(dbPath), { recursive: true });
	const db = new Database(dbPath);
	db.pragma("foreign_keys = ON");
	db.exec(LEGACY_SCHEMA);
	return {
		db,
		close() {
			db.close();
		},
	};
}

export function addLegacyWorkspace(
	db: Database.Database,
	repoPath: string,
	name: string,
): number {
	return Number(
		db
			.prepare("insert into workspaces(repo_path, name) values (?, ?)")
			.run(repoPath, name).lastInsertRowid,
	);
}

export function addLegacyRequirement(
	db: Database.Database,
	workspaceId: number,
	title: string,
	description: string,
	source = "",
): number {
	return Number(
		db
			.prepare(
				"insert into requirements(workspace_id, title, description, source) values (?, ?, ?, ?)",
			)
			.run(workspaceId, title, description, source).lastInsertRowid,
	);
}

export function createLegacyDesignSession(
	db: Database.Database,
	requirementId: number,
	sessionFile: string,
	sessionId: string,
): number {
	return Number(
		db
			.prepare(
				"insert into design_sessions(requirement_id, session_file, session_id) values (?, ?, ?)",
			)
			.run(requirementId, sessionFile, sessionId).lastInsertRowid,
	);
}

export function getLegacyDesignSession(
	db: Database.Database,
	requirementId: number,
): { id: number; session_file: string; status: string } | undefined {
	return db
		.prepare("select id, session_file, status from design_sessions where requirement_id = ?")
		.get(requirementId) as { id: number; session_file: string; status: string } | undefined;
}

export function archiveLegacyDesignSession(
	db: Database.Database,
	requirementId: number,
): void {
	db.prepare(
		"update design_sessions set status = 'archived', archived_at = datetime('now') where requirement_id = ?",
	).run(requirementId);
}

export function createLegacyRun(
	db: Database.Database,
	requirementId: number,
	sessionId: number,
	kind: string,
	prompt: string,
	sessionFile: string | null,
	parentRunId: number | null,
): number {
	return Number(
		db
			.prepare(
				"insert into runs(requirement_id, session_id, session_file, parent_run_id, kind, status, prompt) values (?, ?, ?, ?, ?, ?, ?)",
			)
			.run(
				requirementId,
				sessionId,
				sessionFile,
				parentRunId,
				kind,
				"queued",
				prompt,
			).lastInsertRowid,
	);
}

export function setLegacyRunStatus(
	db: Database.Database,
	runId: number,
	status: string,
	error: string | null = null,
): void {
	db.prepare(
		"update runs set status = ?, error = ?, started_at = case when ? = 'running' then datetime('now') else started_at end, finished_at = case when ? in ('completed','failed','cancelled') then datetime('now') else finished_at end where id = ?",
	).run(status, error, status, status, runId);
}

export function createLegacyArtifact(
	db: Database.Database,
	requirementId: number,
	kind: string,
	title: string,
): number {
	return Number(
		db
			.prepare(
				"insert into artifacts(requirement_id, kind, title) values (?, ?, ?)",
			)
			.run(requirementId, kind, title).lastInsertRowid,
	);
}

export function createLegacyArtifactRevision(
	db: Database.Database,
	artifactId: number,
	runId: number,
	content: unknown,
	status: string,
): number {
	const revisionNo = Number(
		(
			db
				.prepare(
					"select coalesce(max(revision_no), 0) + 1 as next from artifact_revisions where artifact_id = ?",
				)
				.get(artifactId) as { next: number }
		).next,
	);
	return Number(
		db
			.prepare(
				"insert into artifact_revisions(artifact_id, run_id, revision_no, content, status) values (?, ?, ?, ?, ?)",
			)
			.run(
				artifactId,
				runId,
				revisionNo,
				JSON.stringify(content),
				status,
			).lastInsertRowid,
	);
}

export function createLegacyDecision(
	db: Database.Database,
	requirementId: number,
	runId: number,
	title: string,
	question: string,
	severity: string,
): number {
	return Number(
		db
			.prepare(
				"insert into decisions(requirement_id, run_id, title, question, severity) values (?, ?, ?, ?, ?)",
			)
			.run(requirementId, runId, title, question, severity).lastInsertRowid,
	);
}

export function createLegacyFinding(
	db: Database.Database,
	requirementId: number,
	runId: number,
	severity: string,
	title: string,
	content: unknown,
): number {
	return Number(
		db
			.prepare(
				"insert into findings(requirement_id, run_id, severity, title, content) values (?, ?, ?, ?, ?)",
			)
			.run(
				requirementId,
				runId,
				severity,
				title,
				JSON.stringify(content),
			).lastInsertRowid,
	);
}

export function captureLegacyEvidenceSnapshot(
	db: Database.Database,
	requirementId: number,
	architecture: unknown,
	headSha: string,
	runId: number | null,
): void {
	db.prepare(
		`insert into evidence_snapshots(requirement_id, architecture, head_sha, run_id)
		 values (?, ?, ?, ?)
		 on conflict(requirement_id) do update set
		   architecture = excluded.architecture,
		   head_sha = excluded.head_sha,
		   run_id = excluded.run_id,
		   captured_at = datetime('now')`,
	).run(requirementId, JSON.stringify(architecture), headSha, runId);
}

export function addLegacyRequirementGene(
	db: Database.Database,
	requirementId: number,
	geneId: string,
	source: string,
): void {
	db.prepare(
		"insert or ignore into requirement_genes(requirement_id, gene_id, source) values (?, ?, ?)",
	).run(requirementId, geneId, source);
}

export function saveLegacyDesignPackage(
	db: Database.Database,
	requirementId: number,
	workspaceId: number,
	title: string,
	content: string,
	adr: string,
	runId: number | null,
	snapshot: unknown,
	status: string,
): number {
	return Number(
		db
			.prepare(
				`insert into design_packages(requirement_id, workspace_id, title, content, adr, run_id, snapshot, status)
				 values (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				requirementId,
				workspaceId,
				title,
				content,
				adr,
				runId,
				JSON.stringify(snapshot),
				status,
			).lastInsertRowid,
	);
}
