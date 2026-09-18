import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { createAnalysisRun, initializeSchema } from "../src/db.ts";
import { SqlitePool } from "../src/sqlite.ts";

interface RunSnapshot {
  runId: string;
  status: string;
  currentStage: string | null;
  stageLabel: string | null;
  requirement: string;
  gateOpen: boolean;
  resumeBlockedReason: string | null;
  proposals: unknown[];
  scenarioAssetCount: number;
  useCaseAssetCount: number;
  featureAssetCount: number;
  nextStageOnApprove: string | null;
  revisionStage: string | null;
  nextCommand: string | null;
  commands: {
    status: string;
    approve: string | null;
    reject: string | null;
    revise: string | null;
  };
}

async function temporaryDatabasePath(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  return path.join(directory, "baize.sqlite3");
}

async function runCli(
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
      // Keep stdin open: commands must finish without input or EOF.
      stdio: ["pipe", "pipe", "pipe"],
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

async function captureDomainState(
  pool: SqlitePool,
  runId: string,
): Promise<unknown> {
  const [run, scenarioProposals, useCaseProposals, featureProposals, scenarioAssets, useCaseAssets, featureAssets, traceEvents] =
    await Promise.all([
      pool.query("SELECT * FROM analysis_runs WHERE id = $1", [runId]),
      pool.query("SELECT * FROM scenario_proposals WHERE run_id = $1", [runId]),
      pool.query("SELECT * FROM use_case_proposals WHERE run_id = $1", [runId]),
      pool.query("SELECT * FROM feature_proposals WHERE run_id = $1", [runId]),
      pool.query("SELECT * FROM scenario_assets WHERE run_id = $1", [runId]),
      pool.query("SELECT * FROM use_case_assets WHERE run_id = $1", [runId]),
      pool.query("SELECT * FROM feature_assets WHERE run_id = $1", [runId]),
      pool.query("SELECT * FROM trace_events WHERE run_id = $1", [runId]),
    ]);

  return {
    run: run.rows,
    scenarioProposals: scenarioProposals.rows,
    useCaseProposals: useCaseProposals.rows,
    featureProposals: featureProposals.rows,
    scenarioAssets: scenarioAssets.rows,
    useCaseAssets: useCaseAssets.rows,
    featureAssets: featureAssets.rows,
    traceEvents: traceEvents.rows,
  };
}

test("status and no-action resume return the same read-only Run Snapshot", async () => {
  const databasePath = await temporaryDatabasePath(
    "baize-read-only-snapshot-",
  );
  const requirement = "Add dashboard sharing";

  const initial = await runCli(["--gated", requirement], {
    BAIZE_DB_PATH: databasePath,
    BAIZE_MODEL: "",
  });
  assert.equal(initial.exitCode, 0, initial.stderr);
  const initialSnapshot = JSON.parse(initial.stdout) as RunSnapshot;
  const runId = initialSnapshot.runId;

  const pool = new SqlitePool(databasePath);
  try {
    const before = await captureDomainState(pool, runId);

    const status = await runCli(["status", runId], {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
    });
    assert.equal(status.exitCode, 0, status.stderr);
    assert.equal(status.stdout.trim().split("\n").length, 1);
    const statusSnapshot = JSON.parse(status.stdout) as RunSnapshot;

    const resume = await runCli(["resume", runId], {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
    });
    assert.equal(resume.exitCode, 0, resume.stderr);
    assert.equal(resume.stdout.trim().split("\n").length, 1);
    const resumeSnapshot = JSON.parse(resume.stdout) as RunSnapshot;

    assert.deepEqual(statusSnapshot, initialSnapshot);
    assert.deepEqual(statusSnapshot, resumeSnapshot);
    assert.equal(statusSnapshot.status, "awaiting_confirmation");
    assert.equal(statusSnapshot.currentStage, "scenario");
    assert.equal(statusSnapshot.stageLabel, "Scenario");
    assert.equal(statusSnapshot.gateOpen, true);
    assert.equal(statusSnapshot.resumeBlockedReason, null);
    assert.equal(statusSnapshot.nextCommand, `npm start -- resume ${runId} y`);
    assert.deepEqual(statusSnapshot.commands, {
      status: `npm start -- status ${runId}`,
      approve: `npm start -- resume ${runId} y`,
      reject: `npm start -- resume ${runId} n`,
      revise: `npm start -- resume ${runId} revise -- "<revision-feedback>"`,
    });

    assert.match(
      status.stderr,
      /Requirement: Add dashboard sharing\nLifecycle status: awaiting_confirmation\nCurrent stage: Scenario\nGate open: yes\nResume blocked: no\nProgress: 0 scenarios, 0 use cases, 0 features confirmed/,
    );
    assert.equal(status.stderr, resume.stderr);

    const after = await captureDomainState(pool, runId);
    assert.deepEqual(after, before);
  } finally {
    await pool.end();
  }
});

test("running and terminal snapshots block actions without mutating state", async () => {
  const databasePath = await temporaryDatabasePath(
    "baize-read-only-lifecycle-",
  );
  const requirement = "Add dashboard sharing";
  const setupPool = new SqlitePool(databasePath);

  let runningRunId: string;
  try {
    await initializeSchema(setupPool);
    const runningRun = await createAnalysisRun(setupPool, requirement);
    runningRunId = runningRun.id;
  } finally {
    await setupPool.end();
  }

  const pool = new SqlitePool(databasePath);
  try {
    const runningBefore = await captureDomainState(pool, runningRunId);
    const runningStatus = await runCli(["status", runningRunId], {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
    });
    assert.equal(runningStatus.exitCode, 0, runningStatus.stderr);
    assert.equal(runningStatus.stdout.trim().split("\n").length, 1);
    const runningSnapshot = JSON.parse(runningStatus.stdout) as RunSnapshot;
    const runningResume = await runCli(["resume", runningRunId], {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
    });
    assert.equal(runningResume.exitCode, 0, runningResume.stderr);
    assert.equal(runningResume.stdout, runningStatus.stdout);
    assert.equal(runningResume.stderr, runningStatus.stderr);

    assert.deepEqual(runningSnapshot, {
      runId: runningRunId,
      status: "running",
      currentStage: null,
      stageLabel: null,
      requirement,
      gateOpen: false,
      resumeBlockedReason: "run_is_running",
      proposals: [],
      scenarioAssetCount: 0,
      useCaseAssetCount: 0,
      featureAssetCount: 0,
      nextStageOnApprove: null,
      revisionStage: null,
      nextCommand: null,
      commands: {
        status: `npm start -- status ${runningRunId}`,
        approve: null,
        reject: null,
        revise: null,
      },
    });
    assert.match(
      runningStatus.stderr,
      /Lifecycle status: running\nCurrent stage: none\nGate open: no\nResume blocked: run_is_running/,
    );
    assert.deepEqual(
      await captureDomainState(pool, runningRunId),
      runningBefore,
    );

    const runningAction = await runCli(["resume", runningRunId, "y"], {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
    });
    assert.equal(runningAction.exitCode, 2);
    assert.equal(runningAction.stdout, "");
    assert.equal(
      runningAction.stderr,
      "Analysis run is not awaiting confirmation (status: running)\n",
    );
    assert.deepEqual(
      await captureDomainState(pool, runningRunId),
      runningBefore,
    );

    const initial = await runCli(["--gated", requirement], {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
    });
    assert.equal(initial.exitCode, 0, initial.stderr);
    const initialSnapshot = JSON.parse(initial.stdout) as RunSnapshot;
    const terminalRunId = initialSnapshot.runId;

    const rejection = await runCli(["resume", terminalRunId, "n"], {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
    });
    assert.equal(rejection.exitCode, 2, rejection.stderr);

    const terminalBefore = await captureDomainState(pool, terminalRunId);
    const terminalStatus = await runCli(["status", terminalRunId], {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
    });
    assert.equal(terminalStatus.exitCode, 0, terminalStatus.stderr);
    const terminalSnapshot = JSON.parse(terminalStatus.stdout) as RunSnapshot;
    assert.deepEqual(terminalSnapshot, {
      runId: terminalRunId,
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
        status: `npm start -- status ${terminalRunId}`,
        approve: null,
        reject: null,
        revise: null,
      },
    });
    assert.match(
      terminalStatus.stderr,
      /Lifecycle status: rejected\nCurrent stage: Scenario\nGate open: no\nResume blocked: run_is_terminal/,
    );

    const terminalResume = await runCli(["resume", terminalRunId], {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
    });
    assert.equal(terminalResume.exitCode, 0, terminalResume.stderr);
    assert.equal(terminalResume.stdout, terminalStatus.stdout);
    assert.equal(terminalResume.stderr, terminalStatus.stderr);

    const terminalAction = await runCli(["resume", terminalRunId, "y"], {
      BAIZE_DB_PATH: databasePath,
      BAIZE_MODEL: "",
    });
    assert.equal(terminalAction.exitCode, 2);
    assert.equal(terminalAction.stdout, "");
    assert.equal(
      terminalAction.stderr,
      "Analysis run is not awaiting confirmation (status: rejected)\n",
    );
    assert.deepEqual(
      await captureDomainState(pool, terminalRunId),
      terminalBefore,
    );
  } finally {
    await pool.end();
  }
});

test("unknown run IDs and usage errors fail without stdout JSON", async () => {
  const databasePath = await temporaryDatabasePath(
    "baize-read-only-errors-",
  );
  const setupPool = new SqlitePool(databasePath);

  try {
    await initializeSchema(setupPool);
  } finally {
    await setupPool.end();
  }

  const unknownResults = [
    await runCli(["status", "missing-run"], { BAIZE_DB_PATH: databasePath }),
    await runCli(["resume", "missing-run"], { BAIZE_DB_PATH: databasePath }),
    await runCli(["resume", "missing-run", "y"], {
      BAIZE_DB_PATH: databasePath,
    }),
  ];

  for (const result of unknownResults) {
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Analysis run not found: missing-run\n");
  }

  const initial = await runCli(["--gated", "Add dashboard sharing"], {
    BAIZE_DB_PATH: databasePath,
    BAIZE_MODEL: "",
  });
  assert.equal(initial.exitCode, 0, initial.stderr);
  const runId = (JSON.parse(initial.stdout) as RunSnapshot).runId;
  const pool = new SqlitePool(databasePath);

  try {
    const before = await captureDomainState(pool, runId);
    const usageResults = [
      {
        result: await runCli(["status"], { BAIZE_DB_PATH: databasePath }),
        stderr: "Usage: npm start -- status <runId>\n",
      },
      {
        result: await runCli(["status", runId, "extra"], {
          BAIZE_DB_PATH: databasePath,
        }),
        stderr: "Usage: npm start -- status <runId>\n",
      },
      {
        result: await runCli(["resume"], { BAIZE_DB_PATH: databasePath }),
        stderr:
          "Usage: npm start -- resume <runId> [y|n|revise -- \"<revision-feedback>\"]\n",
      },
      {
        result: await runCli(["resume", runId, "bogus"], {
          BAIZE_DB_PATH: databasePath,
        }),
        stderr:
          "Resume action must be y, yes, n, no, or revise with non-empty feedback\n",
      },
      {
        result: await runCli(["resume", runId, "y", "extra"], {
          BAIZE_DB_PATH: databasePath,
        }),
        stderr:
          "Usage: npm start -- resume <runId> [y|n|revise -- \"<revision-feedback>\"]\n",
      },
      {
        result: await runCli(["resume", runId, "revise", "feedback"], {
          BAIZE_DB_PATH: databasePath,
        }),
        stderr:
          "Usage: npm start -- resume <runId> [y|n|revise -- \"<revision-feedback>\"]\n",
      },
      {
        result: await runCli(["resume", runId, "revise", "--"], {
          BAIZE_DB_PATH: databasePath,
        }),
        stderr:
          "Usage: npm start -- resume <runId> [y|n|revise -- \"<revision-feedback>\"]\n",
      },
      {
        result: await runCli(["resume", runId, "revise", "--", "one", "two"], {
          BAIZE_DB_PATH: databasePath,
        }),
        stderr:
          "Usage: npm start -- resume <runId> [y|n|revise -- \"<revision-feedback>\"]\n",
      },
    ];

    for (const { result, stderr } of usageResults) {
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, stderr);
    }

    assert.deepEqual(await captureDomainState(pool, runId), before);
  } finally {
    await pool.end();
  }
});


test("read-only snapshots restore later gates, revised proposals, and completed progress", async () => {
  const databasePath = await temporaryDatabasePath("baize-snapshot-progress-");
  const env = { BAIZE_DB_PATH: databasePath, BAIZE_MODEL: "" };
  const initial = await runCli(["--gated", "Add dashboard sharing"], env);
  assert.equal(initial.exitCode, 0, initial.stderr);
  let snapshot = JSON.parse(initial.stdout) as RunSnapshot;
  const pool = new SqlitePool(databasePath);

  try {
    for (const stage of ["scenario", "use_case", "feature"]) {
      assert.equal(snapshot.currentStage, stage);
      const revised = await runCli(
        ["resume", snapshot.runId, "revise", "--", "Share with only one teammate"],
        env,
      );
      assert.equal(revised.exitCode, 0, revised.stderr);
      snapshot = JSON.parse(revised.stdout) as RunSnapshot;
      const before = await captureDomainState(pool, snapshot.runId);
      for (const command of ["status", "resume"]) {
        const result = await runCli([command, snapshot.runId], env);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), snapshot);
        assert.equal(result.stderr, revised.stderr);
        assert.deepEqual(await captureDomainState(pool, snapshot.runId), before);
      }
      const approved = await runCli(["resume", snapshot.runId, "y"], env);
      assert.equal(approved.exitCode, 0, approved.stderr);
      snapshot = JSON.parse(approved.stdout) as RunSnapshot;
    }

    assert.equal(snapshot.status, "succeeded");
    assert.ok(snapshot.scenarioAssetCount > 0);
    assert.ok(snapshot.useCaseAssetCount > 0);
    assert.ok(snapshot.featureAssetCount > 0);
    const before = await captureDomainState(pool, snapshot.runId);
    for (const command of ["status", "resume"]) {
      const result = await runCli([command, snapshot.runId], env);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), snapshot);
    }
    for (const action of [["y"], ["n"], ["revise", "--", "Try again"]]) {
      const result = await runCli(["resume", snapshot.runId, ...action], env);
      assert.equal(result.exitCode, 2, result.stderr);
      assert.equal(result.stdout, "");
    }
    assert.deepEqual(await captureDomainState(pool, snapshot.runId), before);
  } finally {
    await pool.end();
  }
});

test("a failed resume records failure state and remains readable without mutation", async () => {
  const databasePath = await temporaryDatabasePath("baize-snapshot-failure-");
  const env = { BAIZE_DB_PATH: databasePath, BAIZE_MODEL: "" };
  const initial = await runCli(["--gated", "Add dashboard sharing"], env);
  assert.equal(initial.exitCode, 0, initial.stderr);
  const { runId } = JSON.parse(initial.stdout) as RunSnapshot;
  const failed = await runCli(["resume", runId, "y"], {
    ...env,
    BAIZE_FAUX_MODEL_OUTPUT: "not-json",
  });
  assert.equal(failed.exitCode, 1, failed.stderr);
  assert.equal(failed.stdout, "");
  assert.ok(failed.stderr.trim());
  const pool = new SqlitePool(databasePath);
  try {
    const events = await pool.query(
      "SELECT payload FROM trace_events WHERE run_id = $1 AND event_type = 'analysis_run_failed'",
      [runId],
    );
    assert.equal(events.rows.length, 1);
    const before = await captureDomainState(pool, runId);
    const status = await runCli(["status", runId], env);
    const resume = await runCli(["resume", runId], env);
    assert.equal(status.exitCode, 0, status.stderr);
    assert.equal(resume.exitCode, 0, resume.stderr);
    assert.equal(status.stdout, resume.stdout);
    const snapshot = JSON.parse(status.stdout) as RunSnapshot;
    assert.equal(snapshot.status, "failed");
    assert.equal(snapshot.currentStage, "use_case");
    assert.equal(snapshot.gateOpen, false);
    assert.equal(snapshot.resumeBlockedReason, "run_is_terminal");
    assert.deepEqual(snapshot.proposals, []);
    assert.equal(snapshot.commands.approve, null);
    assert.equal(snapshot.commands.reject, null);
    assert.equal(snapshot.commands.revise, null);
    assert.deepEqual(await captureDomainState(pool, runId), before);
  } finally {
    await pool.end();
  }
});
