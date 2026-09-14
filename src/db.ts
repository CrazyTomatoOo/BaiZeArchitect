import { randomUUID } from "node:crypto";
import { Pool } from "pg";

export interface AnalysisRun {
  id: string;
  requirement: string;
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

export interface ScenarioAsset {
  id: string;
  kind: "related" | "new";
  title: string;
  description: string;
}

export async function initializeSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS analysis_runs (
      id UUID PRIMARY KEY,
      requirement TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS trace_events (
      id BIGSERIAL PRIMARY KEY,
      run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS trace_events_run_id_idx
      ON trace_events(run_id);

    CREATE TABLE IF NOT EXISTS scenario_nodes (
      id UUID PRIMARY KEY,
      parent_id UUID REFERENCES scenario_nodes(id),
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS scenario_proposals (
      id UUID PRIMARY KEY,
      run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
      existing_scenario_id UUID REFERENCES scenario_nodes(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('related', 'new')),
      status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'confirmed', 'rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      confirmed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS scenario_assets (
      id UUID PRIMARY KEY,
      run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
      proposal_id UUID NOT NULL REFERENCES scenario_proposals(id) ON DELETE CASCADE,
      existing_scenario_id UUID REFERENCES scenario_nodes(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS scenario_proposals_run_id_idx
      ON scenario_proposals(run_id);
    CREATE INDEX IF NOT EXISTS scenario_assets_run_id_idx
      ON scenario_assets(run_id);
  `);

  await pool.query(`
    INSERT INTO scenario_nodes (id, parent_id, name, description)
    VALUES
      ('00000000-0000-0000-0000-000000000001', NULL, 'Dashboard', 'The dashboard scenario family.'),
      ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'View dashboard', 'A user views the dashboard.'),
      ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Filter dashboard by date', 'A user filters dashboard data by date.'),
      ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Export dashboard', 'A user exports dashboard data.')
    ON CONFLICT (name) DO NOTHING;
  `);
}

export async function createAnalysisRun(
  pool: Pool,
  requirement: string,
): Promise<AnalysisRun> {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO analysis_runs (id, requirement) VALUES ($1, $2)",
    [id, requirement],
  );

  return { id, requirement };
}

export async function recordTraceEvent(
  pool: Pool,
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
  pool: Pool,
  runId: string,
  status: "succeeded" | "rejected" = "succeeded",
): Promise<void> {
  await pool.query(
    "UPDATE analysis_runs SET status = $2, completed_at = now() WHERE id = $1",
    [runId, status],
  );
}

export async function failAnalysisRun(
  pool: Pool,
  runId: string,
): Promise<void> {
  await pool.query(
    "UPDATE analysis_runs SET status = 'failed', completed_at = now() WHERE id = $1",
    [runId],
  );
}

export async function listScenarioNodes(
  pool: Pool,
): Promise<ScenarioNode[]> {
  const result = await pool.query(
    "SELECT id, parent_id, name, description FROM scenario_nodes ORDER BY name",
  );

  return result.rows.map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    description: row.description,
  }));
}

export async function saveScenarioProposals(
  pool: Pool,
  runId: string,
  proposals: ScenarioProposalInput[],
): Promise<void> {
  for (const proposal of proposals) {
    let existingScenarioId: string | null = null;

    if (proposal.kind === "related") {
      const result = await pool.query(
        "SELECT id FROM scenario_nodes WHERE name = $1",
        [proposal.title],
      );

      if (result.rows.length === 0) {
        throw new Error(`Related scenario does not exist: ${proposal.title}`);
      }

      existingScenarioId = result.rows[0].id;
    }

    await pool.query(
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
}

export async function settleScenarioProposals(
  pool: Pool,
  runId: string,
  confirmed: boolean,
): Promise<ScenarioAsset[]> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (!confirmed) {
      await client.query(
        "UPDATE scenario_proposals SET status = 'rejected' WHERE run_id = $1 AND status = 'proposed'",
        [runId],
      );
      await client.query("COMMIT");
      return [];
    }

    await client.query(
      "UPDATE scenario_proposals SET status = 'confirmed', confirmed_at = now() WHERE run_id = $1 AND status = 'proposed'",
      [runId],
    );

    const proposals = await client.query(
      `SELECT id, existing_scenario_id, title, description, kind
       FROM scenario_proposals
       WHERE run_id = $1 AND status = 'confirmed'`,
      [runId],
    );

    const assets: ScenarioAsset[] = [];

    for (const proposal of proposals.rows) {
      let scenarioId = proposal.existing_scenario_id;

      if (proposal.kind === "new") {
        const inserted = await client.query(
          `INSERT INTO scenario_nodes (id, parent_id, name, description)
           VALUES ($1, NULL, $2, $3)
           ON CONFLICT (name) DO NOTHING
           RETURNING id`,
          [randomUUID(), proposal.title, proposal.description],
        );

        scenarioId =
          inserted.rows[0]?.id ??
          (
            await client.query(
              "SELECT id FROM scenario_nodes WHERE name = $1",
              [proposal.title],
            )
          ).rows[0].id;

        await client.query(
          "UPDATE scenario_proposals SET existing_scenario_id = $2 WHERE id = $1",
          [proposal.id, scenarioId],
        );
      }

      const id = randomUUID();
      await client.query(
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
      });
    }

    await client.query("COMMIT");
    return assets;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
