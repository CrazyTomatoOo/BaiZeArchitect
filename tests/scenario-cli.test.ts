import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

test("scenario CLI proposes and persists confirmed scenarios", async () => {
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(
    databaseUrl,
    "DATABASE_URL must be set for the scenario CLI integration test",
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
  child.stdin.end();

  const [exitCode] = await once(child, "close");

  assert.equal(exitCode, 0);
  assert.match(stderr, /Confirm scenario proposals\?/);

  const result = JSON.parse(stdout) as {
    runId: string;
    status: string;
    scenarioAssetCount: number;
    confirmedScenarios: Array<{
      kind: string;
      title: string;
    }>;
  };

  assert.equal(result.status, "succeeded");
  assert.equal(result.scenarioAssetCount, 2);
  assert.deepEqual(
    [...result.confirmedScenarios].sort((a, b) => a.title.localeCompare(b.title)),
    [
      { kind: "new", title: "Share dashboard" },
      { kind: "related", title: "View dashboard" },
    ],
  );

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const nodes = await pool.query(
      "SELECT name FROM scenario_nodes ORDER BY name",
    );

    assert.ok(nodes.rows.length >= 4);
    assert.ok(nodes.rows.some((row) => row.name === "View dashboard"));
    assert.ok(nodes.rows.some((row) => row.name === "Share dashboard"));

    const proposals = await pool.query(
      "SELECT kind, title, status FROM scenario_proposals WHERE run_id = $1 ORDER BY title",
      [result.runId],
    );

    assert.deepEqual(proposals.rows, [
      { kind: "new", title: "Share dashboard", status: "confirmed" },
      { kind: "related", title: "View dashboard", status: "confirmed" },
    ]);

    const assets = await pool.query(
      "SELECT kind, title FROM scenario_assets WHERE run_id = $1 ORDER BY title",
      [result.runId],
    );

    assert.deepEqual(assets.rows, [
      { kind: "new", title: "Share dashboard" },
      { kind: "related", title: "View dashboard" },
    ]);

    const trace = await pool.query(
      "SELECT event_type FROM trace_events WHERE run_id = $1 ORDER BY id",
      [result.runId],
    );
    const eventTypes = trace.rows.map((row) => row.event_type);

    for (const expectedEvent of [
      "analysis_run_started",
      "scenario_subagent_started",
      "scenario_skill_loaded",
      "scenario_tree_queried",
      "scenario_proposals_generated",
      "scenario_confirmation_requested",
      "scenario_confirmation_received",
      "scenario_assets_persisted",
      "analysis_run_completed",
    ]) {
      assert.ok(
        eventTypes.includes(expectedEvent),
        `Expected trace event ${expectedEvent}; saw ${eventTypes.join(", ")}`,
      );
    }
  } finally {
    await pool.end();
  }
});
