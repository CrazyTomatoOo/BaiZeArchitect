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

test("approval advances one gate at a time and completes with a terminal snapshot", async () => {
  const databasePath = await temporaryDatabasePath("baize-approval-gates-");
  const requirement = "Add dashboard sharing";
  const useCaseProposals = [
    {
      kind: "related",
      title: "View dashboard on desktop",
      description:
        "Sharing a dashboard reuses the existing desktop viewing workflow.",
      scenarioTitle: "View dashboard",
    },
    {
      kind: "new",
      title: "Share dashboard with a teammate",
      description: "A user shares a dashboard and a teammate can open it.",
      scenarioTitle: "Share dashboard",
    },
  ];
  const featureProposals = [
    {
      kind: "affected",
      title: "Dashboard access control",
      description:
        "Sharing a dashboard must respect and extend existing dashboard access rules.",
      useCaseTitle: "Share dashboard with a teammate",
    },
    {
      kind: "new",
      title: "Dashboard sharing permissions",
      description:
        "A user grants and revokes another user's access to a dashboard.",
      useCaseTitle: "Share dashboard with a teammate",
    },
  ];

  const initial = await runGatedCli(["--gated", requirement], {
    BAIZE_DB_PATH: databasePath,
    BAIZE_MODEL: "",
  });
  assert.equal(initial.exitCode, 0, initial.stderr);
  const initialSnapshot = JSON.parse(initial.stdout) as {
    runId: string;
  };
  const runId = initialSnapshot.runId;
  const commands = {
    status: `npm start -- status ${runId}`,
    approve: `npm start -- resume ${runId} y`,
    reject: `npm start -- resume ${runId} n`,
    revise: `npm start -- resume ${runId} revise -- "<revision-feedback>"`,
  };

  async function approve(): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    snapshot: Record<string, unknown>;
  }> {
    const result = await runGatedCli(["resume", runId, "y"], {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.trim().split("\n").length, 1);

    return {
      ...result,
      snapshot: JSON.parse(result.stdout) as Record<string, unknown>,
    };
  }

  const useCaseGate = await approve();
  assert.deepEqual(Object.keys(useCaseGate.snapshot), [
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
  assert.deepEqual(useCaseGate.snapshot, {
    runId,
    status: "awaiting_confirmation",
    currentStage: "use_case",
    stageLabel: "Use case",
    requirement,
    gateOpen: true,
    resumeBlockedReason: null,
    proposals: useCaseProposals,
    scenarioAssetCount: 2,
    useCaseAssetCount: 0,
    featureAssetCount: 0,
    nextStageOnApprove: "feature",
    revisionStage: "use_case",
    nextCommand: commands.approve,
    commands,
  });
  assert.match(
    useCaseGate.stderr,
    /Requirement: Add dashboard sharing\nLifecycle status: awaiting_confirmation\nCurrent stage: Use case\nGate open: yes\nResume blocked: no\nProgress: 2 scenarios, 0 use cases, 0 features confirmed/,
  );
  assert.match(useCaseGate.stderr, /Approve will continue to: feature/);
  assert.match(useCaseGate.stderr, /Revise will rerun: use_case/);

  const featureGate = await approve();
  assert.deepEqual(featureGate.snapshot, {
    runId,
    status: "awaiting_confirmation",
    currentStage: "feature",
    stageLabel: "Feature",
    requirement,
    gateOpen: true,
    resumeBlockedReason: null,
    proposals: featureProposals,
    scenarioAssetCount: 2,
    useCaseAssetCount: 2,
    featureAssetCount: 0,
    nextStageOnApprove: null,
    revisionStage: "feature",
    nextCommand: commands.approve,
    commands,
  });
  assert.match(
    featureGate.stderr,
    /Requirement: Add dashboard sharing\nLifecycle status: awaiting_confirmation\nCurrent stage: Feature\nGate open: yes\nResume blocked: no\nProgress: 2 scenarios, 2 use cases, 0 features confirmed/,
  );
  assert.match(
    featureGate.stderr,
    /Approve will continue to: complete the run/,
  );
  assert.match(featureGate.stderr, /Revise will rerun: feature/);

  const terminal = await approve();
  assert.deepEqual(terminal.snapshot, {
    runId,
    status: "succeeded",
    currentStage: "feature",
    stageLabel: "Feature",
    requirement,
    gateOpen: false,
    resumeBlockedReason: "run_is_terminal",
    proposals: [],
    scenarioAssetCount: 2,
    useCaseAssetCount: 2,
    featureAssetCount: 2,
    nextStageOnApprove: null,
    revisionStage: null,
    nextCommand: null,
    commands: {
      status: commands.status,
      approve: null,
      reject: null,
      revise: null,
    },
  });
  assert.match(
    terminal.stderr,
    /Requirement: Add dashboard sharing\nLifecycle status: succeeded\nCurrent stage: Feature\nGate open: no\nResume blocked: run_is_terminal\nProgress: 2 scenarios, 2 use cases, 2 features confirmed/,
  );
  assert.match(terminal.stderr, /No Confirmation Gate is open\./);
  assert.match(
    terminal.stderr,
    new RegExp(`Status command: npm start -- status ${runId}`),
  );

  const pool = new SqlitePool(databasePath);
  try {
    const run = await pool.query(
      "SELECT status, current_stage FROM analysis_runs WHERE id = $1",
      [runId],
    );
    assert.deepEqual(run.rows[0], {
      status: "succeeded",
      current_stage: "feature",
    });

    assert.deepEqual(
      (
        await pool.query(
          "SELECT status, CAST(count(*) AS INTEGER) AS count\n          FROM scenario_proposals\n          WHERE run_id = $1\n          GROUP BY status\n          ORDER BY status",
          [runId],
        )
      ).rows,
      [{ status: "confirmed", count: 2 }],
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT CAST(count(*) AS INTEGER) AS count\n          FROM scenario_assets\n          WHERE run_id = $1",
          [runId],
        )
      ).rows,
      [{ count: 2 }],
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT status, CAST(count(*) AS INTEGER) AS count\n          FROM use_case_proposals\n          WHERE run_id = $1\n          GROUP BY status\n          ORDER BY status",
          [runId],
        )
      ).rows,
      [{ status: "confirmed", count: 2 }],
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT CAST(count(*) AS INTEGER) AS count\n          FROM use_case_assets\n          WHERE run_id = $1",
          [runId],
        )
      ).rows,
      [{ count: 2 }],
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT status, CAST(count(*) AS INTEGER) AS count\n          FROM feature_proposals\n          WHERE run_id = $1\n          GROUP BY status\n          ORDER BY status",
          [runId],
        )
      ).rows,
      [{ status: "confirmed", count: 2 }],
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT CAST(count(*) AS INTEGER) AS count\n          FROM feature_assets\n          WHERE run_id = $1",
          [runId],
        )
      ).rows,
      [{ count: 2 }],
    );

    const trace = await pool.query(
      "SELECT event_type FROM trace_events WHERE run_id = $1 ORDER BY id",
      [runId],
    );
    const events = trace.rows.map((row) => row.event_type as string);
    const first = (name: string): number => {
      const index = events.indexOf(name);
      assert.ok(index >= 0, `Expected trace event: ${name}`);
      return index;
    };

    assert.ok(
      first("scenario_assets_persisted") < first("use_case_subagent_started"),
    );
    assert.ok(
      first("use_case_subagent_started") < first("use_case_confirmation_requested"),
    );
    assert.ok(
      !events
        .slice(0, first("use_case_confirmation_requested"))
        .includes("feature_subagent_started"),
    );
    assert.ok(
      first("use_case_assets_persisted") < first("feature_subagent_started"),
    );
    assert.ok(
      first("feature_subagent_started") < first("feature_confirmation_requested"),
    );
    assert.ok(
      !events
        .slice(0, first("feature_confirmation_requested"))
        .includes("analysis_run_completed"),
    );
    assert.ok(
      first("feature_assets_persisted") < first("analysis_run_completed"),
    );
    assert.ok(!events.includes("analysis_run_failed"));
    assert.equal(
      events.filter((event) => event.endsWith("_confirmation_requested")).length,
      3,
    );
  } finally {
    await pool.end();
  }
});
