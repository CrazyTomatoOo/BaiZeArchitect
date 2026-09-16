import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { SqlitePool } from "../src/sqlite.ts";

async function waitForText(
  child: ChildProcess,
  accumulated: string,
  pattern: RegExp,
): Promise<string> {
  if (pattern.test(accumulated)) {
    return accumulated;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for ${pattern}; stderr was ${accumulated}`,
        ),
      );
    }, 5_000);

    function onData(chunk: Buffer | string): void {
      accumulated += chunk.toString();

      if (pattern.test(accumulated)) {
        cleanup();
        resolve(accumulated);
      }
    }

    function onEnd(): void {
      cleanup();
      reject(
        new Error(`CLI closed while waiting for ${pattern}; stderr was ${accumulated}`),
      );
    }

    function cleanup(): void {
      clearTimeout(timeout);
      child.stderr?.off("data", onData);
      child.stderr?.off("end", onEnd);
    }

    child.stderr?.on("data", onData);
    child.stderr?.on("end", onEnd);
  });
}

test("each analysis stage waits for its human confirmation before continuing", async () => {
  const databasePath = process.env.BAIZE_DB_PATH;

  assert.ok(
    databasePath,
    "BAIZE_DB_PATH must be set for the confirmation gate integration test",
  );

  const requirement = `Confirmation gate ${process.pid}-${Date.now()}`;
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", requirement],
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

  const pool = new SqlitePool(databasePath);

  try {
    stderr = await waitForText(
      child,
      stderr,
      /Confirm scenario proposals\? \[y\/N\]/,
    );

    let run = await pool.query(
      "SELECT id, status FROM analysis_runs WHERE requirement = $1",
      [requirement],
    );
    assert.equal(run.rows.length, 1, "Expected one analysis run");
    const runId = run.rows[0].id as string;
    assert.equal(run.rows[0].status, "running");

    async function traceEvents(): Promise<string[]> {
      const trace = await pool.query(
        "SELECT event_type FROM trace_events WHERE run_id = $1 ORDER BY id",
        [runId],
      );
      return trace.rows.map((row) => row.event_type as string);
    }

    let events = await traceEvents();
    assert.ok(events.includes("scenario_confirmation_requested"));
    assert.ok(!events.includes("use_case_subagent_started"));
    assert.ok(!events.includes("feature_subagent_started"));
    assert.ok(!events.includes("analysis_run_completed"));

    child.stdin.write("y\n");
    stderr = await waitForText(
      child,
      stderr,
      /Confirm use case proposals\? \[y\/N\]/,
    );

    events = await traceEvents();
    assert.ok(events.includes("scenario_assets_persisted"));
    assert.ok(events.includes("use_case_confirmation_requested"));
    assert.ok(!events.includes("feature_subagent_started"));
    assert.ok(!events.includes("analysis_run_completed"));

    child.stdin.write("y\n");
    stderr = await waitForText(
      child,
      stderr,
      /Confirm feature proposals\? \[y\/N\]/,
    );

    events = await traceEvents();
    assert.ok(events.includes("use_case_assets_persisted"));
    assert.ok(events.includes("feature_confirmation_requested"));
    assert.ok(!events.includes("analysis_run_completed"));

    child.stdin.write("y\n");
    child.stdin.end();

    const [exitCode] = await once(child, "close");
    assert.equal(exitCode, 0);

    const result = JSON.parse(stdout) as { runId: string; status: string };
    assert.equal(result.runId, runId);
    assert.equal(result.status, "succeeded");

    run = await pool.query(
      "SELECT status FROM analysis_runs WHERE id = $1",
      [runId],
    );
    assert.equal(run.rows[0].status, "succeeded");
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "close");
    }
    await pool.end();
  }
});
