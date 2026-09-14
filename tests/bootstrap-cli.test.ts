import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

const execFileAsync = promisify(execFile);

test("bootstrap CLI persists an analysis run and trace events", async () => {
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(
    databaseUrl,
    "DATABASE_URL must be set for the bootstrap CLI integration test",
  );

  const { stdout } = await execFileAsync(
    "tsx",
    ["src/cli.ts", "Bootstrap requirement"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        HOME: isolatedHome,
        PI_CODING_AGENT_DIR: path.join(isolatedHome, "pi-agent"),
      },
    },
  );

  const result = JSON.parse(stdout) as {
    runId: string;
    status: string;
    assistantText: string;
  };

  assert.equal(result.status, "succeeded");
  assert.equal(result.assistantText, "Bootstrap analysis complete.");

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const runResult = await pool.query(
      "SELECT requirement, status FROM analysis_runs WHERE id = $1",
      [result.runId],
    );

    assert.equal(runResult.rows.length, 1);
    assert.equal(runResult.rows[0].requirement, "Bootstrap requirement");
    assert.equal(runResult.rows[0].status, "succeeded");

    const traceResult = await pool.query(
      "SELECT event_type, payload FROM trace_events WHERE run_id = $1 ORDER BY id",
      [result.runId],
    );

    assert.equal(traceResult.rows.length, 2);
    assert.equal(traceResult.rows[0].event_type, "analysis_run_started");
    assert.deepEqual(traceResult.rows[0].payload, {
      requirement: "Bootstrap requirement",
    });
    assert.equal(traceResult.rows[1].event_type, "analysis_run_completed");
    assert.deepEqual(traceResult.rows[1].payload, {
      assistantText: "Bootstrap analysis complete.",
      callCount: 1,
    });
  } finally {
    await pool.end();
  }
});
