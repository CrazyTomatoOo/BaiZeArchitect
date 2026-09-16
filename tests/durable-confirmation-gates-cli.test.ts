import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { SqlitePool } from "../src/sqlite.ts";

interface GatedCliResult {
  runId: string;
  status: string;
  currentStage?: string | null;
  nextCommand?: string;
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

test("gated CLI persists each confirmation boundary and resumes across invocations", async () => {
  const databasePath = process.env.BAIZE_DB_PATH;

  assert.ok(
    databasePath,
    "BAIZE_DB_PATH must be set for the durable gate integration test",
  );

  const requirement = `Durable gate ${process.pid}-${Date.now()}`;
  const initial = await runCli(["--gated", requirement]);

  assert.equal(
    initial.exitCode,
    0,
    `gated CLI failed: ${initial.stderr}`,
  );

  const initialResult = JSON.parse(initial.stdout) as GatedCliResult;
  assert.equal(initialResult.status, "awaiting_confirmation");
  assert.equal(initialResult.currentStage, "scenario");
  assert.match(initialResult.nextCommand ?? "", /resume/);

  const pool = new SqlitePool(databasePath);

  try {
    const runId = initialResult.runId;

    async function runStatus(): Promise<{ status: string; current_stage: string | null }> {
      const result = await pool.query(
        "SELECT status, current_stage FROM analysis_runs WHERE id = $1",
        [runId],
      );
      return result.rows[0] as {
        status: string;
        current_stage: string | null;
      };
    }

    async function traceEvents(): Promise<string[]> {
      const result = await pool.query(
        "SELECT event_type FROM trace_events WHERE run_id = $1 ORDER BY id",
        [runId],
      );
      return result.rows.map((row) => row.event_type as string);
    }

    assert.deepEqual(await runStatus(), {
      status: "awaiting_confirmation",
      current_stage: "scenario",
    });
    let events = await traceEvents();
    assert.ok(events.includes("scenario_confirmation_requested"));
    assert.ok(!events.includes("use_case_subagent_started"));

    const useCaseGate = await runCli(["resume", runId, "y"]);
    assert.equal(useCaseGate.exitCode, 0, useCaseGate.stderr);
    const useCaseResult = JSON.parse(useCaseGate.stdout) as GatedCliResult;
    assert.equal(useCaseResult.status, "awaiting_confirmation");
    assert.equal(useCaseResult.currentStage, "use_case");
    assert.match(useCaseResult.nextCommand ?? "", /resume/);
    assert.deepEqual(await runStatus(), {
      status: "awaiting_confirmation",
      current_stage: "use_case",
    });

    events = await traceEvents();
    assert.ok(events.includes("scenario_assets_persisted"));
    assert.ok(events.includes("use_case_confirmation_requested"));
    assert.ok(!events.includes("feature_subagent_started"));

    const featureGate = await runCli(["resume", runId, "y"]);
    assert.equal(featureGate.exitCode, 0, featureGate.stderr);
    const featureResult = JSON.parse(featureGate.stdout) as GatedCliResult;
    assert.equal(featureResult.status, "awaiting_confirmation");
    assert.equal(featureResult.currentStage, "feature");
    assert.match(featureResult.nextCommand ?? "", /resume/);
    assert.deepEqual(await runStatus(), {
      status: "awaiting_confirmation",
      current_stage: "feature",
    });

    events = await traceEvents();
    assert.ok(events.includes("use_case_assets_persisted"));
    assert.ok(events.includes("feature_confirmation_requested"));
    assert.ok(!events.includes("analysis_run_completed"));

    const completed = await runCli(["resume", runId, "y"]);
    assert.equal(completed.exitCode, 0, completed.stderr);
    const completedResult = JSON.parse(completed.stdout) as GatedCliResult;
    assert.equal(completedResult.status, "succeeded");
    assert.equal(completedResult.nextCommand, undefined);
    assert.deepEqual(await runStatus(), {
      status: "succeeded",
      current_stage: "feature",
    });

    events = await traceEvents();
    assert.ok(events.includes("feature_assets_persisted"));
    assert.ok(events.includes("analysis_run_completed"));
    assert.ok(!events.includes("analysis_run_failed"));
  } finally {
    await pool.end();
  }
});

test("gated CLI revisions replace only the current stage proposals", async () => {
  const databasePath = process.env.BAIZE_DB_PATH;

  assert.ok(
    databasePath,
    "BAIZE_DB_PATH must be set for the revision integration test",
  );

  const requirement = `Durable revision ${process.pid}-${Date.now()}`;
  const initial = await runCli(["--gated", requirement]);
  assert.equal(initial.exitCode, 0, initial.stderr);

  const initialResult = JSON.parse(initial.stdout) as GatedCliResult;
  const runId = initialResult.runId;

  const scenarioRevision = await runCli(
    ["resume", runId, "revise", "--", "Make the scenario more sharing-specific"],
    {
      BAIZE_FAUX_MODEL_OUTPUT: JSON.stringify({
        proposals: [
          {
            kind: "new",
            title: "Revised share dashboard",
            description:
              "A dashboard owner shares a specific dashboard with another user.",
          },
        ],
      }),
    },
  );
  assert.equal(scenarioRevision.exitCode, 0, scenarioRevision.stderr);
  const scenarioRevisionResult = JSON.parse(
    scenarioRevision.stdout,
  ) as GatedCliResult;
  assert.equal(
    scenarioRevisionResult.status,
    "awaiting_confirmation",
  );
  assert.equal(scenarioRevisionResult.currentStage, "scenario");

  const pool = new SqlitePool(databasePath);

  try {
    let run = await pool.query(
      "SELECT status, current_stage FROM analysis_runs WHERE id = $1",
      [runId],
    );
    assert.deepEqual(run.rows[0], {
      status: "awaiting_confirmation",
      current_stage: "scenario",
    });

    let proposals = await pool.query(
      "SELECT title, status FROM scenario_proposals WHERE run_id = $1 ORDER BY title",
      [runId],
    );
    assert.deepEqual(proposals.rows, [
      { title: "Revised share dashboard", status: "proposed" },
      { title: "Share dashboard", status: "rejected" },
      { title: "View dashboard", status: "rejected" },
    ]);

    let trace = await pool.query(
      "SELECT event_type, payload FROM trace_events WHERE run_id = $1 ORDER BY id",
      [runId],
    );
    let eventTypes = trace.rows.map((row) => row.event_type as string);
    assert.equal(
      eventTypes.filter((type) => type === "scenario_confirmation_requested")
        .length,
      2,
    );
    assert.ok(eventTypes.includes("analysis_run_revision_requested"));

    let revisionEvent = trace.rows.find(
      (row) => row.event_type === "analysis_run_revision_requested",
    );
    assert.equal(
      (revisionEvent.payload as { stage?: string }).stage,
      "scenario",
    );
    assert.equal(
      (revisionEvent.payload as { feedback?: string }).feedback,
      "Make the scenario more sharing-specific",
    );

    const useCaseGate = await runCli(["resume", runId, "y"], {
      BAIZE_FAUX_MODEL_OUTPUT: JSON.stringify({
        proposals: [
          {
            kind: "new",
            title: "Initial revised use case",
            description:
              "A dashboard owner shares a dashboard with another user.",
            scenarioTitle: "Revised share dashboard",
          },
        ],
      }),
    });
    assert.equal(useCaseGate.exitCode, 0, useCaseGate.stderr);
    assert.equal(
      (JSON.parse(useCaseGate.stdout) as GatedCliResult).status,
      "awaiting_confirmation",
    );
    assert.equal(
      (JSON.parse(useCaseGate.stdout) as GatedCliResult).currentStage,
      "use_case",
    );

    const useCaseRevision = await runCli(
      ["resume", runId, "revise", "--", "Focus on sharing with one teammate"],
      {
        BAIZE_FAUX_MODEL_OUTPUT: JSON.stringify({
          proposals: [
            {
              kind: "new",
              title: "Revised share use case",
              description:
                "A dashboard owner shares one dashboard with one teammate.",
              scenarioTitle: "Revised share dashboard",
            },
          ],
        }),
      },
    );
    assert.equal(useCaseRevision.exitCode, 0, useCaseRevision.stderr);
    assert.equal(
      (JSON.parse(useCaseRevision.stdout) as GatedCliResult).status,
      "awaiting_confirmation",
    );
    assert.equal(
      (JSON.parse(useCaseRevision.stdout) as GatedCliResult).currentStage,
      "use_case",
    );

    proposals = await pool.query(
      "SELECT title, status FROM use_case_proposals WHERE run_id = $1 ORDER BY title",
      [runId],
    );
    assert.deepEqual(proposals.rows, [
      { title: "Initial revised use case", status: "rejected" },
      { title: "Revised share use case", status: "proposed" },
    ]);

    const featureGate = await runCli(["resume", runId, "y"], {
      BAIZE_FAUX_MODEL_OUTPUT: JSON.stringify({
        proposals: [
          {
            kind: "new",
            title: "Initial revised feature",
            description:
              "A dashboard owner controls another user's dashboard access.",
            useCaseTitle: "Revised share use case",
          },
        ],
      }),
    });
    assert.equal(featureGate.exitCode, 0, featureGate.stderr);
    assert.equal(
      (JSON.parse(featureGate.stdout) as GatedCliResult).status,
      "awaiting_confirmation",
    );
    assert.equal(
      (JSON.parse(featureGate.stdout) as GatedCliResult).currentStage,
      "feature",
    );

    const featureRevision = await runCli(
      ["resume", runId, "revise", "--", "Emphasize revocable access"],
      {
        BAIZE_FAUX_MODEL_OUTPUT: JSON.stringify({
          proposals: [
            {
              kind: "new",
              title: "Revised sharing permissions",
              description:
                "A dashboard owner grants and revokes one teammate's dashboard access.",
              useCaseTitle: "Revised share use case",
            },
          ],
        }),
      },
    );
    assert.equal(featureRevision.exitCode, 0, featureRevision.stderr);
    assert.equal(
      (JSON.parse(featureRevision.stdout) as GatedCliResult).status,
      "awaiting_confirmation",
    );
    assert.equal(
      (JSON.parse(featureRevision.stdout) as GatedCliResult).currentStage,
      "feature",
    );

    proposals = await pool.query(
      "SELECT title, status FROM feature_proposals WHERE run_id = $1 ORDER BY title",
      [runId],
    );
    assert.deepEqual(proposals.rows, [
      { title: "Initial revised feature", status: "rejected" },
      { title: "Revised sharing permissions", status: "proposed" },
    ]);

    const completed = await runCli(["resume", runId, "y"]);
    assert.equal(completed.exitCode, 0, completed.stderr);
    const completedResult = JSON.parse(completed.stdout) as GatedCliResult;
    assert.equal(completedResult.status, "succeeded");

    run = await pool.query(
      "SELECT status FROM analysis_runs WHERE id = $1",
      [runId],
    );
    assert.equal(run.rows[0].status, "succeeded");

    trace = await pool.query(
      "SELECT event_type, payload FROM trace_events WHERE run_id = $1 ORDER BY id",
      [runId],
    );
    eventTypes = trace.rows.map((row) => row.event_type as string);
    assert.equal(
      eventTypes.filter((type) => type === "analysis_run_revision_requested")
        .length,
      3,
    );
    assert.ok(!eventTypes.includes("analysis_run_failed"));
  } finally {
    await pool.end();
  }
});

test("gated CLI rejection stops the run without starting the next stage", async () => {
  const databasePath = process.env.BAIZE_DB_PATH;

  assert.ok(
    databasePath,
    "BAIZE_DB_PATH must be set for the durable gate rejection test",
  );

  const requirement = `Durable rejection ${process.pid}-${Date.now()}`;
  const initial = await runCli(["--gated", requirement]);
  assert.equal(initial.exitCode, 0, initial.stderr);

  const initialResult = JSON.parse(initial.stdout) as GatedCliResult;
  const rejected = await runCli(["resume", initialResult.runId, "n"]);

  assert.equal(rejected.exitCode, 2);
  const rejectedResult = JSON.parse(rejected.stdout) as GatedCliResult;
  assert.equal(rejectedResult.status, "rejected");

  const pool = new SqlitePool(databasePath);

  try {
    const run = await pool.query(
      "SELECT status, failure_code FROM analysis_runs WHERE id = $1",
      [initialResult.runId],
    );
    assert.equal(run.rows[0].status, "rejected");
    assert.equal(run.rows[0].failure_code, null);

    const trace = await pool.query(
      "SELECT event_type, payload FROM trace_events WHERE run_id = $1 ORDER BY id",
      [initialResult.runId],
    );
    const eventTypes = trace.rows.map((row) => row.event_type as string);

    assert.ok(eventTypes.includes("scenario_confirmation_received"));
    assert.ok(eventTypes.includes("scenario_assets_persisted"));
    assert.ok(eventTypes.includes("analysis_run_completed"));
    assert.ok(!eventTypes.includes("use_case_subagent_started"));
    assert.ok(!eventTypes.includes("analysis_run_failed"));

    const completed = trace.rows.find(
      (row) => row.event_type === "analysis_run_completed",
    );
    assert.equal(
      (completed.payload as { status?: string }).status,
      "rejected",
    );
  } finally {
    await pool.end();
  }
});
