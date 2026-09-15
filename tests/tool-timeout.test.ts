import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import test from "node:test";
import {
  AnalysisFailureError,
} from "../src/errors.ts";
import { runModelAgent } from "../src/agent/analysis-agent.ts";

test("analysis tool timeout is deterministic", async () => {
  process.env.BAIZE_TOOL_TIMEOUT_MS = "25";
  const startedAt = performance.now();

  await assert.rejects(
    runModelAgent({
      skillName: "analysis-orchestration",
      systemPrompt: "Test analysis agent.",
      queryToolName: "query_timeout",
      queryToolLabel: "Query timeout",
      queryToolDescription: "Hangs until timeout.",
      queryData: () => new Promise<never>(() => undefined),
      prompt: "Test requirement",
      finalResponse: {},
      parseResult: () => ({}),
    }),
    (error: unknown) => {
      assert.ok(error instanceof AnalysisFailureError);
      assert.equal(error.failureCode, "tool_timeout");
      assert.match(error.message, /Analysis tool timed out: query_timeout/);
      assert.ok(performance.now() - startedAt < 1_000);

      return true;
    },
  );
});
