import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { SqlitePool } from "../../src/sqlite.ts";

interface CliResult {
  runId: string;
  status: string;
  scenarioAssetCount: number;
  useCaseAssetCount: number;
  featureAssetCount: number;
}

test("real-model smoke completes the full analysis workflow", async () => {
  const databasePath = process.env.BAIZE_DB_PATH;
  const model = process.env.BAIZE_MODEL?.trim();

  assert.ok(databasePath, "BAIZE_DB_PATH must be set for real-model smoke tests");
  assert.ok(
    model,
    "BAIZE_MODEL must be set for real-model smoke tests, for example deepseek/deepseek-v4-flash",
  );

  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-smoke-"));
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "Add dashboard sharing"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BAIZE_DB_PATH: databasePath,
        BAIZE_MODEL: model,
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

  assert.equal(exitCode, 0, `real-model smoke CLI failed: ${stderr}`);

  const result = JSON.parse(stdout) as CliResult;

  assert.equal(result.status, "succeeded");
  assert.ok(result.scenarioAssetCount > 0);
  assert.ok(result.useCaseAssetCount > 0);
  assert.ok(result.featureAssetCount > 0);

  const pool = new SqlitePool(databasePath);

  try {
    const run = await pool.query(
      "SELECT status, failure_code FROM analysis_runs WHERE id = $1",
      [result.runId],
    );

    assert.equal(run.rows[0].status, "succeeded");
    assert.equal(run.rows[0].failure_code, null);

    const scenarios = await pool.query(
      "SELECT kind, title, description FROM scenario_assets WHERE run_id = $1",
      [result.runId],
    );
    const useCases = await pool.query(
      `SELECT kind, title, description, scenario_asset_id
       FROM use_case_assets
       WHERE run_id = $1`,
      [result.runId],
    );
    const features = await pool.query(
      `SELECT kind, title, description, use_case_asset_id
       FROM feature_assets
       WHERE run_id = $1`,
      [result.runId],
    );

    assert.equal(scenarios.rows.length, result.scenarioAssetCount);
    assert.equal(useCases.rows.length, result.useCaseAssetCount);
    assert.equal(features.rows.length, result.featureAssetCount);

    for (const asset of [...scenarios.rows, ...useCases.rows, ...features.rows]) {
      assert.ok(asset.title.trim().length > 0);
      assert.ok(asset.description.trim().length > 0);
    }

    for (const scenario of scenarios.rows) {
      assert.ok(scenario.kind === "related" || scenario.kind === "new");
    }

    for (const useCase of useCases.rows) {
      assert.ok(useCase.kind === "related" || useCase.kind === "new");
      assert.ok(useCase.scenario_asset_id !== null);
    }

    for (const feature of features.rows) {
      assert.ok(feature.kind === "affected" || feature.kind === "new");
      assert.ok(feature.use_case_asset_id !== null);
    }

    const trace = await pool.query(
      "SELECT event_type, payload FROM trace_events WHERE run_id = $1 ORDER BY id",
      [result.runId],
    );
    const eventTypes = trace.rows.map((row) => row.event_type);

    for (const expectedEvent of [
      "analysis_run_started",
      "orchestrator_subagent_started",
      "orchestrator_skill_loaded",
      "analysis_contract_queried",
      "analysis_plan_created",
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
      "mcp_server_started",
      "mcp_tool_call",
      "mcp_tool_result",
    ]) {
      assert.ok(
        eventTypes.includes(expectedEvent),
        `real-model smoke expected trace event ${expectedEvent}`,
      );
    }

    assert.ok(!eventTypes.includes("analysis_run_failed"));

    const startedEvent = trace.rows.find(
      (row) => row.event_type === "analysis_run_started",
    );
    const startedPayload = startedEvent.payload as {
      modelMode?: string;
      model?: string;
    };

    assert.equal(startedPayload.modelMode, "real");
    assert.equal(startedPayload.model, model);

    const completedEvent = trace.rows.find(
      (row) => row.event_type === "analysis_run_completed",
    );

    assert.deepEqual(completedEvent.payload, {
      status: "succeeded",
      scenarioAssetCount: result.scenarioAssetCount,
      useCaseAssetCount: result.useCaseAssetCount,
      featureAssetCount: result.featureAssetCount,
    });
  } finally {
    await pool.end();
  }
});
