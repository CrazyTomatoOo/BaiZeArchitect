import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

test("MCP-backed scenario analysis completes the full workflow", async () => {
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(databaseUrl, "DATABASE_URL must be set for the MCP CLI test");

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

  child.stdin.write("y\n");
  child.stdin.write("y\n");
  child.stdin.write("y\n");
  child.stdin.end();

  const [exitCode] = await once(child, "close");

  assert.equal(exitCode, 0);
  assert.match(stderr, /Confirm scenario proposals\?/);
  assert.match(stderr, /Confirm use case proposals\?/);
  assert.match(stderr, /Confirm feature proposals\?/);

  const result = JSON.parse(stdout) as {
    runId: string;
    status: string;
    featureAssetCount: number;
  };

  assert.equal(result.status, "succeeded");
  assert.equal(result.featureAssetCount, 2);

  const config = JSON.parse(
    await readFile(path.join(process.cwd(), "mcp.config.json"), "utf8"),
  ) as {
    mcpServers?: Record<string, { command?: string; args?: string[] }>;
  };
  const serverConfig = config.mcpServers?.["baize-analysis"];

  assert.equal(serverConfig?.command, "node");
  assert.deepEqual(serverConfig?.args, ["dist/mcp-server.js"]);

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const trace = await pool.query(
      `SELECT event_type, payload
       FROM trace_events
       WHERE run_id = $1
       ORDER BY id`,
      [result.runId],
    );
    const eventTypes = trace.rows.map((row) => row.event_type);

    for (const expectedEvent of [
      "mcp_server_started",
      "mcp_tool_call",
      "mcp_tool_result",
      "scenario_tool_call",
      "scenario_tree_queried",
      "analysis_run_completed",
    ]) {
      assert.ok(
        eventTypes.includes(expectedEvent),
        `Expected trace event ${expectedEvent}; saw ${eventTypes.join(", ")}`,
      );
    }

    const startedEvent = trace.rows.find(
      (row) => row.event_type === "mcp_server_started",
    );

    assert.equal(
      (startedEvent.payload as { server?: string }).server,
      "baize-analysis",
    );

    const toolCall = trace.rows.find(
      (row) => row.event_type === "mcp_tool_call",
    );

    assert.equal(
      (toolCall.payload as { toolName?: string }).toolName,
      "query_scenario_tree",
    );

    const toolResult = trace.rows.find(
      (row) => row.event_type === "mcp_tool_result",
    );
    const resultCount = (
      (toolResult.payload as {
        result?: { structuredContent?: { count?: number } };
      }).result ?? {}
    ).structuredContent?.count;

    assert.equal((toolResult.payload as { isError?: boolean }).isError, false);
    assert.ok(resultCount !== undefined && resultCount >= 4);
  } finally {
    await pool.end();
  }
});
