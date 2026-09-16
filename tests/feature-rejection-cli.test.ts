import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { SqlitePool } from "../src/sqlite.ts";

test("feature CLI rejects proposals without persisting assets", async () => {
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));
  const databasePath = process.env.BAIZE_DB_PATH;

  assert.ok(
    databasePath,
    "BAIZE_DB_PATH must be set for the feature rejection CLI integration test",
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
  child.stdin.write("n\n");
  child.stdin.end();

  const [exitCode] = await once(child, "close");

  assert.equal(exitCode, 2);
  assert.match(stderr, /Confirm scenario proposals\?/);
  assert.match(stderr, /Confirm use case proposals\?/);
  assert.match(stderr, /Confirm feature proposals\?/);

  const result = JSON.parse(stdout) as {
    runId: string;
    status: string;
    scenarioAssetCount: number;
    useCaseAssetCount: number;
    featureAssetCount: number;
    confirmedFeatures: unknown[];
  };

  assert.equal(result.status, "rejected");
  assert.equal(result.scenarioAssetCount, 2);
  assert.equal(result.useCaseAssetCount, 2);
  assert.equal(result.featureAssetCount, 0);
  assert.deepEqual(result.confirmedFeatures, []);

  const pool = new SqlitePool(databasePath);

  try {
    const scenarioAssets = await pool.query(
      "SELECT id FROM scenario_assets WHERE run_id = $1",
      [result.runId],
    );
    const useCaseAssets = await pool.query(
      "SELECT id FROM use_case_assets WHERE run_id = $1",
      [result.runId],
    );

    assert.equal(scenarioAssets.rows.length, 2);
    assert.equal(useCaseAssets.rows.length, 2);

    const proposals = await pool.query(
      "SELECT status FROM feature_proposals WHERE run_id = $1",
      [result.runId],
    );

    assert.equal(proposals.rows.length, 2);
    assert.ok(proposals.rows.every((row) => row.status === "rejected"));

    const assets = await pool.query(
      "SELECT id FROM feature_assets WHERE run_id = $1",
      [result.runId],
    );

    assert.equal(assets.rows.length, 0);

    const trace = await pool.query(
      `SELECT event_type, payload
       FROM trace_events
       WHERE run_id = $1
       ORDER BY id`,
      [result.runId],
    );
    const eventTypes = trace.rows.map((row) => row.event_type);

    for (const expectedEvent of [
      "feature_confirmation_requested",
      "feature_confirmation_received",
      "analysis_run_completed",
    ]) {
      assert.ok(
        eventTypes.includes(expectedEvent),
        `Expected trace event ${expectedEvent}; saw ${eventTypes.join(", ")}`,
      );
    }

    const confirmationEvent = trace.rows.find(
      (row) => row.event_type === "feature_confirmation_received",
    );

    assert.equal(
      (confirmationEvent.payload as { confirmed?: boolean }).confirmed,
      false,
    );
  } finally {
    await pool.end();
  }
});
