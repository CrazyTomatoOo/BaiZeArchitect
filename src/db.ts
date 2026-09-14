import { randomUUID } from "node:crypto";
import { Pool } from "pg";

export interface AnalysisRun {
  id: string;
  requirement: string;
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
): Promise<void> {
  await pool.query(
    "UPDATE analysis_runs SET status = 'succeeded', completed_at = now() WHERE id = $1",
    [runId],
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
