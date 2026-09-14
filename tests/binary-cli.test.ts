import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { Pool } from "pg";

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

async function buildBinary(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npm", ["run", "build:binary"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`build:binary failed with exit code ${code}`));
    });
  });
}

async function runProcess(
  command: string,
  args: string[],
  env: Record<string, string>,
  input = "",
): Promise<ProcessResult> {
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-binary-"));
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      HOME: isolatedHome,
      PI_CODING_AGENT_DIR: path.join(isolatedHome, "pi-agent"),
    },
  });
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
  child.stdin.write(input);
  child.stdin.end();

  const [exitCode] = await once(child, "close");

  return { exitCode, stdout, stderr };
}

async function getRunTrace(
  pool: Pool,
  requirement: string,
): Promise<{
  status: string;
  failureCode: string | null;
  eventTypes: string[];
  terminalPayload: Record<string, unknown>;
}> {
  const run = await pool.query(
    "SELECT id, status, failure_code FROM analysis_runs WHERE requirement = $1",
    [requirement],
  );

  assert.equal(run.rows.length, 1);

  const trace = await pool.query(
    "SELECT event_type, payload FROM trace_events WHERE run_id = $1 ORDER BY id",
    [run.rows[0].id],
  );
  const terminalEvent = trace.rows.find((row) =>
    row.event_type === "analysis_run_completed" ||
    row.event_type === "analysis_run_failed"
  );

  assert.ok(terminalEvent, "Expected a terminal trace event");

  return {
    status: run.rows[0].status,
    failureCode: run.rows[0].failure_code,
    eventTypes: trace.rows.map((row) => row.event_type),
    terminalPayload: terminalEvent.payload,
  };
}

before(async () => {
  await buildBinary();
});

test("standalone binary preserves the full workflow trace and success exit", async () => {
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(databaseUrl, "DATABASE_URL must be set for binary CLI test");

  const binaryPath = path.join(process.cwd(), "dist", "baize");
  await access(binaryPath, constants.X_OK);

  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-binary-"));
  const binaryMcpConfig = path.join(isolatedHome, "mcp.config.json");
  const sourceRequirement = `binary source success ${Date.now()}`;
  const binaryRequirement = `binary executable success ${Date.now()}`;

  await writeFile(binaryMcpConfig, JSON.stringify({
    mcpServers: {
      "baize-analysis": {
        command: binaryPath,
        args: ["mcp"],
      },
    },
  }));

  const source = await runProcess(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", sourceRequirement],
    {
      MCP_CONFIG_PATH: path.join(process.cwd(), "mcp.config.json"),
    },
    "y\ny\ny\n",
  );
  const binary = await runProcess(
    binaryPath,
    [binaryRequirement],
    {
      MCP_CONFIG_PATH: binaryMcpConfig,
    },
    "y\ny\ny\n",
  );

  assert.equal(source.exitCode, 0, source.stderr);
  assert.equal(binary.exitCode, 0, binary.stderr);

  const sourceResult = JSON.parse(source.stdout) as {
    runId: string;
    status: string;
    scenarioAssetCount: number;
    useCaseAssetCount: number;
    featureAssetCount: number;
  };
  const binaryResult = JSON.parse(binary.stdout) as typeof sourceResult;
  const { runId: sourceRunId, ...sourcePayload } = sourceResult;
  const { runId: binaryRunId, ...binaryPayload } = binaryResult;

  assert.notEqual(binaryRunId, sourceRunId);
  assert.deepEqual(binaryPayload, sourcePayload);

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const sourceTrace = await getRunTrace(pool, sourceRequirement);
    const binaryTrace = await getRunTrace(pool, binaryRequirement);

    assert.equal(sourceTrace.status, "succeeded");
    assert.equal(binaryTrace.status, "succeeded");
    assert.deepEqual(binaryTrace.eventTypes, sourceTrace.eventTypes);
    assert.deepEqual(binaryTrace.terminalPayload, sourceTrace.terminalPayload);
    assert.ok(binaryTrace.eventTypes.includes("mcp_server_started"));
    assert.ok(binaryTrace.eventTypes.includes("analysis_run_completed"));
  } finally {
    await pool.end();
  }
});

test("standalone binary preserves failure exit code and classified trace", async () => {
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(databaseUrl, "DATABASE_URL must be set for binary CLI test");

  await access(
    path.join(process.cwd(), "dist", "baize"),
    constants.X_OK,
  );

  const sourceRequirement = `binary source failure ${Date.now()}`;
  const binaryRequirement = `binary executable failure ${Date.now()}`;
  const source = await runProcess(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", sourceRequirement],
    {
      BAIZE_FAUX_MODEL_OUTPUT: "not-json",
    },
  );
  const binary = await runProcess(
    path.join(process.cwd(), "dist", "baize"),
    [binaryRequirement],
    {
      BAIZE_FAUX_MODEL_OUTPUT: "not-json",
    },
  );

  assert.equal(source.exitCode, 1);
  assert.equal(binary.exitCode, 1);
  assert.match(binary.stderr, /Analysis Orchestrator did not return valid JSON/);

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const sourceTrace = await getRunTrace(pool, sourceRequirement);
    const binaryTrace = await getRunTrace(pool, binaryRequirement);

    assert.equal(sourceTrace.status, "failed");
    assert.equal(binaryTrace.status, "failed");
    assert.equal(sourceTrace.failureCode, "invalid_model_output");
    assert.equal(binaryTrace.failureCode, "invalid_model_output");
    assert.deepEqual(binaryTrace.eventTypes, sourceTrace.eventTypes);
    assert.deepEqual(binaryTrace.terminalPayload, sourceTrace.terminalPayload);
  } finally {
    await pool.end();
  }
});
