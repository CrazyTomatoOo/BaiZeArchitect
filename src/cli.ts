import { Pool } from "pg";
import { createInterface } from "node:readline/promises";
import { runScenarioAnalysis } from "./agent/scenario.ts";
import {
  completeAnalysisRun,
  createAnalysisRun,
  failAnalysisRun,
  initializeSchema,
  recordTraceEvent,
  saveScenarioProposals,
  settleScenarioProposals,
  type ScenarioAsset,
} from "./db.ts";

interface CliResult {
  runId: string;
  status: "succeeded" | "rejected";
  scenarioAssetCount: number;
  confirmedScenarios: Array<{
    kind: ScenarioAsset["kind"];
    title: string;
  }>;
}

async function confirmScenarioProposals(): Promise<boolean> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const answer = await readline.question(
      "Confirm scenario proposals? [y/N] ",
    );
    return answer.trim().toLowerCase() === "y" ||
      answer.trim().toLowerCase() === "yes";
  } finally {
    readline.close();
  }
}

async function main(): Promise<void> {
  const requirement = process.argv[2]?.trim();

  if (!requirement) {
    console.error("Usage: npm start -- <requirement>");
    process.exitCode = 2;
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exitCode = 2;
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  let runId: string | undefined;

  try {
    await initializeSchema(pool);
    const run = await createAnalysisRun(pool, requirement);
    runId = run.id;

    await recordTraceEvent(pool, run.id, "analysis_run_started", {
      requirement,
    });

    await recordTraceEvent(pool, run.id, "scenario_subagent_started", {
      requirement,
    });

    const scenarioResult = await runScenarioAnalysis(pool, requirement);

    for (const toolCall of scenarioResult.toolCalls) {
      await recordTraceEvent(pool, run.id, "scenario_tool_call", {
        toolName: toolCall.name,
        args: toolCall.args,
      });
    }

    for (const toolResult of scenarioResult.toolResults) {
      await recordTraceEvent(pool, run.id, "scenario_tool_result", {
        toolName: toolResult.name,
        result: toolResult.result,
        isError: toolResult.isError,
      });

      if (!toolResult.isError && toolResult.name === "read") {
        await recordTraceEvent(pool, run.id, "scenario_skill_loaded", {
          skill: "scenario-analysis",
        });
      }

      if (!toolResult.isError && toolResult.name === "query_scenario_tree") {
        await recordTraceEvent(pool, run.id, "scenario_tree_queried", {
          tool: "query_scenario_tree",
        });
      }
    }

    await saveScenarioProposals(pool, run.id, scenarioResult.proposals);

    await recordTraceEvent(pool, run.id, "scenario_proposals_generated", {
      proposals: scenarioResult.proposals,
      callCount: scenarioResult.callCount,
    });

    console.error("Proposed scenarios:");
    for (const proposal of scenarioResult.proposals) {
      console.error(
        `- [${proposal.kind}] ${proposal.title}: ${proposal.description}`,
      );
    }

    await recordTraceEvent(pool, run.id, "scenario_confirmation_requested", {
      proposals: scenarioResult.proposals,
    });

    const confirmed = await confirmScenarioProposals();

    await recordTraceEvent(pool, run.id, "scenario_confirmation_received", {
      confirmed,
    });

    const assets = await settleScenarioProposals(pool, run.id, confirmed);

    await recordTraceEvent(pool, run.id, "scenario_assets_persisted", {
      count: assets.length,
      assets,
    });

    const status = confirmed ? "succeeded" : "rejected";
    await completeAnalysisRun(pool, run.id, status);

    await recordTraceEvent(pool, run.id, "analysis_run_completed", {
      status,
      scenarioAssetCount: assets.length,
    });

    const result: CliResult = {
      runId: run.id,
      status,
      scenarioAssetCount: assets.length,
      confirmedScenarios: assets.map((asset) => ({
        kind: asset.kind,
        title: asset.title,
      })),
    };

    console.log(JSON.stringify(result));
    process.exitCode = confirmed ? 0 : 2;
  } catch (error) {
    if (runId) {
      await recordTraceEvent(pool, runId, "analysis_run_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      await failAnalysisRun(pool, runId);
    }

    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
