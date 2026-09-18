import { randomUUID } from "node:crypto";
import { AnalysisFailureError, type AnalysisFailureCode } from "./errors.ts";
import { SqlitePool, type QueryResult } from "./sqlite.ts";

export { SqlitePool };
export type { QueryResult };

export interface AnalysisRun {
  id: string;
  requirement: string;
}

export type AnalysisRunStatus =
  | "running"
  | "awaiting_confirmation"
  | "succeeded"
  | "rejected"
  | "failed"
  | "cancelled";

export type AnalysisRunStage = "scenario" | "use_case" | "feature";

export interface AnalysisRunRecord extends AnalysisRun {
  status: AnalysisRunStatus;
  currentStage: AnalysisRunStage | null;
}

export interface ScenarioNode {
  id: string;
  parentId: string | null;
  name: string;
  description: string;
}

export interface ScenarioProposalInput {
  kind: "related" | "new";
  title: string;
  description: string;
}

export interface ScenarioProposalRecord extends ScenarioProposalInput {
  status: "proposed" | "confirmed" | "rejected";
}

export interface ScenarioAsset {
  id: string;
  kind: "related" | "new";
  title: string;
  description: string;
  scenarioId: string;
}

export interface UseCaseNode {
  id: string;
  scenarioId: string;
  scenarioName: string;
  title: string;
  description: string;
}

export interface UseCaseProposalInput {
  kind: "related" | "new";
  title: string;
  description: string;
  scenarioTitle: string;
}

export interface UseCaseProposalRecord extends UseCaseProposalInput {
  status: "proposed" | "confirmed" | "rejected";
}

export interface UseCaseAsset {
  id: string;
  kind: "related" | "new";
  title: string;
  description: string;
}

export interface FeatureNode {
  id: string;
  title: string;
  description: string;
}

export interface FeatureProposalInput {
  kind: "affected" | "new";
  title: string;
  description: string;
  useCaseTitle: string;
}

export interface FeatureProposalRecord extends FeatureProposalInput {
  status: "proposed" | "confirmed" | "rejected";
}

export interface FeatureAsset {
  id: string;
  kind: "affected" | "new";
  title: string;
  description: string;
}

interface ScenarioProposalRow {
  id: string;
  existing_scenario_id: string | null;
  title: string;
  description: string;
  kind: "related" | "new";
}

interface UseCaseProposalRow {
  id: string;
  existing_use_case_id: string | null;
  scenario_asset_id: string;
  title: string;
  description: string;
  kind: "related" | "new";
  scenario_id: string;
}

interface FeatureProposalRow {
  id: string;
  existing_feature_id: string | null;
  use_case_asset_id: string;
  title: string;
  description: string;
  kind: "affected" | "new";
}

export async function initializeSchema(pool: SqlitePool): Promise<void> {
  pool.database.exec(`
    CREATE TABLE IF NOT EXISTS analysis_runs (
      id TEXT PRIMARY KEY,
      requirement TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN (
          'running',
          'awaiting_confirmation',
          'succeeded',
          'rejected',
          'failed',
          'cancelled'
        )),
      current_stage TEXT DEFAULT NULL
        CHECK (current_stage IS NULL OR current_stage IN (
          'scenario',
          'use_case',
          'feature'
        )),
      failure_code TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      CHECK (
        status <> 'awaiting_confirmation' OR current_stage IS NOT NULL
      )
    );

    CREATE TABLE IF NOT EXISTS trace_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS trace_events_run_id_idx
      ON trace_events(run_id);

    CREATE TABLE IF NOT EXISTS scenario_nodes (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES scenario_nodes(id),
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scenario_proposals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
      existing_scenario_id TEXT REFERENCES scenario_nodes(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('related', 'new')),
      status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'confirmed', 'rejected')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      confirmed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS scenario_assets (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
      proposal_id TEXT NOT NULL REFERENCES scenario_proposals(id) ON DELETE CASCADE,
      existing_scenario_id TEXT REFERENCES scenario_nodes(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS scenario_proposals_run_id_idx
      ON scenario_proposals(run_id);
    CREATE INDEX IF NOT EXISTS scenario_assets_run_id_idx
      ON scenario_assets(run_id);

    CREATE TABLE IF NOT EXISTS use_case_nodes (
      id TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL REFERENCES scenario_nodes(id),
      title TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS use_case_proposals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
      existing_use_case_id TEXT REFERENCES use_case_nodes(id),
      scenario_asset_id TEXT NOT NULL REFERENCES scenario_assets(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('related', 'new')),
      status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'confirmed', 'rejected')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      confirmed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS use_case_assets (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
      proposal_id TEXT NOT NULL REFERENCES use_case_proposals(id) ON DELETE CASCADE,
      existing_use_case_id TEXT REFERENCES use_case_nodes(id),
      scenario_asset_id TEXT NOT NULL REFERENCES scenario_assets(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS use_case_proposals_run_id_idx
      ON use_case_proposals(run_id);
    CREATE INDEX IF NOT EXISTS use_case_assets_run_id_idx
      ON use_case_assets(run_id);

    CREATE TABLE IF NOT EXISTS feature_nodes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS feature_proposals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
      existing_feature_id TEXT REFERENCES feature_nodes(id),
      use_case_asset_id TEXT NOT NULL REFERENCES use_case_assets(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('affected', 'new')),
      status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'confirmed', 'rejected')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      confirmed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS feature_assets (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
      proposal_id TEXT NOT NULL REFERENCES feature_proposals(id) ON DELETE CASCADE,
      existing_feature_id TEXT REFERENCES feature_nodes(id),
      use_case_asset_id TEXT NOT NULL REFERENCES use_case_assets(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS feature_proposals_run_id_idx
      ON feature_proposals(run_id);
    CREATE INDEX IF NOT EXISTS feature_assets_run_id_idx
      ON feature_assets(run_id);
  `);

  pool.database.exec(`
    INSERT INTO scenario_nodes (id, parent_id, name, description)
    VALUES
      ('00000000-0000-0000-0000-000000000001', NULL, 'Dashboard', 'The dashboard scenario family.'),
      ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'View dashboard', 'A user views the dashboard.'),
      ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Filter dashboard by date', 'A user filters dashboard data by date.'),
      ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Export dashboard', 'A user exports dashboard data.')
    ON CONFLICT (name) DO NOTHING;
  `);

  pool.database.exec(`
    INSERT INTO use_case_nodes (id, scenario_id, title, description)
    VALUES
      ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000002', 'View dashboard on desktop', 'A user opens the dashboard on a desktop device.'),
      ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000003', 'Filter dashboard by last seven days', 'A user filters dashboard data to the last seven days.'),
      ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000004', 'Export dashboard as CSV', 'A user exports dashboard data as a CSV file.')
    ON CONFLICT (title) DO NOTHING;
  `);

  pool.database.exec(`
    INSERT INTO feature_nodes (id, title, description)
    VALUES
      ('00000000-0000-0000-0000-000000000201', 'Dashboard rendering', 'Renders dashboard widgets and layout.'),
      ('00000000-0000-0000-0000-000000000202', 'Dashboard access control', 'Controls who can view each dashboard.'),
      ('00000000-0000-0000-0000-000000000203', 'Dashboard CSV export', 'Exports dashboard data as CSV.')
    ON CONFLICT (title) DO NOTHING;
  `);
}

export async function createAnalysisRun(
  pool: SqlitePool,
  requirement: string,
): Promise<AnalysisRun> {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO analysis_runs (id, requirement) VALUES ($1, $2)",
    [id, requirement],
  );

  return { id, requirement };
}

export async function getAnalysisRun(
  pool: SqlitePool,
  runId: string,
): Promise<AnalysisRunRecord | null> {
  const result = await pool.query<{
    id: string;
    requirement: string;
    status: AnalysisRunStatus;
    currentStage: AnalysisRunStage | null;
  }>(
    'SELECT id, requirement, status, current_stage AS "currentStage" FROM analysis_runs WHERE id = $1',
    [runId],
  );

  return result.rows[0] ?? null;
}

export async function setAnalysisRunStatus(
  pool: SqlitePool,
  runId: string,
  status: AnalysisRunStatus,
  currentStage?: AnalysisRunStage,
): Promise<void> {
  if (status === "awaiting_confirmation" && !currentStage) {
    throw new Error("An awaiting confirmation run requires a current stage");
  }

  const isTerminal = [
    "succeeded",
    "rejected",
    "failed",
    "cancelled",
  ].includes(status);
  const completedAt = isTerminal ? new Date().toISOString() : null;

  await pool.query(
    `UPDATE analysis_runs
     SET status = $2,
         completed_at = $3,
         failure_code = CASE
           WHEN $4 = 'failed' THEN failure_code
           WHEN $4 = 'cancelled' THEN 'cancelled'
           ELSE NULL
         END
         ${currentStage ? ", current_stage = $5" : ""}
     WHERE id = $1`,
    [
      runId,
      status,
      completedAt,
      status,
      ...(currentStage ? [currentStage] : []),
    ],
  );
}

export async function recordTraceEvent(
  pool: SqlitePool,
  runId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    "INSERT INTO trace_events (run_id, event_type, payload) VALUES ($1, $2, $3)",
    [runId, eventType, JSON.stringify(payload)],
  );
}

export async function completeAnalysisRun(
  pool: SqlitePool,
  runId: string,
  status: "succeeded" | "rejected" = "succeeded",
): Promise<void> {
  await pool.query(
    "UPDATE analysis_runs SET status = $2, completed_at = $3, failure_code = NULL WHERE id = $1",
    [runId, status, new Date().toISOString()],
  );
}

export async function failAnalysisRun(
  pool: SqlitePool,
  runId: string,
  failureCode: AnalysisFailureCode,
): Promise<void> {
  await pool.query(
    "UPDATE analysis_runs SET status = 'failed', failure_code = $2, completed_at = $3 WHERE id = $1",
    [runId, failureCode, new Date().toISOString()],
  );
}

export async function cancelAnalysisRun(
  pool: SqlitePool,
  runId: string,
): Promise<void> {
  await pool.query(
    "UPDATE analysis_runs SET status = 'cancelled', failure_code = 'cancelled', completed_at = $2 WHERE id = $1",
    [runId, new Date().toISOString()],
  );
}

type TransactionQuery = <T = any>(
  text: string,
  values?: unknown[],
) => Promise<QueryResult<T>>;

async function withTransaction<T>(
  pool: SqlitePool,
  operation: (query: TransactionQuery) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const client = await pool.connect();

  try {
    const query: TransactionQuery = (text, values = []) => {
      signal?.throwIfAborted();
      return client.query(text, values);
    };

    await query("BEGIN");
    const result = await operation(query);
    await query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original operation failure for diagnosis.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function listScenarioNodes(
  pool: SqlitePool,
): Promise<ScenarioNode[]> {
  const result = await pool.query<{
    id: string;
    parent_id: string | null;
    name: string;
    description: string;
  }>(
    "SELECT id, parent_id, name, description FROM scenario_nodes ORDER BY name",
  );

  return result.rows.map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    description: row.description,
  }));
}

export async function listScenarioAssetsByRun(
  pool: SqlitePool,
  runId: string,
): Promise<ScenarioAsset[]> {
  const result = await pool.query<{
    id: string;
    existing_scenario_id: string;
    title: string;
    description: string;
    kind: "related" | "new";
  }>(
    `SELECT id, existing_scenario_id, title, description, kind
     FROM scenario_assets
     WHERE run_id = $1
     ORDER BY rowid`,
    [runId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    scenarioId: row.existing_scenario_id,
  }));
}

export async function listScenarioProposalsByRun(
  pool: SqlitePool,
  runId: string,
): Promise<ScenarioProposalRecord[]> {
  const result = await pool.query<ScenarioProposalRecord>(
    `SELECT kind, title, description, status
     FROM scenario_proposals
     WHERE run_id = $1 AND status = 'proposed'
     ORDER BY rowid`,
    [runId],
  );

  return result.rows;
}

export async function rejectScenarioProposals(
  pool: SqlitePool,
  runId: string,
): Promise<void> {
  await pool.query(
    "UPDATE scenario_proposals SET status = 'rejected' WHERE run_id = $1 AND status = 'proposed'",
    [runId],
  );
}

export async function listUseCaseNodes(
  pool: SqlitePool,
): Promise<UseCaseNode[]> {
  const result = await pool.query<{
    id: string;
    scenario_id: string;
    scenario_name: string;
    title: string;
    description: string;
  }>(
    `SELECT uc.id, uc.scenario_id, s.name AS scenario_name,
            uc.title, uc.description
     FROM use_case_nodes uc
     JOIN scenario_nodes s ON s.id = uc.scenario_id
     ORDER BY uc.title`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    scenarioId: row.scenario_id,
    scenarioName: row.scenario_name,
    title: row.title,
    description: row.description,
  }));
}

export async function listUseCaseAssetsByRun(
  pool: SqlitePool,
  runId: string,
): Promise<UseCaseAsset[]> {
  const result = await pool.query<{
    id: string;
    title: string;
    description: string;
    kind: "related" | "new";
  }>(
    `SELECT id, title, description, kind
     FROM use_case_assets
     WHERE run_id = $1
     ORDER BY rowid`,
    [runId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
  }));
}

export async function listUseCaseProposalsByRun(
  pool: SqlitePool,
  runId: string,
): Promise<UseCaseProposalRecord[]> {
  const result = await pool.query<UseCaseProposalRecord>(
    `SELECT p.kind, p.title, p.description, sa.title AS scenarioTitle, p.status
     FROM use_case_proposals p
     JOIN scenario_assets sa ON sa.id = p.scenario_asset_id
     WHERE p.run_id = $1 AND p.status = 'proposed'
     ORDER BY p.rowid`,
    [runId],
  );

  return result.rows;
}

export async function rejectUseCaseProposals(
  pool: SqlitePool,
  runId: string,
): Promise<void> {
  await pool.query(
    "UPDATE use_case_proposals SET status = 'rejected' WHERE run_id = $1 AND status = 'proposed'",
    [runId],
  );
}

export async function listFeatureNodes(
  pool: SqlitePool,
): Promise<FeatureNode[]> {
  const result = await pool.query<{
    id: string;
    title: string;
    description: string;
  }>(
    "SELECT id, title, description FROM feature_nodes ORDER BY title",
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
  }));
}

export async function listFeatureAssetsByRun(
  pool: SqlitePool,
  runId: string,
): Promise<FeatureAsset[]> {
  const result = await pool.query<{
    id: string;
    title: string;
    description: string;
    kind: "affected" | "new";
  }>(
    `SELECT id, title, description, kind
     FROM feature_assets
     WHERE run_id = $1
     ORDER BY rowid`,
    [runId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
  }));
}

export async function listFeatureProposalsByRun(
  pool: SqlitePool,
  runId: string,
): Promise<FeatureProposalRecord[]> {
  const result = await pool.query<FeatureProposalRecord>(
    `SELECT p.kind, p.title, p.description, ua.title AS useCaseTitle, p.status
     FROM feature_proposals p
     JOIN use_case_assets ua ON ua.id = p.use_case_asset_id
     WHERE p.run_id = $1 AND p.status = 'proposed'
     ORDER BY p.rowid`,
    [runId],
  );

  return result.rows;
}

export async function rejectFeatureProposals(
  pool: SqlitePool,
  runId: string,
): Promise<void> {
  await pool.query(
    "UPDATE feature_proposals SET status = 'rejected' WHERE run_id = $1 AND status = 'proposed'",
    [runId],
  );
}

export async function saveScenarioProposals(
  pool: SqlitePool,
  runId: string,
  proposals: ScenarioProposalInput[],
  signal?: AbortSignal,
): Promise<void> {
  await withTransaction(pool, async (query) => {
    for (const proposal of proposals) {
      let existingScenarioId: string | null = null;

      if (proposal.kind === "related") {
        const result = await query<{ id: string }>(
          "SELECT id FROM scenario_nodes WHERE name = $1",
          [proposal.title],
        );

        if (result.rows.length === 0) {
          throw new AnalysisFailureError(
            "missing_data",
            `Related scenario does not exist: ${proposal.title}; verify the scenario library and retry`,
          );
        }

        existingScenarioId = result.rows[0].id;
      }

      await query(
        `INSERT INTO scenario_proposals
          (id, run_id, existing_scenario_id, title, description, kind)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(),
          runId,
          existingScenarioId,
          proposal.title,
          proposal.description,
          proposal.kind,
        ],
      );
    }
  }, signal);
}

export async function settleScenarioProposals(
  pool: SqlitePool,
  runId: string,
  confirmed: boolean,
  signal?: AbortSignal,
): Promise<ScenarioAsset[]> {
  return withTransaction(pool, async (query) => {
    if (!confirmed) {
      await query(
        "UPDATE scenario_proposals SET status = 'rejected' WHERE run_id = $1 AND status = 'proposed'",
        [runId],
      );
      return [];
    }

    await query(
      "UPDATE scenario_proposals SET status = 'confirmed', confirmed_at = $2 WHERE run_id = $1 AND status = 'proposed'",
      [runId, new Date().toISOString()],
    );

    const proposals = await query<ScenarioProposalRow>(
      `SELECT id, existing_scenario_id, title, description, kind
       FROM scenario_proposals
       WHERE run_id = $1 AND status = 'confirmed'`,
      [runId],
    );

    const assets: ScenarioAsset[] = [];

    for (const proposal of proposals.rows) {
      let scenarioId = proposal.existing_scenario_id;

      if (proposal.kind === "new") {
        const inserted = await query<{ id: string }>(
          `INSERT INTO scenario_nodes (id, parent_id, name, description)
           VALUES ($1, NULL, $2, $3)
           ON CONFLICT (name) DO NOTHING
           RETURNING id`,
          [randomUUID(), proposal.title, proposal.description],
        );

        scenarioId =
          inserted.rows[0]?.id ??
          (
            await query<{ id: string }>(
              "SELECT id FROM scenario_nodes WHERE name = $1",
              [proposal.title],
            )
          ).rows[0].id;

        await query(
          "UPDATE scenario_proposals SET existing_scenario_id = $2 WHERE id = $1",
          [proposal.id, scenarioId],
        );
      }

      if (!scenarioId) {
        throw new AnalysisFailureError(
          "missing_data",
          `Confirmed scenario is missing its library reference: ${proposal.title}`,
        );
      }

      const id = randomUUID();
      await query(
        `INSERT INTO scenario_assets
          (id, run_id, proposal_id, existing_scenario_id, title, description, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          runId,
          proposal.id,
          scenarioId,
          proposal.title,
          proposal.description,
          proposal.kind,
        ],
      );

      assets.push({
        id,
        kind: proposal.kind,
        title: proposal.title,
        description: proposal.description,
        scenarioId,
      });
    }

    return assets;
  }, signal);
}

export async function saveUseCaseProposals(
  pool: SqlitePool,
  runId: string,
  proposals: UseCaseProposalInput[],
  scenarioAssets: ScenarioAsset[],
  signal?: AbortSignal,
): Promise<void> {
  await withTransaction(pool, async (query) => {
    for (const proposal of proposals) {
      const scenarioAsset = scenarioAssets.find(
        (asset) => asset.title === proposal.scenarioTitle,
      );

      if (!scenarioAsset) {
        throw new AnalysisFailureError(
          "missing_data",
          `Use case proposal must use a confirmed scenario: ${proposal.scenarioTitle}`,
        );
      }

      let existingUseCaseId: string | null = null;

      if (proposal.kind === "related") {
        const result = await query<{ id: string }>(
          "SELECT id FROM use_case_nodes WHERE title = $1",
          [proposal.title],
        );

        if (result.rows.length === 0) {
          throw new AnalysisFailureError(
            "missing_data",
            `Related use case does not exist: ${proposal.title}; verify the use-case library and retry`,
          );
        }

        existingUseCaseId = result.rows[0].id;
      }

      await query(
        `INSERT INTO use_case_proposals
          (id, run_id, existing_use_case_id, scenario_asset_id, title, description, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          runId,
          existingUseCaseId,
          scenarioAsset.id,
          proposal.title,
          proposal.description,
          proposal.kind,
        ],
      );
    }
  }, signal);
}

export async function settleUseCaseProposals(
  pool: SqlitePool,
  runId: string,
  confirmed: boolean,
  signal?: AbortSignal,
): Promise<UseCaseAsset[]> {
  return withTransaction(pool, async (query) => {
    if (!confirmed) {
      await query(
        "UPDATE use_case_proposals SET status = 'rejected' WHERE run_id = $1 AND status = 'proposed'",
        [runId],
      );
      return [];
    }

    await query(
      "UPDATE use_case_proposals SET status = 'confirmed', confirmed_at = $2 WHERE run_id = $1 AND status = 'proposed'",
      [runId, new Date().toISOString()],
    );

    const proposals = await query<UseCaseProposalRow>(
      `SELECT p.id, p.existing_use_case_id, p.scenario_asset_id,
              p.title, p.description, p.kind, sa.existing_scenario_id AS scenario_id
       FROM use_case_proposals p
       JOIN scenario_assets sa ON sa.id = p.scenario_asset_id
       WHERE p.run_id = $1 AND p.status = 'confirmed'`,
      [runId],
    );
    const assets: UseCaseAsset[] = [];

    for (const proposal of proposals.rows) {
      let useCaseId = proposal.existing_use_case_id;

      if (proposal.kind === "new") {
        const inserted = await query<{ id: string }>(
          `INSERT INTO use_case_nodes (id, scenario_id, title, description)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (title) DO NOTHING
           RETURNING id`,
          [
            randomUUID(),
            proposal.scenario_id,
            proposal.title,
            proposal.description,
          ],
        );

        useCaseId =
          inserted.rows[0]?.id ??
          (
            await query<{ id: string }>(
              "SELECT id FROM use_case_nodes WHERE title = $1",
              [proposal.title],
            )
          ).rows[0].id;

        await query(
          "UPDATE use_case_proposals SET existing_use_case_id = $2 WHERE id = $1",
          [proposal.id, useCaseId],
        );
      }

      const id = randomUUID();
      await query(
        `INSERT INTO use_case_assets
          (id, run_id, proposal_id, existing_use_case_id, scenario_asset_id, title, description, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          runId,
          proposal.id,
          useCaseId,
          proposal.scenario_asset_id,
          proposal.title,
          proposal.description,
          proposal.kind,
        ],
      );

      assets.push({
        id,
        kind: proposal.kind,
        title: proposal.title,
        description: proposal.description,
      });
    }

    return assets;
  }, signal);
}

export async function saveFeatureProposals(
  pool: SqlitePool,
  runId: string,
  proposals: FeatureProposalInput[],
  useCaseAssets: UseCaseAsset[],
  signal?: AbortSignal,
): Promise<void> {
  await withTransaction(pool, async (query) => {
    for (const proposal of proposals) {
      const useCaseAsset = useCaseAssets.find(
        (asset) => asset.title === proposal.useCaseTitle,
      );

      if (!useCaseAsset) {
        throw new AnalysisFailureError(
          "missing_data",
          `Feature proposal must use a confirmed use case: ${proposal.useCaseTitle}`,
        );
      }

      let existingFeatureId: string | null = null;

      if (proposal.kind === "affected") {
        const result = await query<{ id: string }>(
          "SELECT id FROM feature_nodes WHERE title = $1",
          [proposal.title],
        );

        if (result.rows.length === 0) {
          throw new AnalysisFailureError(
            "missing_data",
            `Affected feature does not exist: ${proposal.title}; verify the feature library and retry`,
          );
        }

        existingFeatureId = result.rows[0].id;
      }

      await query(
        `INSERT INTO feature_proposals
          (id, run_id, existing_feature_id, use_case_asset_id, title, description, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          runId,
          existingFeatureId,
          useCaseAsset.id,
          proposal.title,
          proposal.description,
          proposal.kind,
        ],
      );
    }
  }, signal);
}

export async function settleFeatureProposals(
  pool: SqlitePool,
  runId: string,
  confirmed: boolean,
  signal?: AbortSignal,
): Promise<FeatureAsset[]> {
  return withTransaction(pool, async (query) => {
    if (!confirmed) {
      await query(
        "UPDATE feature_proposals SET status = 'rejected' WHERE run_id = $1 AND status = 'proposed'",
        [runId],
      );
      return [];
    }

    await query(
      "UPDATE feature_proposals SET status = 'confirmed', confirmed_at = $2 WHERE run_id = $1 AND status = 'proposed'",
      [runId, new Date().toISOString()],
    );

    const proposals = await query<FeatureProposalRow>(
      `SELECT id, existing_feature_id, use_case_asset_id,
              title, description, kind
       FROM feature_proposals
       WHERE run_id = $1 AND status = 'confirmed'`,
      [runId],
    );

    const assets: FeatureAsset[] = [];

    for (const proposal of proposals.rows) {
      let featureId = proposal.existing_feature_id;

      if (proposal.kind === "new") {
        const inserted = await query<{ id: string }>(
          `INSERT INTO feature_nodes (id, title, description)
           VALUES ($1, $2, $3)
           ON CONFLICT (title) DO NOTHING
           RETURNING id`,
          [randomUUID(), proposal.title, proposal.description],
        );

        featureId =
          inserted.rows[0]?.id ??
          (
            await query<{ id: string }>(
              "SELECT id FROM feature_nodes WHERE title = $1",
              [proposal.title],
            )
          ).rows[0].id;

        await query(
          "UPDATE feature_proposals SET existing_feature_id = $2 WHERE id = $1",
          [proposal.id, featureId],
        );
      }

      const id = randomUUID();
      await query(
        `INSERT INTO feature_assets
          (id, run_id, proposal_id, existing_feature_id, use_case_asset_id, title, description, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          runId,
          proposal.id,
          featureId,
          proposal.use_case_asset_id,
          proposal.title,
          proposal.description,
          proposal.kind,
        ],
      );

      assets.push({
        id,
        kind: proposal.kind,
        title: proposal.title,
        description: proposal.description,
      });
    }

    return assets;
  }, signal);
}
