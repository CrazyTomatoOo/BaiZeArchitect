import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * store.ts — 设计资产库 SQLite(better-sqlite3 v13)。T01 领域模型的落库。
 * workspace=1 repo;资产(场景/用例/功能)为 workspace 级复用池。
 * ponytail: 单全局 DB(workspaceId 列分 scope),同步 API,小规模本地库足够。
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
`;

export class Store {
	db: Database.Database;

	constructor(dbPath: string) {
		mkdirSync(dirname(dbPath), { recursive: true });
		this.db = new Database(dbPath);
		this.db.exec(SCHEMA);
		// ponytail: 老库补 feedback 列;列已存在则忽略
		try {
			this.db.exec(
				"alter table stage_progress add column feedback text not null default ''",
			);
		} catch {
			/* already exists */
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
			(this.db.prepare(`select count(*) c from ${name}`).get() as { c: number }).c;
		return {
			workspaces: t("workspaces"),
			requirements: t("requirements"),
			scenarios: t("scenarios"),
			use_cases: t("use_cases"),
			function_domains: t("function_domains"),
			function_items: t("function_items"),
		};
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
			.run(requirementId, stage, status, JSON.stringify(artifactRefs), feedback);
	}
	getStages(requirementId: number): unknown[] {
		return this.db
			.prepare(
				"select * from stage_progress where requirement_id = ? order by stage",
			)
			.all(requirementId);
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
		this.db.prepare("delete from requirement_scenarios where scenario_id = ?").run(id);
		this.db.prepare("delete from scenarios where id = ?").run(id);
	}
	deleteUseCase(id: number): void {
		this.db.prepare("delete from usecase_functions where usecase_id = ?").run(id);
		this.db.prepare("delete from use_cases where id = ?").run(id);
	}
	deleteFunctionItem(id: number): void {
		this.db.prepare("delete from usecase_functions where function_item_id = ?").run(id);
		this.db.prepare("delete from function_items where id = ?").run(id);
	}
	deleteFunctionDomain(id: number): void {
		this.db.prepare("delete from function_items where domain_id = ?").run(id);
		this.db.prepare("delete from function_domains where id = ?").run(id);
	}
}

export function openStore(dbPath: string): Store {
	return new Store(dbPath);
}
