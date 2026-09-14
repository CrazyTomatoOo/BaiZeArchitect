import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

interface CliRun {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

async function spawnCli(
  requirement: string,
  env: Record<string, string>,
): Promise<CliRun> {
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", requirement],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
        HOME: isolatedHome,
        PI_CODING_AGENT_DIR: path.join(isolatedHome, "pi-agent"),
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

  const [exitCode, signal] = await once(child, "close");

  return { exitCode, signal, stdout, stderr };
}

async function waitForPrompt(
  child: ChildProcess,
  stderr: string,
  pattern: RegExp,
): Promise<void> {
  if (pattern.test(stderr)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${pattern}; saw ${stderr}`));
    }, 5_000);

    function onData(chunk: Buffer | string): void {
      stderr += chunk.toString();

      if (pattern.test(stderr)) {
        cleanup();
        resolve();
      }
    }

    function cleanup(): void {
      clearTimeout(timeout);
      child.stderr?.off("data", onData);
      child.stderr?.off("end", onEnd);
    }

    function onEnd(): void {
      cleanup();
      reject(new Error(`CLI closed while waiting for ${pattern}; saw ${stderr}`));
    }

    child.stderr?.on("data", onData);
    child.stderr?.on("end", onEnd);
  });
}

async function findFailureRun(
  pool: Pool,
  errorPattern: RegExp,
): Promise<string> {
  const result = await pool.query(
    `SELECT run_id
     FROM trace_events
     WHERE event_type = 'analysis_run_failed'
       AND payload->>'error' ~ $1
     ORDER BY id DESC
     LIMIT 1`,
    [errorPattern.source],
  );

  assert.ok(result.rows[0], "Expected a classified analysis_run_failed event");
  return result.rows[0].run_id as string;
}

async function assertFailedRun(
  pool: Pool,
  runId: string,
  failureCode: string,
): Promise<void> {
  const run = await pool.query(
    "SELECT status, failure_code FROM analysis_runs WHERE id = $1",
    [runId],
  );

  assert.equal(run.rows[0].status, "failed");
  assert.equal(run.rows[0].failure_code, failureCode);
}

test("database failure is classified and leaves no partial scenario proposals", async () => {
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(databaseUrl, "DATABASE_URL must be set");

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(`
      CREATE OR REPLACE FUNCTION baize_test_fail_scenario_insert()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'simulated database failure';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await pool.query(
      "DROP TRIGGER IF EXISTS baize_test_scenario_failure ON scenario_proposals",
    );
    await pool.query(`
      CREATE TRIGGER baize_test_scenario_failure
      BEFORE INSERT ON scenario_proposals
      FOR EACH STATEMENT EXECUTE FUNCTION baize_test_fail_scenario_insert();
    `);

    const cli = await spawnCli("Add dashboard sharing", {});

    assert.equal(cli.exitCode, 1);
    assert.match(cli.stderr, /simulated database failure/);

    const runId = await findFailureRun(pool, /simulated database failure/);
    await assertFailedRun(pool, runId, "database_error");

    const proposals = await pool.query(
      "SELECT id FROM scenario_proposals WHERE run_id = $1",
      [runId],
    );

    assert.equal(proposals.rows.length, 0);
  } finally {
    await pool.query(
      "DROP TRIGGER IF EXISTS baize_test_scenario_failure ON scenario_proposals",
    );
    await pool.query("DROP FUNCTION IF EXISTS baize_test_fail_scenario_insert()");
    await pool.end();
  }
});

test("missing MCP scenario data fails instead of inventing knowledge", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));
  const configPath = path.join(isolatedHome, "mcp.config.json");

  assert.ok(databaseUrl, "DATABASE_URL must be set");

  await writeFile(configPath, JSON.stringify({
    mcpServers: {
      "baize-analysis": {
        command: "node",
        args: ["--import", "tsx", "tests/mcp-test-server.ts"],
        env: {
          BAIZE_MCP_TEST_MODE: "empty",
        },
      },
    },
  }));

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const cli = await spawnCli("Add dashboard sharing", {
      MCP_CONFIG_PATH: configPath,
    });

    assert.equal(cli.exitCode, 1);
    assert.match(cli.stderr, /Scenario data is missing.*help/i);

    const runId = await findFailureRun(pool, /Scenario data is missing/);
    await assertFailedRun(pool, runId, "missing_data");

    const trace = await pool.query(
      "SELECT event_type FROM trace_events WHERE run_id = $1 ORDER BY id",
      [runId],
    );
    const eventTypes = trace.rows.map((row) => row.event_type);

    assert.ok(eventTypes.includes("mcp_tool_result"));
    assert.ok(eventTypes.includes("analysis_run_failed"));
  } finally {
    await pool.end();
  }
});

test("MCP tool timeout follows a deterministic failure path", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));
  const configPath = path.join(isolatedHome, "mcp.config.json");

  assert.ok(databaseUrl, "DATABASE_URL must be set");

  await writeFile(configPath, JSON.stringify({
    mcpServers: {
      "baize-analysis": {
        command: "node",
        args: ["--import", "tsx", "tests/mcp-test-server.ts"],
        env: {
          BAIZE_MCP_TEST_MODE: "timeout",
        },
      },
    },
  }));

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const cli = await spawnCli("Add dashboard sharing", {
      MCP_CONFIG_PATH: configPath,
      BAIZE_MCP_TIMEOUT_MS: "50",
    });

    assert.equal(cli.exitCode, 1);
    assert.match(cli.stderr, /MCP tool timed out: query_scenario_tree/);

    const runId = await findFailureRun(pool, /MCP tool timed out/);
    await assertFailedRun(pool, runId, "mcp_timeout");

    const trace = await pool.query(
      "SELECT event_type FROM trace_events WHERE run_id = $1 ORDER BY id",
      [runId],
    );
    const eventTypes = trace.rows.map((row) => row.event_type);

    assert.ok(eventTypes.includes("mcp_tool_timeout"));
    assert.ok(eventTypes.includes("analysis_run_failed"));
  } finally {
    await pool.end();
  }
});

test("invalid model output is rejected before analysis assets are persisted", async () => {
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(databaseUrl, "DATABASE_URL must be set");

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const cli = await spawnCli("Add dashboard sharing", {
      BAIZE_FAUX_MODEL_OUTPUT: "not-json",
    });

    assert.equal(cli.exitCode, 1);
    assert.match(cli.stderr, /Analysis Orchestrator did not return valid JSON/);

    const runId = await findFailureRun(
      pool,
      /Analysis Orchestrator did not return valid JSON/,
    );
    await assertFailedRun(pool, runId, "invalid_model_output");

    const proposals = await pool.query(
      "SELECT id FROM scenario_proposals WHERE run_id = $1",
      [runId],
    );
    const assets = await pool.query(
      "SELECT id FROM scenario_assets WHERE run_id = $1",
      [runId],
    );

    assert.equal(proposals.rows.length, 0);
    assert.equal(assets.rows.length, 0);
  } finally {
    await pool.end();
  }
});

test("SIGINT cancellation leaves a coherent terminal run state", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));

  assert.ok(databaseUrl, "DATABASE_URL must be set");

  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "Add dashboard sharing"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: isolatedHome,
        PI_CODING_AGENT_DIR: path.join(isolatedHome, "pi-agent"),
      },
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  await waitForPrompt(child, stderr, /Confirm scenario proposals\?/);
  child.kill("SIGINT");

  const [exitCode, signal] = await once(child, "close");
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    assert.equal(exitCode, 130);
    assert.equal(signal, null);

    const run = await pool.query(
      "SELECT id, status, failure_code FROM analysis_runs ORDER BY created_at DESC, id DESC LIMIT 1",
    );

    assert.equal(run.rows[0].status, "cancelled");
    assert.equal(run.rows[0].failure_code, "cancelled");

    const trace = await pool.query(
      "SELECT event_type, payload FROM trace_events WHERE run_id = $1 ORDER BY id",
      [run.rows[0].id],
    );
    const eventTypes = trace.rows.map((row) => row.event_type);
    const cancelledEvent = trace.rows.find(
      (row) => row.event_type === "analysis_run_cancelled",
    );

    assert.ok(cancelledEvent);
    assert.equal(
      (cancelledEvent.payload as { signal?: string }).signal,
      "SIGINT",
    );
    assert.ok(!eventTypes.includes("scenario_assets_persisted"));

    const assets = await pool.query(
      "SELECT id FROM scenario_assets WHERE run_id = $1",
      [run.rows[0].id],
    );

    assert.equal(assets.rows.length, 0);
  } finally {
    await pool.end();
  }
});
