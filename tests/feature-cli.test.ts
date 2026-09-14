import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

test("feature CLI proposes and persists confirmed features", async () => {
  const isolatedHome = await mkdtemp(path.join(tmpdir(), "baize-agent-"));
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(
    databaseUrl,
    "DATABASE_URL must be set for the feature CLI integration test",
  );

  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "Add dashboard sharing"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
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

  assert.equal(exitCode, 0);
  assert.match(stderr, /Confirm scenario proposals\?/);
  assert.match(stderr, /Confirm use case proposals\?/);
  assert.match(stderr, /Confirm feature proposals\?/);

  const result = JSON.parse(stdout) as {
    runId: string;
    status: string;
    scenarioAssetCount: number;
    useCaseAssetCount: number;
    featureAssetCount: number;
    confirmedFeatures: Array<{
      kind: string;
      title: string;
    }>;
  };

  assert.equal(result.status, "succeeded");
  assert.equal(result.scenarioAssetCount, 2);
  assert.equal(result.useCaseAssetCount, 2);
  assert.equal(result.featureAssetCount, 2);
  assert.deepEqual(
    [...result.confirmedFeatures].sort((a, b) => a.title.localeCompare(b.title)),
    [
      { kind: "affected", title: "Dashboard access control" },
      { kind: "new", title: "Dashboard sharing permissions" },
    ],
  );

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const features = await pool.query(
      "SELECT title FROM feature_nodes ORDER BY title",
    );

    assert.ok(features.rows.length >= 3);
    assert.ok(
      features.rows.some((row) => row.title === "Dashboard access control"),
    );
    assert.ok(
      features.rows.some((row) => row.title === "Dashboard sharing permissions"),
    );

    const proposals = await pool.query(
      `SELECT kind, title, status
       FROM feature_proposals
       WHERE run_id = $1
       ORDER BY title`,
      [result.runId],
    );

    assert.deepEqual(proposals.rows, [
      {
        kind: "affected",
        title: "Dashboard access control",
        status: "confirmed",
      },
      {
        kind: "new",
        title: "Dashboard sharing permissions",
        status: "confirmed",
      },
    ]);

    const assets = await pool.query(
      `SELECT f.kind, f.title, uc.title AS use_case_title
       FROM feature_assets f
       JOIN use_case_assets uc ON uc.id = f.use_case_asset_id
       WHERE f.run_id = $1
       ORDER BY f.title`,
      [result.runId],
    );

    assert.deepEqual(assets.rows, [
      {
        kind: "affected",
        title: "Dashboard access control",
        use_case_title: "Share dashboard with a teammate",
      },
      {
        kind: "new",
        title: "Dashboard sharing permissions",
        use_case_title: "Share dashboard with a teammate",
      },
    ]);

    const trace = await pool.query(
      `SELECT event_type, payload
       FROM trace_events
       WHERE run_id = $1
       ORDER BY id`,
      [result.runId],
    );
    const eventTypes = trace.rows.map((row) => row.event_type);

    for (const expectedEvent of [
      "feature_subagent_started",
      "feature_skill_loaded",
      "feature_library_queried",
      "feature_proposals_generated",
      "feature_confirmation_requested",
      "feature_confirmation_received",
      "feature_assets_persisted",
      "analysis_run_completed",
    ]) {
      assert.ok(
        eventTypes.includes(expectedEvent),
        `Expected trace event ${expectedEvent}; saw ${eventTypes.join(", ")}`,
      );
    }

    const toolCalls = trace.rows.filter(
      (row) => row.event_type === "feature_tool_call",
    );

    assert.ok(
      toolCalls.some(
        (row) =>
          (row.payload as { toolName?: string }).toolName ===
          "query_feature_library",
      ),
    );

    const libraryResult = trace.rows.find(
      (row) =>
        row.event_type === "feature_tool_result" &&
        (row.payload as { toolName?: string }).toolName ===
          "query_feature_library",
    );
    const libraryCount = (
      (libraryResult.payload as { result?: { details?: { count?: number } } })
        .result ?? {}
    ).details?.count;

    assert.ok(libraryCount !== undefined && libraryCount >= 3);

    const startedEvent = trace.rows.find(
      (row) => row.event_type === "feature_subagent_started",
    );
    const confirmedUseCases = (startedEvent.payload as {
      confirmedUseCases?: Array<{ title?: string }>;
    }).confirmedUseCases;

    assert.ok(
      confirmedUseCases?.some(
        (useCase) => useCase.title === "Share dashboard with a teammate",
      ),
    );
  } finally {
    await pool.end();
  }
});
