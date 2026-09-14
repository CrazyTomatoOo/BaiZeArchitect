import { Pool } from "pg";
import {
  createInterface,
  type Interface as ReadlineInterface,
} from "node:readline/promises";
import { runScenarioAnalysis } from "./agent/scenario.ts";
import { runUseCaseAnalysis } from "./agent/use-case.ts";
import { runFeatureAnalysis } from "./agent/feature.ts";
import {
  runAnalysisOrchestrator,
  type AnalysisPlan,
  type AnalysisPlanStage,
  type AnalysisStageName,
} from "./agent/orchestrator.ts";
import { McpToolClient } from "./mcp.ts";
import { runMcpServer } from "./mcp-server.ts";
import {
  cancelAnalysisRun,
  completeAnalysisRun,
  createAnalysisRun,
  failAnalysisRun,
  initializeSchema,
  recordTraceEvent,
  saveScenarioProposals,
  settleScenarioProposals,
  saveUseCaseProposals,
  settleUseCaseProposals,
  saveFeatureProposals,
  settleFeatureProposals,
  type ScenarioAsset,
  type UseCaseAsset,
  type FeatureAsset,
} from "./db.ts";
import {
  CancellationError,
  errorMessage,
  failureCodeForError,
} from "./errors.ts";

interface CliResult {
  runId: string;
  status: "succeeded" | "rejected";
  scenarioAssetCount: number;
  useCaseAssetCount: number;
  featureAssetCount: number;
  confirmedScenarios: Array<{
    kind: ScenarioAsset["kind"];
    title: string;
  }>;
  confirmedUseCases: Array<{
    kind: UseCaseAsset["kind"];
    title: string;
  }>;
  confirmedFeatures: Array<{
    kind: FeatureAsset["kind"];
    title: string;
  }>;
}

type ConfirmationResolver = (line: string) => void;

class CancellationController {
  private rejectCancellation!: (error: CancellationError) => void;
  private readonly handlers = new Map<NodeJS.Signals, () => void>();
  private readonly controller = new AbortController();
  readonly promise: Promise<never>;

  constructor() {
    this.promise = new Promise<never>((_, reject) => {
      this.rejectCancellation = reject;
    });
    this.promise.catch(() => undefined);

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      this.handlers.set(signal, () => this.request(signal));
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  install(): void {
    for (const [signal, handler] of this.handlers) {
      process.on(signal, handler);
    }
  }

  dispose(): void {
    for (const [signal, handler] of this.handlers) {
      process.off(signal, handler);
    }
  }

  request(signal: "SIGINT" | "SIGTERM"): void {
    if (this.signal.aborted) {
      return;
    }

    const error = new CancellationError(signal);
    this.controller.abort(error);
    this.rejectCancellation(error);
  }

  throwIfRequested(): void {
    if (this.signal.aborted) {
      throw this.signal.reason instanceof CancellationError
        ? this.signal.reason
        : new CancellationError("SIGINT");
    }
  }
}

class ConfirmationReader {
  private readonly lines: string[] = [];
  private readonly waiters: ConfirmationResolver[] = [];
  private readonly readline: ReadlineInterface;

  constructor(private readonly cancellation: CancellationController) {
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

  async confirm(
    stage: "scenario" | "use case" | "feature",
  ): Promise<boolean> {
    process.stderr.write(`Confirm ${stage} proposals? [y/N] `);
    const answer = await Promise.race([
      this.readLine(),
      this.cancellation.promise,
    ]);

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

interface StageProposal {
  kind: string;
  title: string;
  description: string;
}

interface StageAnalysisResult<TProposal extends StageProposal>
  extends ToolTraceResult {
  proposals: TProposal[];
  callCount: number;
}

interface StageOutcome<TAsset> {
  assets: TAsset[];
  confirmed: boolean;
}

interface AnalysisStageConfig<
  TProposal extends StageProposal,
  TAsset,
> {
  stage: "scenario" | "use case" | "feature";
  planStage: AnalysisPlanStage;
  proposalLabel: string;
  startEventName: string;
  startPayload: Record<string, unknown>;
  runAnalysis: () => Promise<StageAnalysisResult<TProposal>>;
  toolTrace: ToolTraceConfig;
  saveProposals: (proposals: TProposal[]) => Promise<void>;
  settleProposals: (confirmed: boolean) => Promise<TAsset[]>;
}

function plannedStageName(
  stage: "scenario" | "use case" | "feature",
): AnalysisStageName {
  return stage === "use case" ? "use_case" : stage;
}

function getPlannedStage(
  analysisPlan: AnalysisPlan,
  name: AnalysisStageName,
): AnalysisPlanStage {
  const planStage = analysisPlan.stages.find((stage) => stage.name === name);

  if (!planStage) {
    throw new Error(`Analysis plan is missing stage: ${name}`);
  }

  return planStage;
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

async function runAnalysisStage<TProposal extends StageProposal, TAsset>(
  pool: Pool,
  runId: string,
  confirmation: ConfirmationReader,
  cancellation: CancellationController,
  config: AnalysisStageConfig<TProposal, TAsset>,
): Promise<StageOutcome<TAsset>> {
  cancellation.throwIfRequested();

  if (config.planStage.name !== plannedStageName(config.stage)) {
    throw new Error(`Analysis plan stage does not match ${config.stage} stage`);
  }

  await recordTraceEvent(pool, runId, config.startEventName, {
    ...config.startPayload,
    planStage: config.planStage,
  });

  const result = await config.runAnalysis();
  cancellation.throwIfRequested();

  await recordAnalysisToolTrace(pool, runId, config.toolTrace, result);
  cancellation.throwIfRequested();

  await config.saveProposals(result.proposals);
  cancellation.throwIfRequested();

  await recordTraceEvent(
    pool,
    runId,
    `${config.toolTrace.eventPrefix}proposals_generated`,
    {
      proposals: result.proposals,
      callCount: result.callCount,
    },
  );

  console.error(`Proposed ${config.proposalLabel}:`);
  for (const proposal of result.proposals) {
    console.error(
      `- [${proposal.kind}] ${proposal.title}: ${proposal.description}`,
    );
  }

  await recordTraceEvent(
    pool,
    runId,
    `${config.toolTrace.eventPrefix}confirmation_requested`,
    {
      proposals: result.proposals,
    },
  );

  const confirmed = await confirmation.confirm(config.stage);
  cancellation.throwIfRequested();

  await recordTraceEvent(
    pool,
    runId,
    `${config.toolTrace.eventPrefix}confirmation_received`,
    {
      confirmed,
    },
  );

  const assets = await config.settleProposals(confirmed);
  cancellation.throwIfRequested();

  await recordTraceEvent(
    pool,
    runId,
    `${config.toolTrace.eventPrefix}assets_persisted`,
    {
      count: assets.length,
      assets,
    },
  );

  return { assets, confirmed };
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
  const cancellation = new CancellationController();
  const confirmation = new ConfirmationReader(cancellation);
  let runId: string | undefined;

  cancellation.install();

  try {
    await initializeSchema(pool);
    cancellation.throwIfRequested();

    const run = await createAnalysisRun(pool, requirement);
    runId = run.id;
    cancellation.throwIfRequested();

    await recordTraceEvent(pool, run.id, "analysis_run_started", {
      requirement,
    });

    await recordTraceEvent(pool, run.id, "orchestrator_subagent_started", {
      requirement,
    });

    const orchestratorPromise = runAnalysisOrchestrator(requirement);
    orchestratorPromise.catch(() => undefined);
    const orchestratorResult = await Promise.race([
      orchestratorPromise,
      cancellation.promise,
    ]);
    cancellation.throwIfRequested();

    await recordAnalysisToolTrace(pool, run.id, {
      eventPrefix: "orchestrator_",
      skillName: "analysis-orchestration",
      queryToolName: "query_analysis_contract",
      libraryEventName: "analysis_contract_queried",
    }, orchestratorResult);

    const analysisPlan = orchestratorResult.result;
    const scenarioPlanStage = getPlannedStage(analysisPlan, "scenario");
    const useCasePlanStage = getPlannedStage(analysisPlan, "use_case");
    const featurePlanStage = getPlannedStage(analysisPlan, "feature");

    await recordTraceEvent(pool, run.id, "analysis_plan_created", {
      stages: analysisPlan.stages,
      callCount: orchestratorResult.callCount,
    });

    const mcp = new McpToolClient(pool, run.id);
    const mcpStart = mcp.start();
    mcpStart.catch(() => undefined);
    await Promise.race([mcpStart, cancellation.promise]);
    cancellation.throwIfRequested();

    let scenarioStage;
    try {
      scenarioStage = await runAnalysisStage(
        pool,
        run.id,
        confirmation,
        cancellation,
        {
        stage: "scenario",
        planStage: scenarioPlanStage,
        proposalLabel: "scenarios",
        startEventName: "scenario_subagent_started",
        startPayload: { requirement },
        runAnalysis: () => runScenarioAnalysis(mcp, requirement),
        toolTrace: {
          eventPrefix: "scenario_",
          skillName: "scenario-analysis",
          queryToolName: "query_scenario_tree",
          libraryEventName: "scenario_tree_queried",
        },
        saveProposals: (proposals) =>
          saveScenarioProposals(
            pool,
            run.id,
            proposals,
            cancellation.signal,
          ),
        settleProposals: (confirmed) =>
          settleScenarioProposals(
            pool,
            run.id,
            confirmed,
            cancellation.signal,
          ),
        },
      );
    } finally {
      await mcp.close();
    }
    const scenarioAssets = scenarioStage.assets;

    const useCaseStage = scenarioStage.confirmed
      ? await runAnalysisStage(
          pool,
          run.id,
          confirmation,
          cancellation,
          {
          stage: "use case",
          planStage: useCasePlanStage,
          proposalLabel: "use cases",
          startEventName: "use_case_subagent_started",
          startPayload: {
            requirement,
            confirmedScenarios: scenarioAssets.map((asset) => ({
              kind: asset.kind,
              title: asset.title,
              description: asset.description,
            })),
          },
          runAnalysis: () =>
            runUseCaseAnalysis(pool, requirement, scenarioAssets),
          toolTrace: {
            eventPrefix: "use_case_",
            skillName: "use-case-analysis",
            queryToolName: "query_use_case_library",
            libraryEventName: "use_case_library_queried",
          },
          saveProposals: (proposals) =>
            saveUseCaseProposals(
              pool,
              run.id,
              proposals,
              scenarioAssets,
              cancellation.signal,
            ),
          settleProposals: (confirmed) =>
            settleUseCaseProposals(
              pool,
              run.id,
              confirmed,
              cancellation.signal,
            ),
          },
        )
      : { assets: [] as UseCaseAsset[], confirmed: false };
    const useCaseAssets = useCaseStage.assets;

    const featureStage =
      scenarioStage.confirmed && useCaseStage.confirmed
        ? await runAnalysisStage(
            pool,
            run.id,
            confirmation,
            cancellation,
            {
            stage: "feature",
            planStage: featurePlanStage,
            proposalLabel: "features",
            startEventName: "feature_subagent_started",
            startPayload: {
              requirement,
              confirmedUseCases: useCaseAssets.map((asset) => ({
                kind: asset.kind,
                title: asset.title,
                description: asset.description,
              })),
            },
            runAnalysis: () =>
              runFeatureAnalysis(pool, requirement, useCaseAssets),
            toolTrace: {
              eventPrefix: "feature_",
              skillName: "feature-analysis",
              queryToolName: "query_feature_library",
              libraryEventName: "feature_library_queried",
            },
            saveProposals: (proposals) =>
              saveFeatureProposals(
                pool,
                run.id,
                proposals,
                useCaseAssets,
                cancellation.signal,
              ),
            settleProposals: (confirmed) =>
              settleFeatureProposals(
                pool,
                run.id,
                confirmed,
                cancellation.signal,
              ),
            },
          )
        : { assets: [] as FeatureAsset[], confirmed: false };
    const featureAssets = featureStage.assets;

    const status =
      scenarioStage.confirmed && useCaseStage.confirmed && featureStage.confirmed
      ? "succeeded"
      : "rejected";
    await completeAnalysisRun(pool, run.id, status);

    await recordTraceEvent(pool, run.id, "analysis_run_completed", {
      status,
      scenarioAssetCount: scenarioAssets.length,
      useCaseAssetCount: useCaseAssets.length,
      featureAssetCount: featureAssets.length,
    });

    const result: CliResult = {
      runId: run.id,
      status,
      scenarioAssetCount: scenarioAssets.length,
      useCaseAssetCount: useCaseAssets.length,
      featureAssetCount: featureAssets.length,
      confirmedScenarios: scenarioAssets.map((asset) => ({
        kind: asset.kind,
        title: asset.title,
      })),
      confirmedUseCases: useCaseAssets.map((asset) => ({
        kind: asset.kind,
        title: asset.title,
      })),
      confirmedFeatures: featureAssets.map((asset) => ({
        kind: asset.kind,
        title: asset.title,
      })),
    };

    console.log(JSON.stringify(result));
    process.exitCode =
      scenarioStage.confirmed && useCaseStage.confirmed && featureStage.confirmed
        ? 0
        : 2;
  } catch (error) {
    if (error instanceof CancellationError) {
      if (runId) {
        try {
          await recordTraceEvent(pool, runId, "analysis_run_cancelled", {
            signal: error.signal,
            error: error.message,
          });
          await cancelAnalysisRun(pool, runId);
        } catch (finalizationError) {
          console.error(
            `Failed to record cancellation: ${errorMessage(finalizationError)}`,
          );
        }
      }

      process.exitCode = error.signal === "SIGINT" ? 130 : 143;
      return;
    }

    const failureCode = failureCodeForError(error);

    if (runId) {
      try {
        await recordTraceEvent(pool, runId, "analysis_run_failed", {
          failureCode,
          error: errorMessage(error),
        });
        await failAnalysisRun(pool, runId, failureCode);
      } catch (finalizationError) {
        console.error(
          `Failed to record analysis failure: ${errorMessage(finalizationError)}`,
        );
      }
    }

    console.error(errorMessage(error));
    process.exitCode = 1;
  } finally {
    cancellation.dispose();
    confirmation.close();
    await pool.end();
  }
}

void (async () => {
  if (process.argv[2] === "mcp") {
    await runMcpServer();
    return;
  }

  await main();
})().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
