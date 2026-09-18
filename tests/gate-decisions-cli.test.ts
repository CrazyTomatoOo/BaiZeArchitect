import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { SqlitePool } from "../src/sqlite.ts";

interface Snapshot {
  runId: string;
  status: string;
  currentStage: string;
  gateOpen: boolean;
  proposals: Record<string, unknown>[];
  scenarioAssetCount: number;
  useCaseAssetCount: number;
  featureAssetCount: number;
}

async function runCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));
  const child = spawn(process.execPath, [
    "--import",
    "tsx",
    "src/cli.ts",
    ...args,
  ], {
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

  const close = once(child, "close");
  const timeout = setTimeout(() => child.kill("SIGTERM"), 10_000);
  try {
    const [exitCode] = await close;
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}

// Exercise each decision through a fresh CLI process; SQLite is the durable
// state and trace observation surface specified by #117 and #120.
for (const [stageIndex, stage] of ["scenario", "use_case", "feature"].entries()) {
  test(`gated ${stage} revision retains proposal context and earlier approvals`, async () => {
    const initial = await runCli(["--gated", "Add dashboard sharing"]);
    assert.equal(initial.exitCode, 0, initial.stderr);
    let snapshot = JSON.parse(initial.stdout) as Snapshot;
    for (let index = 0; index < stageIndex; index++) {
      const approved = await runCli(["resume", snapshot.runId, "y"]);
      assert.equal(approved.exitCode, 0, approved.stderr);
      snapshot = JSON.parse(approved.stdout) as Snapshot;
    }
    const pool = new SqlitePool(process.env.BAIZE_DB_PATH);
    const runId = snapshot.runId;
    const assets = async () => Promise.all(
      ["scenario", "use_case", "feature"].map(async (name) =>
        (await pool.query(`SELECT * FROM ${name}_assets WHERE run_id = $1 ORDER BY rowid`, [runId])).rows),
    );
    const starts = async () => (await pool.query(
      "SELECT event_type FROM trace_events WHERE run_id = $1 AND event_type LIKE '%subagent_started' ORDER BY id",
      [runId],
    )).rows.map((row) => row.event_type);
    try {
      const originalAssets = await assets();
      const originalStarts = await starts();
      for (const revision of [1, 2]) {
        const previous = snapshot.proposals;
        const proposal = {
          ...previous[0],
          kind: "new",
          title: `Revised ${stage} ${revision}`,
          description: `Sharing restricted to one teammate, revision ${revision}.`,
        };
        const feedback = `Restrict sharing to one teammate (${revision})`;
        const revised = await runCli(["resume", runId, "revise", "--", feedback], {
          BAIZE_FAUX_MODEL_OUTPUT: JSON.stringify({ proposals: [proposal] }),
        });
        assert.equal(revised.exitCode, 0, revised.stderr);
        snapshot = JSON.parse(revised.stdout) as Snapshot;
        assert.equal(snapshot.status, "awaiting_confirmation");
        assert.equal(snapshot.currentStage, stage);
        assert.equal(snapshot.gateOpen, true);
        assert.deepEqual([
          snapshot.scenarioAssetCount, snapshot.useCaseAssetCount, snapshot.featureAssetCount,
        ], originalAssets.map((items) => items.length));
        const run = await pool.query(
          "SELECT status, current_stage FROM analysis_runs WHERE id = $1", [runId],
        );
        assert.deepEqual(run.rows, [{ status: "awaiting_confirmation", current_stage: stage }]);
        assert.deepEqual(snapshot.proposals, [proposal]);
        assert.deepEqual(await assets(), originalAssets);
        assert.deepEqual(await starts(), [
          ...originalStarts,
          ...Array(revision).fill(`${stage}_subagent_started`),
        ]);
        const trace = await pool.query(
          "SELECT payload FROM trace_events WHERE run_id = $1 AND event_type = 'analysis_run_revision_requested' ORDER BY id",
          [runId],
        );
        assert.equal(trace.rows.length, revision);
        assert.deepEqual(trace.rows[revision - 1].payload, {
          stage, feedback,
          previousProposals: previous.map((item) => ({ ...item, status: "proposed" })),
        });
        const proposals = await pool.query(
          `SELECT title, status FROM ${stage}_proposals WHERE run_id = $1 ORDER BY rowid`, [runId],
        );
        assert.ok(proposals.rows.slice(0, -1).every((item) => item.status === "rejected"));
        assert.deepEqual(proposals.rows.at(-1), { title: proposal.title, status: "proposed" });
      }
    } finally {
      await pool.end();
    }
  });
}

for (const [stageIndex, stage] of ["scenario", "use_case", "feature"].entries()) {
  test(`gated ${stage} rejection terminates without starting another stage`, async () => {
    const initial = await runCli(["--gated", "Add dashboard sharing"]);
    assert.equal(initial.exitCode, 0, initial.stderr);
    let snapshot = JSON.parse(initial.stdout) as Snapshot;
    for (let index = 0; index < stageIndex; index++) {
      const approved = await runCli(["resume", snapshot.runId, "y"]);
      assert.equal(approved.exitCode, 0, approved.stderr);
      snapshot = JSON.parse(approved.stdout) as Snapshot;
    }
    const runId = snapshot.runId;
    const pool = new SqlitePool(process.env.BAIZE_DB_PATH);
    try {
      const before = (await pool.query(
        "SELECT event_type FROM trace_events WHERE run_id = $1 AND event_type LIKE '%subagent_started' ORDER BY id", [runId],
      )).rows;
      const rejected = await runCli(["resume", runId, "n"]);
      assert.equal(rejected.exitCode, 2, rejected.stderr);
      const result = JSON.parse(rejected.stdout) as Snapshot;
      assert.equal(result.status, "rejected");
      assert.equal(result.currentStage, stage);
      assert.equal(result.gateOpen, false);
      assert.deepEqual(result.proposals, []);
      assert.deepEqual(
        [result.scenarioAssetCount, result.useCaseAssetCount, result.featureAssetCount],
        [snapshot.scenarioAssetCount, snapshot.useCaseAssetCount, snapshot.featureAssetCount],
      );
      assert.match(rejected.stderr, /Lifecycle status: rejected/);
      const run = await pool.query("SELECT status, current_stage FROM analysis_runs WHERE id = $1", [runId]);
      assert.deepEqual(run.rows, [{ status: "rejected", current_stage: stage }]);
      const proposals = await pool.query(`SELECT status FROM ${stage}_proposals WHERE run_id = $1`, [runId]);
      assert.equal(proposals.rows.length, snapshot.proposals.length);
      assert.ok(proposals.rows.every((item) => item.status === "rejected"));
      const after = (await pool.query(
        "SELECT event_type FROM trace_events WHERE run_id = $1 AND event_type LIKE '%subagent_started' ORDER BY id", [runId],
      )).rows;
      assert.deepEqual(after, before);
      for (const futureStage of ["scenario", "use_case", "feature"].slice(stageIndex)) {
        assert.deepEqual((await pool.query(`SELECT id FROM ${futureStage}_assets WHERE run_id = $1`, [runId])).rows, []);
      }
    } finally {
      await pool.end();
    }
  });
}
