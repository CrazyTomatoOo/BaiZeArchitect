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

test("scenario revision returns a Run Snapshot with only newly proposed items", async () => {
  const databasePath = await temporaryDatabasePath(
    "baize-scenario-revision-",
  );
  const requirement = "Add dashboard sharing";
  const revisedProposal = {
    kind: "new",
    title: "Share dashboard with sharing controls",
    description:
      "A dashboard owner shares a dashboard and manages the recipient's access.",
  };

  const initial = await runGatedCli(["--gated", requirement], {
    BAIZE_DB_PATH: databasePath,
    BAIZE_MODEL: "",
  });
  assert.equal(initial.exitCode, 0, initial.stderr);

  const initialSnapshot = JSON.parse(initial.stdout) as { runId: string };
  const runId = initialSnapshot.runId;
  const revision = await runGatedCli(
    ["resume", runId, "revise", "--", "Focus the scenario on sharing controls"],
    {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
      BAIZE_FAUX_MODEL_OUTPUT: JSON.stringify({
        proposals: [revisedProposal],
      }),
    },
  );

  assert.equal(revision.exitCode, 0, revision.stderr);
  assert.equal(revision.stdout.trim().split("\n").length, 1);

  const snapshot = JSON.parse(revision.stdout) as Record<string, unknown>;
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
  assert.deepEqual(snapshot, {
    runId,
    status: "awaiting_confirmation",
    currentStage: "scenario",
    stageLabel: "Scenario",
    requirement,
    gateOpen: true,
    resumeBlockedReason: null,
    proposals: [revisedProposal],
    scenarioAssetCount: 0,
    useCaseAssetCount: 0,
    featureAssetCount: 0,
    nextStageOnApprove: "use_case",
    revisionStage: "scenario",
    nextCommand: `npm start -- resume ${runId} y`,
    commands: {
      status: `npm start -- status ${runId}`,
      approve: `npm start -- resume ${runId} y`,
      reject: `npm start -- resume ${runId} n`,
      revise: `npm start -- resume ${runId} revise -- "<revision-feedback>"`,
    },
  });
  assert.match(
    revision.stderr,
    /Requirement: Add dashboard sharing\nLifecycle status: awaiting_confirmation\nCurrent stage: Scenario\nGate open: yes\nResume blocked: no\nProgress: 0 scenarios, 0 use cases, 0 features confirmed/,
  );
  assert.match(revision.stderr, /- \[new\] Share dashboard with sharing controls/);
  assert.match(revision.stderr, /Approve will continue to: use_case/);
  assert.match(revision.stderr, /Revise will rerun: scenario/);

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

    const proposals = await pool.query(
      "SELECT title, status FROM scenario_proposals WHERE run_id = $1 ORDER BY title",
      [runId],
    );
    assert.deepEqual(proposals.rows, [
      { title: "Share dashboard", status: "rejected" },
      { title: "Share dashboard with sharing controls", status: "proposed" },
      { title: "View dashboard", status: "rejected" },
    ]);

    const trace = await pool.query(
      "SELECT event_type, payload FROM trace_events WHERE run_id = $1 ORDER BY id",
      [runId],
    );
    const events = trace.rows.map((row) => row.event_type as string);
    const revisionEvent = trace.rows.find(
      (row) => row.event_type === "analysis_run_revision_requested",
    );
    assert.ok(revisionEvent);
    assert.equal((revisionEvent.payload as { stage?: string }).stage, "scenario");
    assert.equal(
      (revisionEvent.payload as { feedback?: string }).feedback,
      "Focus the scenario on sharing controls",
    );
    assert.equal(
      (revisionEvent.payload as { previousProposals?: unknown[] })
        .previousProposals?.length,
      2,
    );
    assert.ok(!events.includes("use_case_subagent_started"));
  } finally {
    await pool.end();
  }
});

test("use-case and feature revisions preserve approved earlier assets", async () => {
  const databasePath = await temporaryDatabasePath(
    "baize-later-stage-revisions-",
  );
  const requirement = "Add dashboard sharing";
  const revisedUseCase = {
    kind: "new",
    title: "Revised share use case",
    description:
      "A dashboard owner shares one dashboard with one teammate and can revoke access.",
    scenarioTitle: "Share dashboard",
  };
  const initialFeature = {
    kind: "new",
    title: "Initial sharing permission",
    description:
      "A dashboard owner controls another user's access to a shared dashboard.",
    useCaseTitle: "Revised share use case",
  };
  const revisedFeature = {
    kind: "new",
    title: "Revised sharing permission",
    description:
      "A dashboard owner grants and revokes one teammate's access to a dashboard.",
    useCaseTitle: "Revised share use case",
  };

  const initial = await runGatedCli(["--gated", requirement], {
    BAIZE_DB_PATH: databasePath,
    BAIZE_MODEL: "",
  });
  assert.equal(initial.exitCode, 0, initial.stderr);
  const runId = (JSON.parse(initial.stdout) as { runId: string }).runId;
  const commands = {
    status: `npm start -- status ${runId}`,
    approve: `npm start -- resume ${runId} y`,
    reject: `npm start -- resume ${runId} n`,
    revise: `npm start -- resume ${runId} revise -- "<revision-feedback>"`,
  };

  const scenarioApproval = await runGatedCli(["resume", runId, "y"], {
    BAIZE_DB_PATH: databasePath,
    BAIZE_MODEL: "",
  });
  assert.equal(scenarioApproval.exitCode, 0, scenarioApproval.stderr);

  const useCaseRevision = await runGatedCli(
    ["resume", runId, "revise", "--", "Focus on one teammate"],
    {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
      BAIZE_FAUX_MODEL_OUTPUT: JSON.stringify({
        proposals: [revisedUseCase],
      }),
    },
  );
  assert.equal(useCaseRevision.exitCode, 0, useCaseRevision.stderr);
  assert.equal(useCaseRevision.stdout.trim().split("\n").length, 1);

  const useCaseSnapshot = JSON.parse(useCaseRevision.stdout) as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(useCaseSnapshot), [
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
  assert.deepEqual(useCaseSnapshot, {
    runId,
    status: "awaiting_confirmation",
    currentStage: "use_case",
    stageLabel: "Use case",
    requirement,
    gateOpen: true,
    resumeBlockedReason: null,
    proposals: [revisedUseCase],
    scenarioAssetCount: 2,
    useCaseAssetCount: 0,
    featureAssetCount: 0,
    nextStageOnApprove: "feature",
    revisionStage: "use_case",
    nextCommand: commands.approve,
    commands,
  });
  assert.match(
    useCaseRevision.stderr,
    /Requirement: Add dashboard sharing\nLifecycle status: awaiting_confirmation\nCurrent stage: Use case\nGate open: yes\nResume blocked: no\nProgress: 2 scenarios, 0 use cases, 0 features confirmed/,
  );
  assert.match(useCaseRevision.stderr, /- \[new\] Revised share use case/);
  assert.match(useCaseRevision.stderr, /Approve will continue to: feature/);
  assert.match(useCaseRevision.stderr, /Revise will rerun: use_case/);

  const useCaseApproval = await runGatedCli(["resume", runId, "y"], {
    BAIZE_DB_PATH: databasePath,
    BAIZE_MODEL: "",
    BAIZE_FAUX_MODEL_OUTPUT: JSON.stringify({
      proposals: [initialFeature],
    }),
  });
  assert.equal(useCaseApproval.exitCode, 0, useCaseApproval.stderr);

  const featureRevision = await runGatedCli(
    ["resume", runId, "revise", "--", "Emphasize revocable access"],
    {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
      BAIZE_FAUX_MODEL_OUTPUT: JSON.stringify({
        proposals: [revisedFeature],
      }),
    },
  );
  assert.equal(featureRevision.exitCode, 0, featureRevision.stderr);
  assert.equal(featureRevision.stdout.trim().split("\n").length, 1);

  const featureSnapshot = JSON.parse(featureRevision.stdout) as Record<
    string,
    unknown
  >;
  assert.deepEqual(featureSnapshot, {
    runId,
    status: "awaiting_confirmation",
    currentStage: "feature",
    stageLabel: "Feature",
    requirement,
    gateOpen: true,
    resumeBlockedReason: null,
    proposals: [revisedFeature],
    scenarioAssetCount: 2,
    useCaseAssetCount: 1,
    featureAssetCount: 0,
    nextStageOnApprove: null,
    revisionStage: "feature",
    nextCommand: commands.approve,
    commands,
  });
  assert.match(
    featureRevision.stderr,
    /Requirement: Add dashboard sharing\nLifecycle status: awaiting_confirmation\nCurrent stage: Feature\nGate open: yes\nResume blocked: no\nProgress: 2 scenarios, 1 use cases, 0 features confirmed/,
  );
  assert.match(featureRevision.stderr, /- \[new\] Revised sharing permission/);
  assert.match(
    featureRevision.stderr,
    /Approve will continue to: complete the run/,
  );
  assert.match(featureRevision.stderr, /Revise will rerun: feature/);

  const pool = new SqlitePool(databasePath);
  try {
    const run = await pool.query(
      "SELECT status, current_stage FROM analysis_runs WHERE id = $1",
      [runId],
    );
    assert.deepEqual(run.rows[0], {
      status: "awaiting_confirmation",
      current_stage: "feature",
    });

    for (const [table, status, count] of [
      ["scenario_proposals", "confirmed", 2],
      ["use_case_proposals", "confirmed", 1],
      ["use_case_proposals", "rejected", 2],
      ["feature_proposals", "proposed", 1],
      ["feature_proposals", "rejected", 1],
    ] as const) {
      const proposals = await pool.query(
        `SELECT CAST(count(*) AS INTEGER) AS count
         FROM ${table}
         WHERE run_id = $1 AND status = $2`,
        [runId, status],
      );
      assert.deepEqual(proposals.rows, [{ count }]);
    }

    for (const [table, count] of [
      ["scenario_assets", 2],
      ["use_case_assets", 1],
      ["feature_assets", 0],
    ] as const) {
      const assets = await pool.query(
        `SELECT CAST(count(*) AS INTEGER) AS count
         FROM ${table}
         WHERE run_id = $1`,
        [runId],
      );
      assert.deepEqual(assets.rows, [{ count }]);
    }

    const trace = await pool.query(
      "SELECT event_type, payload FROM trace_events WHERE run_id = $1 ORDER BY id",
      [runId],
    );
    const events = trace.rows.map((row) => row.event_type as string);
    const useCaseRevisionEvent = trace.rows.find(
      (row) =>
        row.event_type === "analysis_run_revision_requested" &&
        (row.payload as { stage?: string }).stage === "use_case",
    );
    const featureRevisionEvent = trace.rows.find(
      (row) =>
        row.event_type === "analysis_run_revision_requested" &&
        (row.payload as { stage?: string }).stage === "feature",
    );
    assert.ok(useCaseRevisionEvent);
    assert.equal(
      (useCaseRevisionEvent.payload as { feedback?: string }).feedback,
      "Focus on one teammate",
    );
    assert.equal(
      (useCaseRevisionEvent.payload as { previousProposals?: unknown[] })
        .previousProposals?.length,
      2,
    );
    assert.ok(featureRevisionEvent);
    assert.equal(
      (featureRevisionEvent.payload as { feedback?: string }).feedback,
      "Emphasize revocable access",
    );
    assert.equal(
      (featureRevisionEvent.payload as { previousProposals?: unknown[] })
        .previousProposals?.length,
      1,
    );
    assert.ok(!events.includes("analysis_run_completed"));
  } finally {
    await pool.end();
  }
});

test("rejection at every gate returns a terminal Run Snapshot", async () => {
  const requirement = "Add dashboard sharing";

  async function rejectAtStage(stage: "scenario" | "use_case" | "feature"): Promise<{
    databasePath: string;
    runId: string;
    snapshot: Record<string, unknown>;
    stderr: string;
  }> {
    const databasePath = await temporaryDatabasePath(
      `baize-${stage}-rejection-`,
    );
    const initial = await runGatedCli(["--gated", requirement], {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
    });
    assert.equal(initial.exitCode, 0, initial.stderr);

    const runId = (JSON.parse(initial.stdout) as { runId: string }).runId;

    if (stage !== "scenario") {
      const scenarioApproval = await runGatedCli(
        ["resume", runId, "y"],
        {
          BAIZE_DB_PATH: databasePath,
          BAIZE_MODEL: "",
        },
      );
      assert.equal(scenarioApproval.exitCode, 0, scenarioApproval.stderr);
    }

    if (stage === "feature") {
      const useCaseApproval = await runGatedCli(
        ["resume", runId, "y"],
        {
          BAIZE_DB_PATH: databasePath,
          BAIZE_MODEL: "",
        },
      );
      assert.equal(useCaseApproval.exitCode, 0, useCaseApproval.stderr);
    }

    const rejection = await runGatedCli(["resume", runId, "n"], {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
    });
    assert.equal(rejection.exitCode, 2, rejection.stderr);
    assert.equal(rejection.stdout.trim().split("\n").length, 1);

    const snapshot = JSON.parse(rejection.stdout) as Record<string, unknown>;
    return { databasePath, runId, snapshot, stderr: rejection.stderr };
  }

  async function assertRejectedRun(
    stage: "scenario" | "use_case" | "feature",
    databasePath: string,
    runId: string,
  ): Promise<void> {
    const pool = new SqlitePool(databasePath);
    try {
      const run = await pool.query(
        "SELECT status, current_stage FROM analysis_runs WHERE id = $1",
        [runId],
      );
      assert.deepEqual(run.rows[0], {
        status: "rejected",
        current_stage: stage,
      });

      const expectedProposalStatuses = {
        scenario: {
          scenario_proposals: [{ status: "rejected", count: 2 }],
          use_case_proposals: [],
          feature_proposals: [],
        },
        use_case: {
          scenario_proposals: [{ status: "confirmed", count: 2 }],
          use_case_proposals: [{ status: "rejected", count: 2 }],
          feature_proposals: [],
        },
        feature: {
          scenario_proposals: [{ status: "confirmed", count: 2 }],
          use_case_proposals: [{ status: "confirmed", count: 2 }],
          feature_proposals: [{ status: "rejected", count: 2 }],
        },
      }[stage];

      for (const table of [
        "scenario_proposals",
        "use_case_proposals",
        "feature_proposals",
      ] as const) {
        const proposals = await pool.query(
          `SELECT status, CAST(count(*) AS INTEGER) AS count
           FROM ${table}
           WHERE run_id = $1
           GROUP BY status
           ORDER BY status`,
          [runId],
        );
        assert.deepEqual(proposals.rows, expectedProposalStatuses[table]);
      }

      const expectedAssetCounts = {
        scenario: [0, 0, 0],
        use_case: [2, 0, 0],
        feature: [2, 2, 0],
      }[stage];
      for (const [table, count] of [
        ["scenario_assets", expectedAssetCounts[0]],
        ["use_case_assets", expectedAssetCounts[1]],
        ["feature_assets", expectedAssetCounts[2]],
      ] as const) {
        const assets = await pool.query(
          `SELECT CAST(count(*) AS INTEGER) AS count
           FROM ${table}
           WHERE run_id = $1`,
          [runId],
        );
        assert.deepEqual(assets.rows, [{ count }]);
      }

      const trace = await pool.query(
        "SELECT event_type, payload FROM trace_events WHERE run_id = $1 ORDER BY id",
        [runId],
      );
      const events = trace.rows.map((row) => row.event_type as string);
      const completed = trace.rows.find(
        (row) => row.event_type === "analysis_run_completed",
      );
      assert.ok(completed);
      assert.equal((completed.payload as { status?: string }).status, "rejected");

      const nextStageEvent =
        stage === "scenario"
          ? "use_case_subagent_started"
          : stage === "use_case"
            ? "feature_subagent_started"
            : null;
      if (nextStageEvent) {
        assert.ok(!events.includes(nextStageEvent));
      }
      assert.ok(!events.includes("analysis_run_failed"));
    } finally {
      await pool.end();
    }
  }

  const scenario = await rejectAtStage("scenario");
  assert.deepEqual(Object.keys(scenario.snapshot), [
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
  assert.deepEqual(scenario.snapshot, {
    runId: scenario.runId,
    status: "rejected",
    currentStage: "scenario",
    stageLabel: "Scenario",
    requirement,
    gateOpen: false,
    resumeBlockedReason: "run_is_terminal",
    proposals: [],
    scenarioAssetCount: 0,
    useCaseAssetCount: 0,
    featureAssetCount: 0,
    nextStageOnApprove: null,
    revisionStage: null,
    nextCommand: null,
    commands: {
      status: `npm start -- status ${scenario.runId}`,
      approve: null,
      reject: null,
      revise: null,
    },
  });
  assert.match(
    scenario.stderr,
    /Requirement: Add dashboard sharing\nLifecycle status: rejected\nCurrent stage: Scenario\nGate open: no\nResume blocked: run_is_terminal\nProgress: 0 scenarios, 0 use cases, 0 features confirmed/,
  );
  assert.match(scenario.stderr, /No Confirmation Gate is open\./);

  const useCase = await rejectAtStage("use_case");
  assert.deepEqual(useCase.snapshot, {
    runId: useCase.runId,
    status: "rejected",
    currentStage: "use_case",
    stageLabel: "Use case",
    requirement,
    gateOpen: false,
    resumeBlockedReason: "run_is_terminal",
    proposals: [],
    scenarioAssetCount: 2,
    useCaseAssetCount: 0,
    featureAssetCount: 0,
    nextStageOnApprove: null,
    revisionStage: null,
    nextCommand: null,
    commands: {
      status: `npm start -- status ${useCase.runId}`,
      approve: null,
      reject: null,
      revise: null,
    },
  });
  assert.match(
    useCase.stderr,
    /Requirement: Add dashboard sharing\nLifecycle status: rejected\nCurrent stage: Use case\nGate open: no\nResume blocked: run_is_terminal\nProgress: 2 scenarios, 0 use cases, 0 features confirmed/,
  );

  const feature = await rejectAtStage("feature");
  assert.deepEqual(feature.snapshot, {
    runId: feature.runId,
    status: "rejected",
    currentStage: "feature",
    stageLabel: "Feature",
    requirement,
    gateOpen: false,
    resumeBlockedReason: "run_is_terminal",
    proposals: [],
    scenarioAssetCount: 2,
    useCaseAssetCount: 2,
    featureAssetCount: 0,
    nextStageOnApprove: null,
    revisionStage: null,
    nextCommand: null,
    commands: {
      status: `npm start -- status ${feature.runId}`,
      approve: null,
      reject: null,
      revise: null,
    },
  });
  assert.match(
    feature.stderr,
    /Requirement: Add dashboard sharing\nLifecycle status: rejected\nCurrent stage: Feature\nGate open: no\nResume blocked: run_is_terminal\nProgress: 2 scenarios, 2 use cases, 0 features confirmed/,
  );

  await assertRejectedRun(
    "scenario",
    scenario.databasePath,
    scenario.runId,
  );
  await assertRejectedRun(
    "use_case",
    useCase.databasePath,
    useCase.runId,
  );
  await assertRejectedRun(
    "feature",
    feature.databasePath,
    feature.runId,
  );
});
