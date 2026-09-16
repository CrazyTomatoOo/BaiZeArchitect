import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createAnalysisRun,
  getAnalysisRun,
  initializeSchema,
} from "../src/db.ts";
import { SqlitePool } from "../src/sqlite.ts";

async function temporaryDatabasePath(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  return path.join(directory, "baize.sqlite3");
}

async function runGatedCli(
  args: string[],
  env: Record<string, string>,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", ...args],
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

  const close = once(child, "close");
  const timeout = setTimeout(() => child.kill("SIGTERM"), 15_000);
  try {
    const [exitCode] = await close;
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}

test("analysis_runs schema enforces the target gate state model", async () => {
  const databasePath = await temporaryDatabasePath("baize-schema-");
  const pool = new SqlitePool(databasePath);

  try {
    await initializeSchema(pool);
    const run = await createAnalysisRun(pool, "Add dashboard sharing");
    const record = await getAnalysisRun(pool, run.id);

    assert.equal(record?.status, "running");
    assert.equal(record?.currentStage, null);

    const columns = pool.database
      .prepare("PRAGMA table_info(analysis_runs)")
      .all() as Array<{ name: string; dflt_value: string | null }>;
    const statusColumn = columns.find((column) => column.name === "status");
    const currentStageColumn = columns.find(
      (column) => column.name === "current_stage",
    );

    assert.equal(statusColumn?.dflt_value, "'running'");
    assert.equal(currentStageColumn?.dflt_value, "NULL");

    assert.throws(
      () =>
        pool.database
          .prepare("UPDATE analysis_runs SET status = ? WHERE id = ?")
          .run("awaiting_scenario_confirmation", run.id),
      /CHECK constraint failed/,
    );
    assert.throws(
      () =>
        pool.database
          .prepare("UPDATE analysis_runs SET current_stage = ? WHERE id = ?")
          .run("dashboard", run.id),
      /CHECK constraint failed/,
    );
    assert.throws(
      () =>
        pool.database
          .prepare("UPDATE analysis_runs SET status = ? WHERE id = ?")
          .run("awaiting_confirmation", run.id),
      /CHECK constraint failed/,
    );
  } finally {
    await pool.end();
  }
});

test("initial gated invocation stops at the scenario gate with a Run Snapshot", async () => {
  const databasePath = await temporaryDatabasePath("baize-scenario-gate-");
  const requirement = "Add dashboard sharing";
  const proposals = [
    {
      kind: "related",
      title: "View dashboard",
      description:
        "Dashboard sharing extends the existing dashboard viewing scenario.",
    },
    {
      kind: "new",
      title: "Share dashboard",
      description: "A user shares a dashboard with another user.",
    },
  ];

  const initial = await runGatedCli(["--gated", requirement], {
    BAIZE_DB_PATH: databasePath,
    BAIZE_MODEL: "",
  });

  assert.equal(initial.exitCode, 0, initial.stderr);
  assert.equal(initial.stdout.trim().split("\n").length, 1);

  const snapshot = JSON.parse(initial.stdout) as Record<string, unknown>;
  assert.deepEqual(Object.keys(snapshot), [
    "runId",
    "status",
    "currentStage",
    "stageLabel",
    "requirement",
    "gateOpen",
    "resumeBlockedReason",
    "proposals",
    "scenarioAssetCount",
    "useCaseAssetCount",
    "featureAssetCount",
    "nextStageOnApprove",
    "revisionStage",
    "nextCommand",
    "commands",
  ]);

  const runId = snapshot.runId as string;
  const commands = {
    status: `npm start -- status ${runId}`,
    approve: `npm start -- resume ${runId} y`,
    reject: `npm start -- resume ${runId} n`,
    revise: `npm start -- resume ${runId} revise -- "<revision-feedback>"`,
  };

  assert.deepEqual(snapshot, {
    runId,
    status: "awaiting_confirmation",
    currentStage: "scenario",
    stageLabel: "Scenario",
    requirement,
    gateOpen: true,
    resumeBlockedReason: null,
    proposals,
    scenarioAssetCount: 0,
    useCaseAssetCount: 0,
    featureAssetCount: 0,
    nextStageOnApprove: "use_case",
    revisionStage: "scenario",
    nextCommand: commands.approve,
    commands,
  });

  assert.match(
    initial.stderr,
    /Requirement: Add dashboard sharing\nLifecycle status: awaiting_confirmation\nCurrent stage: Scenario\nGate open: yes\nResume blocked: no\nProgress: 0 scenarios, 0 use cases, 0 features confirmed/,
  );
  assert.match(initial.stderr, /Approve will continue to: use_case/);
  assert.match(initial.stderr, /Revise will rerun: scenario/);
  assert.match(initial.stderr, /Commands:/);

  const pool = new SqlitePool(databasePath);
  try {
    const run = await pool.query(
      "SELECT status, current_stage FROM analysis_runs WHERE id = $1",
      [runId],
    );
    assert.deepEqual(run.rows[0], {
      status: "awaiting_confirmation",
      current_stage: "scenario",
    });
  } finally {
    await pool.end();
  }
});
