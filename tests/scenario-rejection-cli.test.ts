import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { SqlitePool } from "../src/sqlite.ts";

test("scenario CLI rejects proposals without persisting assets", async () => {
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));
  const databasePath = process.env.BAIZE_DB_PATH;

  assert.ok(
    databasePath,
    "BAIZE_DB_PATH must be set for the scenario rejection integration test",
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

  child.stdin.write("n\n");
  child.stdin.end();

  const [exitCode] = await once(child, "close");

  assert.equal(exitCode, 2);
  assert.match(stderr, /Confirm scenario proposals\?/);

  const result = JSON.parse(stdout) as {
    runId: string;
    status: string;
    scenarioAssetCount: number;
    confirmedScenarios: unknown[];
  };

  assert.equal(result.status, "rejected");
  assert.equal(result.scenarioAssetCount, 0);
  assert.deepEqual(result.confirmedScenarios, []);

  const pool = new SqlitePool(databasePath);

  try {
    const proposals = await pool.query(
      "SELECT status FROM scenario_proposals WHERE run_id = $1",
      [result.runId],
    );

    assert.ok(proposals.rows.length > 0);
    assert.ok(
      proposals.rows.every((row) => row.status === "rejected"),
    );

    const assets = await pool.query(
      "SELECT id FROM scenario_assets WHERE run_id = $1",
      [result.runId],
    );

    assert.equal(assets.rows.length, 0);
  } finally {
    await pool.end();
  }
});
