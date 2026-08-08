import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * store.ts — BaiZe 本地 SQLite 状态与设计资产库。
 *
 * 旧阶段资产表在切面 1 暂时保留；设计会话、Run、事件和锁是新的
 * Gateway 控制面，后续切面会把阶段资产迁移到 Artifact/Revision。
 */
export type Stage =
	| "录入"
	| "分析"
	| "场景"
	| "用例"
	| "功能分解"
	| "功能设计"
	| "归档";
export type StageStatus = "未开始" | "进行中" | "待审" | "打回" | "完成";
export type RunStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export interface DesignSessionRow {
	id: number;
	requirement_id: number;
	session_file: string;
	session_id: string;
	status: "active" | "archived";
	created_at: string;
	updated_at: string;
	archived_at: string | null;
}

export interface RunRow {
	id: number;
	requirement_id: number;
	session_id: number;
	kind: string;
	stage: string | null;
	status: RunStatus;
	prompt: string;
	error: string | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
}

export interface RunEventRow {
	id: number;
	run_id: number;
	seq: number;
	type: string;
	payload: unknown;
	created_at: string;
}

export type ArtifactKind =
    | "requirement"
    | "analysis"
    | "scenario"
    | "usecase"
    | "function"
    | "design"
    | "architecture"
    | "data"
    | "api";
export type ArtifactRevisionStatus = "draft" | "pending" | "approved" | "rejected";
export type DecisionStatus = "open" | "accepted" | "rejected" | "deferred";
export type ApprovalDecision = "approved" | "rejected";

export interface ArtifactRow {
    id: number;
    requirement_id: number;
    kind: ArtifactKind;
    title: string;
    created_at: string;
}

export interface ArtifactRevisionRow {
    id: number;
    artifact_id: number;
    run_id: number;
    revision_no: number;
    fork_from_revision_id: number | null;
    content: unknown;
    status: ArtifactRevisionStatus;
    created_at: string;
}

export interface DecisionRow {
    id: number;
    requirement_id: number;
    run_id: number;
    title: string;
    question: string;
    severity: string;
    status: DecisionStatus;
    selected_option_id: number | null;
    created_at: string;
    updated_at: string;
}

export interface DecisionOptionRow {
    id: number;
    decision_id: number;
    title: string;
    description: string;
    created_at: string;
}

export interface FindingRow {
    id: number;
    requirement_id: number;
    run_id: number;
    severity: string;
    title: string;
    content: unknown;
    status: string;
    created_at: string;
}

export interface ApprovalRow {
    id: number;
    requirement_id: number;
    run_id: number;
    subject_type: string;
    subject_id: number;
    decision: ApprovalDecision;
    actor: string;
    reason: string;
    diff: unknown;
    created_at: string;
}

export interface TraceLinkRow {
    id: number;
    requirement_id: number;
    run_id: number;
    source_type: string;
    source_id: number;
    evidence_snapshot_id: number;
    file_path: string;
    symbol: string;
    line_start: number | null;
    line_end: number | null;
    node: unknown;
    created_at: string;
}

export interface EvidenceSnapshotRow {
    requirement_id: number;
    run_id: number | null;
    architecture: unknown;
    head_sha: string;
    captured_at: string;
}

export interface DesignPackageRow {
    id: number;
    requirement_id: number;
    workspace_id: number;
    run_id: number | null;
    title: string;
    content: string;
    adr: string;
    snapshot: unknown;
    status: "draft" | "approved";
    archived_at: string;
}

export interface ToolCallRow {
    id: number;
    run_id: number;
    name: string;
    input: unknown;
    output: unknown;
    status: "running" | "completed" | "failed";
    error: string | null;
    started_at: string;
    finished_at: string | null;
}

export class RunInProgressError extends Error {
	readonly code = "RUN_IN_PROGRESS";

	constructor(readonly runId: number) {
		super(`requirement already has an active run: ${runId}`);
		this.name = "RunInProgressError";
	}
}

const SCHEMA = `
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
create table if not exists stage_progress(
  requirement_id integer not null references requirements(id),
  stage text not null,
  status text not null default '未开始',
  artifact_refs text not null default '[]',
  feedback text not null default '',
  updated_at text not null default (datetime('now')),
  primary key (requirement_id, stage)
);
create table if not exists scenarios(
  id integer primary key autoincrement,
  workspace_id integer not null references workspaces(id),
  title text not null,
  description text not null default ''
);
create table if not exists use_cases(
  id integer primary key autoincrement,
  workspace_id integer not null references workspaces(id),
  scenario_id integer references scenarios(id),
  title text not null default '',
  precondition text not null default '',
  main_flow text not null default '',
  exceptions text not null default '',
  postcondition text not null default ''
);
create table if not exists function_domains(
  id integer primary key autoincrement,
  workspace_id integer not null references workspaces(id),
  name text not null,
  description text not null default ''
);
create table if not exists function_items(
  id integer primary key autoincrement,
  workspace_id integer not null references workspaces(id),
  domain_id integer references function_domains(id),
  title text not null,
  description text not null default ''
);
create table if not exists requirement_scenarios(
  requirement_id integer not null references requirements(id),
  scenario_id integer not null references scenarios(id),
  primary key (requirement_id, scenario_id)
);
create table if not exists usecase_functions(
  usecase_id integer not null references use_cases(id),
  function_item_id integer not null references function_items(id),
  primary key (usecase_id, function_item_id)
);
create table if not exists evidence_snapshots(
  requirement_id integer primary key references requirements(id),
  architecture text not null default '{}',
  head_sha text not null default '',
  captured_at text not null default (datetime('now'))
);
create table if not exists design_packages(
  id integer primary key autoincrement,
  requirement_id integer not null references requirements(id),
  workspace_id integer not null references workspaces(id),
  title text not null default '',
  content text not null default '',
  adr text not null default '',
  archived_at text not null default (datetime('now'))
);
create table if not exists requirement_genes(
  requirement_id integer not null references requirements(id),
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
  kind text not null,
  stage text,
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

const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
	"completed",
	"failed",
	"cancelled",
]);

export class Store {
	db: Database.Database;

	constructor(dbPath: string) {
		mkdirSync(dirname(dbPath), { recursive: true });
		this.db = new Database(dbPath);
		this.db.pragma("foreign_keys = ON");
		this.db.exec(SCHEMA);
		// 老库补 feedback 列；列已存在则忽略。
		try {
			this.db.exec(
				"alter table stage_progress add column feedback text not null default ''",
			);
		} catch {
			/* already exists */
		}
		this.addColumnIfMissing("evidence_snapshots", "run_id", "integer references runs(id)");
		this.addColumnIfMissing("design_packages", "run_id", "integer references runs(id)");
		this.addColumnIfMissing("design_packages", "snapshot", "text not null default '{}'");
		this.addColumnIfMissing("design_packages", "status", "text not null default 'draft'");
	}

	private addColumnIfMissing(table: string, column: string, definition: string): void {
		try {
			this.db.exec(`alter table ${table} add column ${column} ${definition}`);
		} catch {
			/* column already exists */
		}
	}

	// workspaces
	addWorkspace(repoPath: string, name: string): number {
		return Number(
			this.db
				.prepare("insert into workspaces(repo_path, name) values (?, ?)")
				.run(repoPath, name).lastInsertRowid,
		);
	}
	listWorkspaces(): unknown[] {
		return this.db.prepare("select * from workspaces order by id").all();
	}

	renameWorkspace(id: number, name: string): void {
		this.db
			.prepare("update workspaces set name = ? where id = ?")
			.run(name, id);
	}

	deleteWorkspace(id: number): void {
		this.transaction(() => {
		const reqIds = (
			this.db
				.prepare("select id from requirements where workspace_id = ?")
				.all(id) as Array<{ id: number }>
		).map((r) => r.id);
		for (const rid of reqIds) {
			this.db
				.prepare(
					"delete from run_events where run_id in (select id from runs where requirement_id = ?)",
				)
				.run(rid);
			this.db
				.prepare("delete from run_locks where requirement_id = ?")
				.run(rid);
			this.db.prepare("delete from evidence_snapshots where requirement_id = ?").run(rid);
			this.db.prepare("delete from design_packages where requirement_id = ?").run(rid);
			this.db.prepare("delete from runs where requirement_id = ?").run(rid);
			this.db
				.prepare("delete from design_sessions where requirement_id = ?")
				.run(rid);
			this.db
				.prepare("delete from stage_progress where requirement_id = ?")
				.run(rid);
			this.db
				.prepare("delete from requirement_genes where requirement_id = ?")
				.run(rid);
			this.db
				.prepare("delete from requirement_scenarios where requirement_id = ?")
				.run(rid);
		}
		this.db.prepare("delete from requirements where workspace_id = ?").run(id);
		const ucIds = (
			this.db
				.prepare("select id from use_cases where workspace_id = ?")
				.all(id) as Array<{ id: number }>
		).map((r) => r.id);
		for (const u of ucIds)
			this.db
				.prepare("delete from usecase_functions where usecase_id = ?")
				.run(u);
		const fnIds = (
			this.db
				.prepare("select id from function_items where workspace_id = ?")
				.all(id) as Array<{ id: number }>
		).map((r) => r.id);
		for (const f of fnIds)
			this.db
				.prepare("delete from usecase_functions where function_item_id = ?")
				.run(f);
		this.db.prepare("delete from use_cases where workspace_id = ?").run(id);
		this.db
			.prepare("delete from function_items where workspace_id = ?")
			.run(id);
		this.db
			.prepare("delete from function_domains where workspace_id = ?")
			.run(id);
		this.db.prepare("delete from scenarios where workspace_id = ?").run(id);
		this.db.prepare("delete from workspaces where id = ?").run(id);
		});
	}

	// requirements
	addRequirement(
		workspaceId: number,
		title: string,
		description = "",
		source = "",
	): number {
		return Number(
			this.db
				.prepare(
					"insert into requirements(workspace_id, title, description, source) values (?, ?, ?, ?)",
				)
				.run(workspaceId, title, description, source).lastInsertRowid,
		);
	}
	listRequirements(workspaceId: number): unknown[] {
		return this.db
			.prepare("select * from requirements where workspace_id = ? order by id")
			.all(workspaceId);
	}
	getRequirement(id: number): unknown {
		return this.db.prepare("select * from requirements where id = ?").get(id);
	}
	getWorkspace(id: number): unknown {
		return this.db.prepare("select * from workspaces where id = ?").get(id);
	}
	counts(): Record<string, number> {
		const t = (name: string): number =>
			(this.db.prepare(`select count(*) c from ${name}`).get() as { c: number })
				.c;
		return {
			workspaces: t("workspaces"),
			requirements: t("requirements"),
			scenarios: t("scenarios"),
			use_cases: t("use_cases"),
			function_domains: t("function_domains"),
			function_items: t("function_items"),
			design_sessions: t("design_sessions"),
			runs: t("runs"),
			run_events: t("run_events"),
			artifacts: t("artifacts"),
			artifact_revisions: t("artifact_revisions"),
			decisions: t("decisions"),
			decision_options: t("decision_options"),
			findings: t("findings"),
			approvals: t("approvals"),
			trace_links: t("trace_links"),
			tool_calls: t("tool_calls"),
		};
	}

	transaction<T>(fn: () => T): T {
		return this.db.transaction(fn)();
	}

	private encodeJson(value: unknown): string {
		return JSON.stringify(value ?? {});
	}

	private decodeJson(value: string): unknown {
		try {
			return JSON.parse(value);
		} catch {
			return { raw: value };
		}
	}

	startToolCall(runId: number, name: string, input: unknown): number {
		return Number(
			this.db
				.prepare("insert into tool_calls(run_id, name, input) values (?, ?, ?)")
				.run(runId, name, this.encodeJson(input)).lastInsertRowid,
		);
	}

	finishToolCall(
		id: number,
		status: "completed" | "failed",
		output: unknown = {},
		error: string | null = null,
	): void {
		this.db
			.prepare(
				"update tool_calls set status = ?, output = ?, error = ?, finished_at = datetime('now') where id = ?",
			)
			.run(status, this.encodeJson(output), error, id);
	}

	listToolCalls(runId: number): ToolCallRow[] {
		const rows = this.db
			.prepare("select * from tool_calls where run_id = ? order by id")
			.all(runId) as Array<Omit<ToolCallRow, "input" | "output"> & { input: string; output: string }>;
		return rows.map((row) => ({
			...row,
			input: this.decodeJson(row.input),
			output: this.decodeJson(row.output),
		}));
	}

	// ---- artifact / revision domain kernel ----
	createArtifact(requirementId: number, kind: ArtifactKind, title = ""): ArtifactRow {
		const id = Number(
			this.db
				.prepare("insert into artifacts(requirement_id, kind, title) values (?, ?, ?)")
				.run(requirementId, kind, title).lastInsertRowid,
		);
		return this.getArtifact(id) as ArtifactRow;
	}

	getArtifact(id: number): ArtifactRow | undefined {
		return this.db.prepare("select * from artifacts where id = ?").get(id) as
			| ArtifactRow
			| undefined;
	}

	listArtifacts(requirementId: number): ArtifactRow[] {
		return this.db
			.prepare("select * from artifacts where requirement_id = ? order by id")
			.all(requirementId) as ArtifactRow[];
	}

	createArtifactRevision(
		artifactId: number,
		runId: number,
		content: unknown,
		status: ArtifactRevisionStatus = "draft",
		forkFromRevisionId: number | null = null,
	): ArtifactRevisionRow {
		const create = this.db.transaction(() => {
			const artifact = this.getArtifact(artifactId);
			if (!artifact) throw new Error(`artifact not found: ${artifactId}`);
			if (!this.getRun(runId)) throw new Error(`run not found: ${runId}`);
			if (forkFromRevisionId !== null) {
				const fork = this.getArtifactRevision(forkFromRevisionId);
				if (!fork || fork.artifact_id !== artifactId) {
					throw new Error("fork revision must belong to the same artifact");
				}
			}
			const revisionNo = (
				this.db
					.prepare(
						"select coalesce(max(revision_no), 0) + 1 as revision_no from artifact_revisions where artifact_id = ?",
					)
					.get(artifactId) as { revision_no: number }
			).revision_no;
			return Number(
				this.db
					.prepare(
						"insert into artifact_revisions(artifact_id, run_id, revision_no, fork_from_revision_id, content, status) values (?, ?, ?, ?, ?, ?)",
					)
					.run(
						artifactId,
						runId,
						revisionNo,
						forkFromRevisionId,
						this.encodeJson(content),
						status,
					).lastInsertRowid,
			);
		});
		return this.getArtifactRevision(create()) as ArtifactRevisionRow;
	}

	getArtifactRevision(id: number): ArtifactRevisionRow | undefined {
		const row = this.db.prepare("select * from artifact_revisions where id = ?").get(id) as
			| (Omit<ArtifactRevisionRow, "content"> & { content: string })
			| undefined;
		return row ? { ...row, content: this.decodeJson(row.content) } : undefined;
	}

	listArtifactRevisions(artifactId: number): ArtifactRevisionRow[] {
		const rows = this.db
			.prepare("select * from artifact_revisions where artifact_id = ? order by revision_no")
			.all(artifactId) as Array<Omit<ArtifactRevisionRow, "content"> & { content: string }>;
		return rows.map((row) => ({ ...row, content: this.decodeJson(row.content) }));
	}

	createDecision(
		requirementId: number,
		runId: number,
		title: string,
		question = "",
		severity = "major",
	): DecisionRow {
		const id = Number(
			this.db
				.prepare(
					"insert into decisions(requirement_id, run_id, title, question, severity) values (?, ?, ?, ?, ?)",
				)
				.run(requirementId, runId, title, question, severity).lastInsertRowid,
		);
		return this.getDecision(id) as DecisionRow;
	}

	getDecision(id: number): DecisionRow | undefined {
		return this.db.prepare("select * from decisions where id = ?").get(id) as
			| DecisionRow
			| undefined;
	}

	listDecisions(requirementId: number): DecisionRow[] {
		return this.db
			.prepare("select * from decisions where requirement_id = ? order by id")
			.all(requirementId) as DecisionRow[];
	}

	addDecisionOption(decisionId: number, title: string, description = ""): DecisionOptionRow {
		const id = Number(
			this.db
				.prepare(
					"insert into decision_options(decision_id, title, description) values (?, ?, ?)",
				)
				.run(decisionId, title, description).lastInsertRowid,
		);
		return this.getDecisionOption(id) as DecisionOptionRow;
	}

	getDecisionOption(id: number): DecisionOptionRow | undefined {
		return this.db.prepare("select * from decision_options where id = ?").get(id) as
			| DecisionOptionRow
			| undefined;
	}

	listDecisionOptions(decisionId: number): DecisionOptionRow[] {
		return this.db
			.prepare("select * from decision_options where decision_id = ? order by id")
			.all(decisionId) as DecisionOptionRow[];
	}

	selectDecisionOption(decisionId: number, optionId: number): DecisionRow {
		const option = this.getDecisionOption(optionId);
		if (!option || option.decision_id !== decisionId) {
			throw new Error("decision option must belong to the decision");
		}
		this.db
			.prepare(
				"update decisions set selected_option_id = ?, status = 'accepted', updated_at = datetime('now') where id = ?",
			)
			.run(optionId, decisionId);
		return this.getDecision(decisionId) as DecisionRow;
	}

	setDecisionStatus(decisionId: number, status: DecisionStatus): DecisionRow {
		this.db
			.prepare("update decisions set status = ?, updated_at = datetime('now') where id = ?")
			.run(status, decisionId);
		return this.getDecision(decisionId) as DecisionRow;
	}

	createFinding(
		requirementId: number,
		runId: number,
		severity: string,
		title: string,
		content: unknown = {},
	): FindingRow {
		const id = Number(
			this.db
				.prepare(
					"insert into findings(requirement_id, run_id, severity, title, content) values (?, ?, ?, ?, ?)",
				)
				.run(requirementId, runId, severity, title, this.encodeJson(content)).lastInsertRowid,
		);
		return this.getFinding(id) as FindingRow;
	}

	getFinding(id: number): FindingRow | undefined {
		const row = this.db.prepare("select * from findings where id = ?").get(id) as
			| (Omit<FindingRow, "content"> & { content: string })
			| undefined;
		return row ? { ...row, content: this.decodeJson(row.content) } : undefined;
	}

	listFindings(requirementId: number): FindingRow[] {
		const rows = this.db
			.prepare("select * from findings where requirement_id = ? order by id")
			.all(requirementId) as Array<Omit<FindingRow, "content"> & { content: string }>;
		return rows.map((row) => ({ ...row, content: this.decodeJson(row.content) }));
	}

	createApproval(
		requirementId: number,
		runId: number,
		subjectType: string,
		subjectId: number,
		decision: ApprovalDecision,
		actor: string,
		reason = "",
		diff: unknown = {},
	): ApprovalRow {
		const id = Number(
			this.db
				.prepare(
					"insert into approvals(requirement_id, run_id, subject_type, subject_id, decision, actor, reason, diff) values (?, ?, ?, ?, ?, ?, ?, ?)",
				)
				.run(
					requirementId,
					runId,
					subjectType,
					subjectId,
					decision,
					actor,
					reason,
					this.encodeJson(diff),
				).lastInsertRowid,
		);
		return this.getApproval(id) as ApprovalRow;
	}

	getApproval(id: number): ApprovalRow | undefined {
		const row = this.db.prepare("select * from approvals where id = ?").get(id) as
			| (Omit<ApprovalRow, "diff"> & { diff: string })
			| undefined;
		return row ? { ...row, diff: this.decodeJson(row.diff) } : undefined;
	}

	listApprovals(requirementId: number): ApprovalRow[] {
		const rows = this.db
			.prepare("select * from approvals where requirement_id = ? order by id")
			.all(requirementId) as Array<Omit<ApprovalRow, "diff"> & { diff: string }>;
		return rows.map((row) => ({ ...row, diff: this.decodeJson(row.diff) }));
	}

	createTraceLink(
		requirementId: number,
		runId: number,
		sourceType: string,
		sourceId: number,
		evidenceSnapshotId: number,
		filePath: string,
		symbol = "",
		lineStart: number | null = null,
		lineEnd: number | null = null,
		node: unknown = {},
	): TraceLinkRow {
		const snapshot = this.db
			.prepare("select requirement_id from evidence_snapshots where requirement_id = ?")
			.get(evidenceSnapshotId);
		if (!snapshot) throw new Error(`evidence snapshot not found: ${evidenceSnapshotId}`);
		const id = Number(
			this.db
				.prepare(
					"insert into trace_links(requirement_id, run_id, source_type, source_id, evidence_snapshot_id, file_path, symbol, line_start, line_end, node) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
				)
				.run(
					requirementId,
					runId,
					sourceType,
					sourceId,
					evidenceSnapshotId,
					filePath,
					symbol,
					lineStart,
					lineEnd,
					this.encodeJson(node),
				).lastInsertRowid,
		);
		return this.getTraceLink(id) as TraceLinkRow;
	}

	getTraceLink(id: number): TraceLinkRow | undefined {
		const row = this.db.prepare("select * from trace_links where id = ?").get(id) as
			| (Omit<TraceLinkRow, "node"> & { node: string })
			| undefined;
		return row ? { ...row, node: this.decodeJson(row.node) } : undefined;
	}

	listTraceLinks(requirementId: number): TraceLinkRow[] {
		const rows = this.db
			.prepare("select * from trace_links where requirement_id = ? order by id")
			.all(requirementId) as Array<Omit<TraceLinkRow, "node"> & { node: string }>;
		return rows.map((row) => ({ ...row, node: this.decodeJson(row.node) }));
	}
	// stage progress (upsert)
	setStage(
		requirementId: number,
		stage: Stage,
		status: StageStatus,
		artifactRefs: unknown[] = [],
		feedback = "",
	): void {
		this.db
			.prepare(
				`insert into stage_progress(requirement_id, stage, status, artifact_refs, feedback, updated_at)
				 values (?, ?, ?, ?, ?, datetime('now'))
				 on conflict(requirement_id, stage)
				 do update set status = excluded.status,
				               artifact_refs = excluded.artifact_refs,
				               feedback = excluded.feedback,
				               updated_at = excluded.updated_at`,
			)
			.run(
				requirementId,
				stage,
				status,
				JSON.stringify(artifactRefs),
				feedback,
			);
	}
	getStages(requirementId: number): unknown[] {
		return this.db
			.prepare(
				"select * from stage_progress where requirement_id = ? order by stage",
			)
			.all(requirementId);
	}

	// ---- design session / run control plane ----
	getDesignSession(requirementId: number): DesignSessionRow | undefined {
		return this.db
			.prepare("select * from design_sessions where requirement_id = ?")
			.get(requirementId) as DesignSessionRow | undefined;
	}

	createDesignSession(
		requirementId: number,
		sessionFile: string,
		sessionId: string,
	): DesignSessionRow {
		const existing = this.getDesignSession(requirementId);
		if (existing) {
			this.db
				.prepare(
					"update design_sessions set session_file = ?, session_id = ?, status = 'active', archived_at = null, updated_at = datetime('now') where id = ?",
				)
				.run(sessionFile, sessionId, existing.id);
			return this.getDesignSession(requirementId) as DesignSessionRow;
		}
		const id = Number(
			this.db
				.prepare(
					"insert into design_sessions(requirement_id, session_file, session_id) values (?, ?, ?)",
				)
				.run(requirementId, sessionFile, sessionId).lastInsertRowid,
		);
		return this.db
			.prepare("select * from design_sessions where id = ?")
			.get(id) as DesignSessionRow;
	}

	archiveDesignSession(requirementId: number): void {
		this.db
			.prepare(
				"update design_sessions set status = 'archived', archived_at = datetime('now'), updated_at = datetime('now') where requirement_id = ?",
			)
			.run(requirementId);
	}

	private appendRunEventUnsafe(
		runId: number,
		type: string,
		payload: unknown,
	): RunEventRow {
		const next = (
			this.db
				.prepare(
					"select coalesce(max(seq), 0) + 1 as seq from run_events where run_id = ?",
				)
				.get(runId) as { seq: number }
		).seq;
		const result = this.db
			.prepare(
				"insert into run_events(run_id, seq, type, payload) values (?, ?, ?, ?)",
			)
			.run(runId, next, type, JSON.stringify(payload ?? {}));
		return {
			id: Number(result.lastInsertRowid),
			run_id: runId,
			seq: next,
			type,
			payload,
			created_at: new Date().toISOString(),
		};
	}

	appendRunEvent(
		runId: number,
		type: string,
		payload: unknown = {},
	): RunEventRow {
		const append = this.db.transaction(() =>
			this.appendRunEventUnsafe(runId, type, payload),
		);
		return append();
	}

	listRunEvents(runId: number, afterSeq = 0): RunEventRow[] {
		const rows = this.db
			.prepare(
				"select * from run_events where run_id = ? and seq > ? order by seq",
			)
			.all(runId, afterSeq) as Array<
			Omit<RunEventRow, "payload"> & { payload: string }
		>;
		return rows.map((row) => ({
			...row,
			payload: this.parsePayload(row.payload),
		}));
	}

	private parsePayload(payload: string): unknown {
		try {
			return JSON.parse(payload);
		} catch {
			return { raw: payload };
		}
	}

	createRun(
		requirementId: number,
		sessionId: number,
		kind: string,
		stage: string | null = null,
		prompt = "",
	): RunRow {
		const create = this.db.transaction(() => {
			const active = this.db
				.prepare("select run_id from run_locks where requirement_id = ?")
				.get(requirementId) as { run_id: number } | undefined;
			if (active) throw new RunInProgressError(active.run_id);
			const result = this.db
				.prepare(
					"insert into runs(requirement_id, session_id, kind, stage, prompt) values (?, ?, ?, ?, ?)",
				)
				.run(requirementId, sessionId, kind, stage, prompt);
			const runId = Number(result.lastInsertRowid);
			this.db
				.prepare("insert into run_locks(requirement_id, run_id) values (?, ?)")
				.run(requirementId, runId);
			this.appendRunEventUnsafe(runId, "run_queued", { status: "queued" });
			return runId;
		});
		return this.getRun(create()) as RunRow;
	}

	getRun(runId: number): RunRow | undefined {
		return this.db.prepare("select * from runs where id = ?").get(runId) as
			| RunRow
			| undefined;
	}

	listRuns(requirementId: number, limit = 50): RunRow[] {
		return this.db
			.prepare(
				"select * from runs where requirement_id = ? order by id desc limit ?",
			)
			.all(requirementId, limit) as RunRow[];
	}

	getActiveRun(requirementId: number): RunRow | undefined {
		return this.db
			.prepare(
				"select r.* from runs r join run_locks l on l.run_id = r.id where r.requirement_id = ?",
			)
			.get(requirementId) as RunRow | undefined;
	}

	setRunStatus(
		runId: number,
		status: RunStatus,
		error: string | null = null,
	): void {
		const update = this.db.transaction(() => {
			this.db
				.prepare(
					`update runs
					 set status = ?, error = ?,
					     started_at = case when ? = 'running' and started_at is null then datetime('now') else started_at end,
					     finished_at = case when ? in ('completed', 'failed', 'cancelled') then datetime('now') else finished_at end
					 where id = ?`,
				)
				.run(status, error, status, status, runId);
			this.appendRunEventUnsafe(runId, "run_status", { status, error });
			if (TERMINAL_RUN_STATUSES.has(status)) {
				this.db.prepare("delete from run_locks where run_id = ?").run(runId);
			}
		});
		update();
	}

	recoverActiveRuns(): number[] {
		const recover = this.db.transaction(() => {
			const rows = this.db
				.prepare("select id from runs where status in ('queued', 'running')")
				.all() as Array<{ id: number }>;
			for (const row of rows) {
				this.db
					.prepare(
						"update runs set status = 'failed', error = ?, finished_at = datetime('now') where id = ?",
					)
					.run("Gateway restarted before Run completed", row.id);
				this.appendRunEventUnsafe(row.id, "run_recovered", {
					status: "failed",
					error: "Gateway restarted before Run completed",
				});
				this.db.prepare("delete from run_locks where run_id = ?").run(row.id);
			}
			return rows.map((row) => row.id);
		});
		return recover();
	}

	// scenarios (reuse pool)
	addScenario(workspaceId: number, title: string, description = ""): number {
		return Number(
			this.db
				.prepare(
					"insert into scenarios(workspace_id, title, description) values (?, ?, ?)",
				)
				.run(workspaceId, title, description).lastInsertRowid,
		);
	}
	listScenarios(workspaceId: number): unknown[] {
		return this.db
			.prepare("select * from scenarios where workspace_id = ? order by id")
			.all(workspaceId);
	}
	linkRequirementScenario(requirementId: number, scenarioId: number): void {
		this.db
			.prepare(
				"insert or ignore into requirement_scenarios(requirement_id, scenario_id) values (?, ?)",
			)
			.run(requirementId, scenarioId);
	}

	// use cases (scenario 1→N)
	addUseCase(
		workspaceId: number,
		scenarioId: number | null,
		title: string,
		flows: {
			precondition?: string;
			mainFlow?: string;
			exceptions?: string;
			postcondition?: string;
		} = {},
	): number {
		return Number(
			this.db
				.prepare(
					`insert into use_cases(workspace_id, scenario_id, title, precondition, main_flow, exceptions, postcondition)
					 values (?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					workspaceId,
					scenarioId,
					title,
					flows.precondition ?? "",
					flows.mainFlow ?? "",
					flows.exceptions ?? "",
					flows.postcondition ?? "",
				).lastInsertRowid,
		);
	}
	listUseCases(scenarioId: number): unknown[] {
		return this.db
			.prepare("select * from use_cases where scenario_id = ? order by id")
			.all(scenarioId);
	}

	// function domains / items (域→项)
	addFunctionDomain(
		workspaceId: number,
		name: string,
		description = "",
	): number {
		return Number(
			this.db
				.prepare(
					"insert into function_domains(workspace_id, name, description) values (?, ?, ?)",
				)
				.run(workspaceId, name, description).lastInsertRowid,
		);
	}
	listFunctionDomains(workspaceId: number): unknown[] {
		return this.db
			.prepare(
				"select * from function_domains where workspace_id = ? order by id",
			)
			.all(workspaceId);
	}
	addFunctionItem(
		workspaceId: number,
		domainId: number | null,
		title: string,
		description = "",
	): number {
		return Number(
			this.db
				.prepare(
					"insert into function_items(workspace_id, domain_id, title, description) values (?, ?, ?, ?)",
				)
				.run(workspaceId, domainId, title, description).lastInsertRowid,
		);
	}
	listFunctionItems(domainId: number): unknown[] {
		return this.db
			.prepare("select * from function_items where domain_id = ? order by id")
			.all(domainId);
	}
	linkUseCaseFunction(usecaseId: number, functionItemId: number): void {
		this.db
			.prepare(
				"insert or ignore into usecase_functions(usecase_id, function_item_id) values (?, ?)",
			)
			.run(usecaseId, functionItemId);
	}

	// 打回重跑前清理旧资产(避免复用池堆积重复项)
	deleteScenario(id: number): void {
		this.db
			.prepare("delete from requirement_scenarios where scenario_id = ?")
			.run(id);
		this.db.prepare("delete from scenarios where id = ?").run(id);
	}
	deleteUseCase(id: number): void {
		this.db
			.prepare("delete from usecase_functions where usecase_id = ?")
			.run(id);
		this.db.prepare("delete from use_cases where id = ?").run(id);
	}
	deleteFunctionItem(id: number): void {
		this.db
			.prepare("delete from usecase_functions where function_item_id = ?")
			.run(id);
		this.db.prepare("delete from function_items where id = ?").run(id);
	}
	deleteFunctionDomain(id: number): void {
		this.db.prepare("delete from function_items where domain_id = ?").run(id);
		this.db.prepare("delete from function_domains where id = ?").run(id);
	}

	// ---- evidence snapshot / design package / requirement genes ----
	captureEvidenceSnapshot(
		requirementId: number,
		architecture: unknown,
		headSha: string,
		runId: number | null = null,
	): void {
		this.db
			.prepare(
				"insert into evidence_snapshots(requirement_id, run_id, architecture, head_sha) values (?, ?, ?, ?) on conflict(requirement_id) do update set run_id=excluded.run_id, architecture=excluded.architecture, head_sha=excluded.head_sha, captured_at=datetime('now')",
			)
			.run(requirementId, runId, JSON.stringify(architecture ?? {}), headSha);
	}
	getEvidenceSnapshot(requirementId: number): unknown {
		return this.db
			.prepare("select * from evidence_snapshots where requirement_id = ?")
			.get(requirementId);
	}
	saveDesignPackage(
		requirementId: number,
		workspaceId: number,
		title: string,
		content: string,
		adr: string,
		runId: number | null = null,
		snapshot: unknown = {},
		status: "draft" | "approved" = "draft",
	): number {
		return Number(
			this.db
				.prepare(
					"insert into design_packages(requirement_id, workspace_id, run_id, title, content, adr, snapshot, status) values (?, ?, ?, ?, ?, ?, ?, ?)",
				)
				.run(
					requirementId,
					workspaceId,
					runId,
					title,
					content,
					adr,
					this.encodeJson(snapshot),
					status,
				).lastInsertRowid,
		);
	}
	getDesignPackageByReq(requirementId: number): unknown {
		return this.db
			.prepare(
				"select * from design_packages where requirement_id = ? order by id desc limit 1",
			)
			.get(requirementId);
	}
	listDesignPackages(workspaceId: number): unknown[] {
		return this.db
			.prepare(
				"select * from design_packages where workspace_id = ? order by id desc",
			)
			.all(workspaceId);
	}
	addRequirementGene(
		requirementId: number,
		geneId: string,
		source: string,
	): void {
		this.db
			.prepare(
				"insert or ignore into requirement_genes(requirement_id, gene_id, source) values (?, ?, ?)",
			)
			.run(requirementId, geneId, source);
	}
	removeRequirementGene(requirementId: number, geneId: string): void {
		this.db
			.prepare(
				"delete from requirement_genes where requirement_id = ? and gene_id = ?",
			)
			.run(requirementId, geneId);
	}
	listRequirementGenes(requirementId: number): unknown[] {
		return this.db
			.prepare(
				"select * from requirement_genes where requirement_id = ? order by rowid",
			)
			.all(requirementId);
	}

	close(): void {
		this.db.close();
	}
}

export function openStore(dbPath: string): Store {
	return new Store(dbPath);
}
