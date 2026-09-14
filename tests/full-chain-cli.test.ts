import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

test("full chain CLI orchestrates the complete analysis workflow", async () => {
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(
    databaseUrl,
    "DATABASE_URL must be set for the full chain CLI integration test",
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
    scenarioAssetCount: number;
    useCaseAssetCount: number;
    featureAssetCount: number;
  };

  assert.equal(result.status, "succeeded");
  assert.equal(result.scenarioAssetCount, 2);
  assert.equal(result.useCaseAssetCount, 2);
  assert.equal(result.featureAssetCount, 2);

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const run = await pool.query(
      "SELECT status FROM analysis_runs WHERE id = $1",
      [result.runId],
    );

    assert.equal(run.rows[0].status, "succeeded");

    for (const [table, expectedCount] of [
      ["scenario_assets", 2],
      ["use_case_assets", 2],
      ["feature_assets", 2],
    ] as const) {
      const assets = await pool.query(
        `SELECT id FROM ${table} WHERE run_id = $1`,
        [result.runId],
      );

      assert.equal(assets.rows.length, expectedCount);
    }

    const trace = await pool.query(
      `SELECT event_type, payload
       FROM trace_events
       WHERE run_id = $1
       ORDER BY id`,
      [result.runId],
    );
    const eventTypes = trace.rows.map((row) => row.event_type);

    assert.equal(eventTypes[0], "analysis_run_started");
    assert.equal(eventTypes[1], "orchestrator_subagent_started");

    const skillLoadedIndex = eventTypes.indexOf("orchestrator_skill_loaded");
    const contractQueriedIndex = eventTypes.indexOf(
      "analysis_contract_queried",
    );
    const planCreatedIndex = eventTypes.indexOf("analysis_plan_created");
    const scenarioStartedIndex = eventTypes.indexOf(
      "scenario_subagent_started",
    );

    assert.ok(skillLoadedIndex > -1);
    assert.ok(contractQueriedIndex > skillLoadedIndex);
    assert.ok(planCreatedIndex > contractQueriedIndex);
    assert.ok(scenarioStartedIndex > planCreatedIndex);

    for (const expectedEvent of [
      "scenario_subagent_started",
      "scenario_skill_loaded",
      "scenario_tree_queried",
      "scenario_proposals_generated",
      "scenario_confirmation_requested",
      "scenario_confirmation_received",
      "scenario_assets_persisted",
      "use_case_subagent_started",
      "use_case_skill_loaded",
      "use_case_library_queried",
      "use_case_proposals_generated",
      "use_case_confirmation_requested",
      "use_case_confirmation_received",
      "use_case_assets_persisted",
      "feature_subagent_started",
      "feature_skill_loaded",
      "feature_library_queried",
      "feature_proposals_generated",
      "feature_confirmation_requested",
      "feature_confirmation_received",
      "feature_assets_persisted",
      "analysis_run_completed",
    ]) {
      assert.ok(
        eventTypes.includes(expectedEvent),
        `Expected trace event ${expectedEvent}; saw ${eventTypes.join(", ")}`,
      );
    }

    const planEvent = trace.rows.find(
      (row) => row.event_type === "analysis_plan_created",
    );
    const stages = (planEvent.payload as {
      stages?: Array<{ name?: string }>;
    }).stages;

    assert.deepEqual(stages?.map((stage) => stage.name), [
      "scenario",
      "use_case",
      "feature",
    ]);

    for (const [eventName, expectedStage] of [
      ["scenario_subagent_started", "scenario"],
      ["use_case_subagent_started", "use_case"],
      ["feature_subagent_started", "feature"],
    ] as const) {
      const startEvent = trace.rows.find(
        (row) => row.event_type === eventName,
      );
      const planStage = (startEvent.payload as {
        planStage?: { name?: string };
      }).planStage;

      assert.equal(planStage?.name, expectedStage);
    }

    const completedEvent = trace.rows.find(
      (row) => row.event_type === "analysis_run_completed",
    );

    assert.deepEqual(
      (completedEvent.payload as Record<string, unknown>),
      {
        status: "succeeded",
        scenarioAssetCount: 2,
        useCaseAssetCount: 2,
        featureAssetCount: 2,
      },
    );
  } finally {
    await pool.end();
  }
});
