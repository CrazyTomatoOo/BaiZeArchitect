import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import test from "node:test";
import { AnalysisFailureError } from "../src/errors.ts";
import { runScenarioAnalysis } from "../src/agent/scenario.ts";
import type { McpToolClient } from "../src/mcp.ts";

test("scenario analysis tool timeout is deterministic", async () => {
  process.env.BAIZE_TOOL_TIMEOUT_MS = "25";
  const startedAt = performance.now();
  const hangingMcp = {
    callTool: () => new Promise<never>(() => undefined),
  } as unknown as McpToolClient;

  await assert.rejects(
    runScenarioAnalysis(hangingMcp, "Test requirement"),
    (error: unknown) => {
      assert.ok(error instanceof AnalysisFailureError);
      assert.equal(error.failureCode, "tool_timeout");
      assert.match(error.message, /Analysis tool timed out: query_scenario_tree/);
      assert.ok(performance.now() - startedAt < 5_000);

      return true;
    },
  );
});
