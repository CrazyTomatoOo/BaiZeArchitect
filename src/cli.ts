import { Pool } from "pg";
import {
  createInterface,
  type Interface as ReadlineInterface,
} from "node:readline/promises";
import { runScenarioAnalysis } from "./agent/scenario.ts";
import { runUseCaseAnalysis } from "./agent/use-case.ts";
import {
  completeAnalysisRun,
  createAnalysisRun,
  failAnalysisRun,
  initializeSchema,
  recordTraceEvent,
  saveScenarioProposals,
  settleScenarioProposals,
  saveUseCaseProposals,
  settleUseCaseProposals,
  type ScenarioAsset,
  type UseCaseAsset,
} from "./db.ts";

interface CliResult {
  runId: string;
  status: "succeeded" | "rejected";
  scenarioAssetCount: number;
  useCaseAssetCount: number;
  confirmedScenarios: Array<{
    kind: ScenarioAsset["kind"];
    title: string;
  }>;
  confirmedUseCases: Array<{
    kind: UseCaseAsset["kind"];
    title: string;
  }>;
}

type ConfirmationResolver = (line: string) => void;

class ConfirmationReader {
  private readonly lines: string[] = [];
  private readonly waiters: ConfirmationResolver[] = [];
  private readonly readline: ReadlineInterface;

  constructor() {
    this.readline = createInterface({
      input: process.stdin,
      terminal: false,
    });
    this.readline.on("line", (line) => {
      const waiter = this.waiters.shift();

      if (waiter) {
        waiter(line);
      } else {
        this.lines.push(line);
      }
    });
    this.readline.on("close", () => {
      this.resolvePendingWaiters();
    });
  }

  async confirm(stage: "scenario" | "use case"): Promise<boolean> {
    process.stderr.write(`Confirm ${stage} proposals? [y/N] `);
    const answer = await this.readLine();

    return answer.trim().toLowerCase() === "y" ||
      answer.trim().toLowerCase() === "yes";
  }

  close(): void {
    this.readline.close();
    this.resolvePendingWaiters();
  }

  private async readLine(): Promise<string> {
    const line = this.lines.shift();

    if (line !== undefined) {
      return line;
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private resolvePendingWaiters(): void {
    for (const waiter of this.waiters.splice(0)) {
      waiter("");
    }
  }
}

interface ToolTraceResult {
  toolCalls: Array<{
    name: string;
    args: unknown;
  }>;
  toolResults: Array<{
    name: string;
    result: unknown;
    isError: boolean;
  }>;
}

interface ToolTraceConfig {
  eventPrefix: string;
  skillName: string;
  queryToolName: string;
  libraryEventName: string;
}

async function recordAnalysisToolTrace(
  pool: Pool,
  runId: string,
  config: ToolTraceConfig,
  result: ToolTraceResult,
): Promise<void> {
  for (const toolCall of result.toolCalls) {
    await recordTraceEvent(pool, runId, `${config.eventPrefix}tool_call`, {
      toolName: toolCall.name,
      args: toolCall.args,
    });
  }

  for (const toolResult of result.toolResults) {
    await recordTraceEvent(pool, runId, `${config.eventPrefix}tool_result`, {
      toolName: toolResult.name,
      result: toolResult.result,
      isError: toolResult.isError,
    });

    if (!toolResult.isError && toolResult.name === "read") {
      await recordTraceEvent(
        pool,
        runId,
        `${config.eventPrefix}skill_loaded`,
        {
          skill: config.skillName,
        },
      );
    }

    if (!toolResult.isError && toolResult.name === config.queryToolName) {
      await recordTraceEvent(pool, runId, config.libraryEventName, {
        tool: config.queryToolName,
      });
    }
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
  const confirmation = new ConfirmationReader();
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

    await recordAnalysisToolTrace(pool, run.id, {
      eventPrefix: "scenario_",
      skillName: "scenario-analysis",
      queryToolName: "query_scenario_tree",
      libraryEventName: "scenario_tree_queried",
    }, scenarioResult);

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

    const scenarioConfirmed = await confirmation.confirm("scenario");

    await recordTraceEvent(pool, run.id, "scenario_confirmation_received", {
      confirmed: scenarioConfirmed,
    });

    const scenarioAssets = await settleScenarioProposals(
      pool,
      run.id,
      scenarioConfirmed,
    );

    await recordTraceEvent(pool, run.id, "scenario_assets_persisted", {
      count: scenarioAssets.length,
      assets: scenarioAssets,
    });

    let useCaseAssets: UseCaseAsset[] = [];
    let useCaseConfirmed = false;

    if (scenarioConfirmed) {
      await recordTraceEvent(pool, run.id, "use_case_subagent_started", {
        requirement,
        confirmedScenarios: scenarioAssets.map((asset) => ({
          kind: asset.kind,
          title: asset.title,
          description: asset.description,
        })),
      });

      const useCaseResult = await runUseCaseAnalysis(
        pool,
        requirement,
        scenarioAssets,
      );

      await recordAnalysisToolTrace(pool, run.id, {
        eventPrefix: "use_case_",
        skillName: "use-case-analysis",
        queryToolName: "query_use_case_library",
        libraryEventName: "use_case_library_queried",
      }, useCaseResult);

      await saveUseCaseProposals(
        pool,
        run.id,
        useCaseResult.proposals,
        scenarioAssets,
      );

      await recordTraceEvent(pool, run.id, "use_case_proposals_generated", {
        proposals: useCaseResult.proposals,
        callCount: useCaseResult.callCount,
      });

      console.error("Proposed use cases:");
      for (const proposal of useCaseResult.proposals) {
        console.error(
          `- [${proposal.kind}] ${proposal.title}: ${proposal.description}`,
        );
      }

      await recordTraceEvent(pool, run.id, "use_case_confirmation_requested", {
        proposals: useCaseResult.proposals,
      });

      useCaseConfirmed = await confirmation.confirm("use case");

      await recordTraceEvent(pool, run.id, "use_case_confirmation_received", {
        confirmed: useCaseConfirmed,
      });

      useCaseAssets = await settleUseCaseProposals(
        pool,
        run.id,
        useCaseConfirmed,
      );

      await recordTraceEvent(pool, run.id, "use_case_assets_persisted", {
        count: useCaseAssets.length,
        assets: useCaseAssets,
      });
    }

    const status = scenarioConfirmed && useCaseConfirmed
      ? "succeeded"
      : "rejected";
    await completeAnalysisRun(pool, run.id, status);

    await recordTraceEvent(pool, run.id, "analysis_run_completed", {
      status,
      scenarioAssetCount: scenarioAssets.length,
      useCaseAssetCount: useCaseAssets.length,
    });

    const result: CliResult = {
      runId: run.id,
      status,
      scenarioAssetCount: scenarioAssets.length,
      useCaseAssetCount: useCaseAssets.length,
      confirmedScenarios: scenarioAssets.map((asset) => ({
        kind: asset.kind,
        title: asset.title,
      })),
      confirmedUseCases: useCaseAssets.map((asset) => ({
        kind: asset.kind,
        title: asset.title,
      })),
    };

    console.log(JSON.stringify(result));
    process.exitCode = scenarioConfirmed && useCaseConfirmed ? 0 : 2;
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
    confirmation.close();
    await pool.end();
  }
}

await main();
