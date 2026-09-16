import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { SqlitePool } from "../src/sqlite.ts";

test("use case CLI proposes and persists confirmed use cases", async () => {
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));
  const databasePath = process.env.BAIZE_DB_PATH;

  assert.ok(
    databasePath,
    "BAIZE_DB_PATH must be set for the use case CLI integration test",
  );

  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "Add dashboard sharing"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BAIZE_DB_PATH: databasePath,
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

  const result = JSON.parse(stdout) as {
    runId: string;
    status: string;
    scenarioAssetCount: number;
    useCaseAssetCount: number;
    confirmedUseCases: Array<{
      kind: string;
      title: string;
    }>;
  };

  assert.equal(result.status, "succeeded");
  assert.equal(result.scenarioAssetCount, 2);
  assert.equal(result.useCaseAssetCount, 2);
  assert.deepEqual(
    [...result.confirmedUseCases].sort((a, b) => a.title.localeCompare(b.title)),
    [
      { kind: "new", title: "Share dashboard with a teammate" },
      { kind: "related", title: "View dashboard on desktop" },
    ],
  );

  const pool = new SqlitePool(databasePath);

  try {
    const useCases = await pool.query(
      `SELECT uc.title, s.name AS scenario_name
       FROM use_case_nodes uc
       JOIN scenario_nodes s ON s.id = uc.scenario_id
       ORDER BY uc.title`,
    );

    assert.ok(useCases.rows.length >= 2);
    assert.ok(
      useCases.rows.some(
        (row) =>
          row.title === "View dashboard on desktop" &&
          row.scenario_name === "View dashboard",
      ),
    );
    assert.ok(
      useCases.rows.some(
        (row) =>
          row.title === "Share dashboard with a teammate" &&
          row.scenario_name === "Share dashboard",
      ),
    );

    const proposals = await pool.query(
      `SELECT kind, title, status
       FROM use_case_proposals
       WHERE run_id = $1
       ORDER BY title`,
      [result.runId],
    );

    assert.deepEqual(proposals.rows, [
      {
        kind: "new",
        title: "Share dashboard with a teammate",
        status: "confirmed",
      },
      {
        kind: "related",
        title: "View dashboard on desktop",
        status: "confirmed",
      },
    ]);

    const assets = await pool.query(
      `SELECT kind, title
       FROM use_case_assets
       WHERE run_id = $1
       ORDER BY title`,
      [result.runId],
    );

    assert.deepEqual(assets.rows, [
      { kind: "new", title: "Share dashboard with a teammate" },
      { kind: "related", title: "View dashboard on desktop" },
    ]);

    const trace = await pool.query(
      `SELECT event_type, payload
       FROM trace_events
       WHERE run_id = $1
       ORDER BY id`,
      [result.runId],
    );
    const eventTypes = trace.rows.map((row) => row.event_type);

    for (const expectedEvent of [
      "use_case_subagent_started",
      "use_case_skill_loaded",
      "use_case_library_queried",
      "use_case_proposals_generated",
      "use_case_confirmation_requested",
      "use_case_confirmation_received",
      "use_case_assets_persisted",
      "analysis_run_completed",
    ]) {
      assert.ok(
        eventTypes.includes(expectedEvent),
        `Expected trace event ${expectedEvent}; saw ${eventTypes.join(", ")}`,
      );
    }

    const startedEvent = trace.rows.find(
      (row) => row.event_type === "use_case_subagent_started",
    );
    const confirmedScenarios = (startedEvent.payload as {
      confirmedScenarios?: Array<{ title?: string }>;
    }).confirmedScenarios;

    assert.ok(
      confirmedScenarios?.some((scenario) => scenario.title === "Share dashboard"),
    );
  } finally {
    await pool.end();
  }
});
