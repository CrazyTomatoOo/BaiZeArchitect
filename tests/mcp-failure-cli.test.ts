import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

test("MCP startup failure produces a deterministic error path", async () => {
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));
  const databaseUrl = process.env.DATABASE_URL;
  const configPath = path.join(isolatedHome, "mcp.config.json");

  assert.ok(
    databaseUrl,
    "DATABASE_URL must be set for the MCP failure CLI test",
  );

  await writeFile(
    configPath,
    JSON.stringify({
      mcpServers: {
        "baize-analysis": {
          command: "/definitely/baize-missing",
          args: [],
        },
      },
    }),
  );

  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "Add dashboard sharing"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        HOME: isolatedHome,
        PI_CODING_AGENT_DIR: path.join(isolatedHome, "pi-agent"),
        MCP_CONFIG_PATH: configPath,
      },
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.stdin.end();

  const [exitCode] = await once(child, "close");

  assert.equal(exitCode, 1);
  assert.match(stderr, /MCP server failed to start/);

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const failedRuns = await pool.query(
      `SELECT run_id
       FROM trace_events
       WHERE event_type = 'mcp_server_failed'
       ORDER BY id DESC
       LIMIT 1`,
    );
    const runId = failedRuns.rows[0].run_id;
    const runs = await pool.query(
      "SELECT status FROM analysis_runs WHERE id = $1",
      [runId],
    );
    const run = runs.rows[0];

    assert.equal(run.status, "failed");

    const trace = await pool.query(
      `SELECT event_type, payload
       FROM trace_events
       WHERE run_id = $1
       ORDER BY id`,
      [runId],
    );
    const eventTypes = trace.rows.map((row) => row.event_type);

    assert.ok(eventTypes.includes("mcp_server_failed"));
    assert.ok(eventTypes.includes("analysis_run_failed"));

    const failureEvent = trace.rows.find(
      (row) => row.event_type === "mcp_server_failed",
    );

    assert.equal(
      (failureEvent.payload as { server?: string }).server,
      "baize-analysis",
    );
  } finally {
    await pool.end();
  }
});
