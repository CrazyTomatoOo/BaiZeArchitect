import {
  createInterface,
  type Interface as ReadlineInterface,
} from "node:readline/promises";
import { runScenarioAnalysis } from "./agent/scenario.ts";
import { runUseCaseAnalysis } from "./agent/use-case.ts";
import { runFeatureAnalysis } from "./agent/feature.ts";
import { analysisModelDescriptor } from "./agent/analysis-model-adapter.ts";
import {
  runAnalysisOrchestrator,
  type AnalysisPlan,
  type AnalysisPlanStage,
  type AnalysisStageName,
} from "./agent/orchestrator.ts";
import type { AnalysisRevision } from "./agent/analysis-subagent.ts";
import { McpToolClient } from "./mcp.ts";
import { runMcpServer } from "./mcp-server.ts";
import {
  cancelAnalysisRun,
  completeAnalysisRun,
  createAnalysisRun,
  failAnalysisRun,
  getAnalysisRun,
  initializeSchema,
  listFeatureAssetsByRun,
  listFeatureProposalsByRun,
  rejectFeatureProposals,
  rejectScenarioProposals,
  rejectUseCaseProposals,
  listScenarioAssetsByRun,
  listScenarioProposalsByRun,
  listUseCaseAssetsByRun,
  listUseCaseProposalsByRun,
  recordTraceEvent,
  saveScenarioProposals,
  setAnalysisRunStatus,
  settleScenarioProposals,
  saveUseCaseProposals,
  settleUseCaseProposals,
  saveFeatureProposals,
  settleFeatureProposals,
  SqlitePool,
  type AnalysisRunRecord,
  type AnalysisRunStage,
  type AnalysisRunStatus,
  type ScenarioAsset,
  type ScenarioProposalInput,
  type UseCaseAsset,
  type UseCaseProposalInput,
  type FeatureAsset,
  type FeatureProposalInput,
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

interface RunSnapshotCommands {
  status: string;
  approve: string | null;
  reject: string | null;
  revise: string | null;
}

interface RunSnapshot {
  runId: string;
  status: AnalysisRunStatus;
  currentStage: AnalysisRunStage | null;
  stageLabel: string | null;
  requirement: string;
  gateOpen: boolean;
  resumeBlockedReason: string | null;
  proposals: StageProposal[];
  scenarioAssetCount: number;
  useCaseAssetCount: number;
  featureAssetCount: number;
  nextStageOnApprove: AnalysisRunStage | null;
  revisionStage: AnalysisRunStage | null;
  nextCommand: string | null;
  commands: RunSnapshotCommands;
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

interface SettleStageConfig<TAsset> {
  stage: "scenario" | "use case" | "feature";
  toolTrace: { eventPrefix: string };
  settleProposals: (confirmed: boolean) => Promise<TAsset[]>;
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
  pool: SqlitePool,
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

async function prepareAnalysisStage<TProposal extends StageProposal, TAsset>(
  pool: SqlitePool,
  runId: string,
  cancellation: CancellationController,
  config: AnalysisStageConfig<TProposal, TAsset>,
): Promise<TProposal[]> {
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

  await recordTraceEvent(
    pool,
    runId,
    `${config.toolTrace.eventPrefix}confirmation_requested`,
    {
      proposals: result.proposals,
    },
  );

  return result.proposals;
}

async function settleAnalysisStage<TAsset>(
  pool: SqlitePool,
  runId: string,
  cancellation: CancellationController,
  config: SettleStageConfig<TAsset>,
  confirmed: boolean,
): Promise<StageOutcome<TAsset>> {
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

async function runAnalysisStage<TProposal extends StageProposal, TAsset>(
  pool: SqlitePool,
  runId: string,
  confirmation: ConfirmationReader,
  cancellation: CancellationController,
  config: AnalysisStageConfig<TProposal, TAsset>,
): Promise<StageOutcome<TAsset>> {
  const proposals = await prepareAnalysisStage(
    pool,
    runId,
    cancellation,
    config,
  );

  console.error(`Proposed ${config.proposalLabel}:`);
  for (const proposal of proposals) {
    console.error(
      `- [${proposal.kind}] ${proposal.title}: ${proposal.description}`,
    );
  }

  await setAnalysisRunStatus(
    pool,
    runId,
    "awaiting_confirmation",
    plannedStageName(config.stage),
  );
  await recordTraceEvent(pool, runId, "analysis_run_awaiting_confirmation", {
    stage: plannedStageName(config.stage),
  });

  const confirmed = await confirmation.confirm(config.stage);
  cancellation.throwIfRequested();

  await setAnalysisRunStatus(
    pool,
    runId,
    "running",
    plannedStageName(config.stage),
  );

  return settleAnalysisStage(
    pool,
    runId,
    cancellation,
    config,
    confirmed,
  );
}

function fixedAnalysisPlan(): AnalysisPlan {
  return {
    stages: [
      {
        name: "scenario",
        description: "Analyze related and new scenarios.",
      },
      {
        name: "use_case",
        description:
          "Analyze related and new use cases from confirmed scenarios.",
      },
      {
        name: "feature",
        description:
          "Analyze affected and new features from confirmed use cases.",
      },
    ],
  };
}

function resumeCommand(runId: string): string {
  return `npm start -- resume ${runId} y`;
}

function runSnapshotCommands(runId: string): RunSnapshotCommands {
  const approve = resumeCommand(runId);

  return {
    status: `npm start -- status ${runId}`,
    approve,
    reject: `npm start -- resume ${runId} n`,
    revise: `npm start -- resume ${runId} revise -- "<revision-feedback>"`,
  };
}

function terminalRunSnapshotCommands(runId: string): RunSnapshotCommands {
  return {
    status: `npm start -- status ${runId}`,
    approve: null,
    reject: null,
    revise: null,
  };
}

function nextStageOnApprove(stage: AnalysisRunStage): AnalysisRunStage | null {
  if (stage === "scenario") {
    return "use_case";
  }

  return stage === "use_case" ? "feature" : null;
}

function stageLabel(stage: AnalysisRunStage): string {
  if (stage === "use_case") {
    return "Use case";
  }

  return stage === "scenario" ? "Scenario" : "Feature";
}

function runSnapshot(
  runId: string,
  requirement: string,
  status: AnalysisRunStatus,
  currentStage: AnalysisRunStage | null,
  proposals: StageProposal[],
  scenarioAssetCount: number,
  useCaseAssetCount: number,
  featureAssetCount: number,
): RunSnapshot {
  const openStage =
    status === "awaiting_confirmation" && currentStage !== null
      ? currentStage
      : null;
  const gateOpen = openStage !== null;
  const blockedReason = gateOpen
    ? null
    : status === "running"
      ? "run_is_running"
      : "run_is_terminal";
  const commands = gateOpen
    ? runSnapshotCommands(runId)
    : terminalRunSnapshotCommands(runId);

  return {
    runId,
    status,
    currentStage,
    stageLabel: currentStage ? stageLabel(currentStage) : null,
    requirement,
    gateOpen,
    resumeBlockedReason: blockedReason,
    proposals,
    scenarioAssetCount,
    useCaseAssetCount,
    featureAssetCount,
    nextStageOnApprove: openStage ? nextStageOnApprove(openStage) : null,
    revisionStage: openStage,
    nextCommand: gateOpen ? commands.approve : null,
    commands,
  };
}

function formatRunSnapshotSummary(snapshot: RunSnapshot): string {
  const summary = [
    `Requirement: ${snapshot.requirement}`,
    `Lifecycle status: ${snapshot.status}`,
    `Current stage: ${
      snapshot.currentStage ? stageLabel(snapshot.currentStage) : "none"
    }`,
    `Gate open: ${snapshot.gateOpen ? "yes" : "no"}`,
    `Resume blocked: ${snapshot.resumeBlockedReason ?? "no"}`,
    `Progress: ${snapshot.scenarioAssetCount} scenarios, ${snapshot.useCaseAssetCount} use cases, ${snapshot.featureAssetCount} features confirmed`,
  ];

  if (!snapshot.gateOpen) {
    return [
      ...summary,
      "",
      "No Confirmation Gate is open.",
      `Status command: ${snapshot.commands.status}`,
    ].join("\n");
  }

  return [
    ...summary,
    "",
    "Proposals:",
    ...snapshot.proposals.map(
      (proposal) =>
        `- [${proposal.kind}] ${proposal.title}: ${proposal.description}`,
    ),
    "",
    `Approve will continue to: ${
      snapshot.nextStageOnApprove ?? "complete the run"
    }`,
    `Revise will rerun: ${snapshot.revisionStage}`,
    "",
    "Commands:",
    `  status:  ${snapshot.commands.status}`,
    `  approve: ${snapshot.commands.approve}`,
    `  reject:  ${snapshot.commands.reject}`,
    `  revise:  ${snapshot.commands.revise}`,
  ].join("\n");
}

function printRunSnapshot(snapshot: RunSnapshot): void {
  console.log(JSON.stringify(snapshot));
  console.error(formatRunSnapshotSummary(snapshot));
}

async function currentStageProposals(
  pool: SqlitePool,
  run: AnalysisRunRecord,
): Promise<StageProposal[]> {
  if (run.status !== "awaiting_confirmation" || run.currentStage === null) {
    return [];
  }

  const stage = run.currentStage;

  if (stage === "scenario") {
    const proposals = await listScenarioProposalsByRun(pool, run.id);
    return proposals.map(({ kind, title, description }) => ({
      kind,
      title,
      description,
    }));
  }

  if (stage === "use_case") {
    const proposals = await listUseCaseProposalsByRun(pool, run.id);
    return proposals.map(
      ({ kind, title, description, scenarioTitle }) => ({
        kind,
        title,
        description,
        scenarioTitle,
      }),
    );
  }

  const proposals = await listFeatureProposalsByRun(pool, run.id);
  return proposals.map(({ kind, title, description, useCaseTitle }) => ({
    kind,
    title,
    description,
    useCaseTitle,
  }));
}

async function runSnapshotFromAnalysisRun(
  pool: SqlitePool,
  run: AnalysisRunRecord,
): Promise<RunSnapshot> {
  const [scenarioAssets, useCaseAssets, featureAssets, proposals] =
    await Promise.all([
      listScenarioAssetsByRun(pool, run.id),
      listUseCaseAssetsByRun(pool, run.id),
      listFeatureAssetsByRun(pool, run.id),
      currentStageProposals(pool, run),
    ]);

  return runSnapshot(
    run.id,
    run.requirement,
    run.status,
    run.currentStage,
    proposals,
    scenarioAssets.length,
    useCaseAssets.length,
    featureAssets.length,
  );
}

async function readAnalysisRunSnapshot(runIdArgument: string): Promise<void> {
  const databasePath = process.env.BAIZE_DB_PATH;

  if (!databasePath) {
    console.error("BAIZE_DB_PATH is required");
    process.exitCode = 2;
    return;
  }

  const pool = new SqlitePool(databasePath);

  try {
    const run = await getAnalysisRun(pool, runIdArgument);

    if (!run) {
      console.error(`Analysis run not found: ${runIdArgument}`);
      process.exitCode = 2;
      return;
    }

    const snapshot = await runSnapshotFromAnalysisRun(pool, run);
    printRunSnapshot(snapshot);
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

async function statusAnalysisRun(
  runIdArgument: string | undefined,
  extraArguments: readonly string[],
): Promise<void> {
  if (!runIdArgument || extraArguments.length > 0) {
    console.error("Usage: npm start -- status <runId>");
    process.exitCode = 2;
    return;
  }

  await readAnalysisRunSnapshot(runIdArgument);
}

function scenarioStageConfig(
  pool: SqlitePool,
  runId: string,
  cancellation: CancellationController,
  mcp: McpToolClient,
  requirement: string,
  planStage: AnalysisPlanStage,
  revision?: AnalysisRevision<ScenarioProposalInput>,
): AnalysisStageConfig<ScenarioProposalInput, ScenarioAsset> {
  return {
    stage: "scenario",
    planStage,
    proposalLabel: "scenarios",
    startEventName: "scenario_subagent_started",
    startPayload: { requirement },
    runAnalysis: () => runScenarioAnalysis(mcp, requirement, revision),
    toolTrace: {
      eventPrefix: "scenario_",
      skillName: "scenario-analysis",
      queryToolName: "query_scenario_tree",
      libraryEventName: "scenario_tree_queried",
    },
    saveProposals: (proposals) =>
      saveScenarioProposals(pool, runId, proposals, cancellation.signal),
    settleProposals: (confirmed) =>
      settleScenarioProposals(pool, runId, confirmed, cancellation.signal),
  };
}

function useCaseStageConfig(
  pool: SqlitePool,
  runId: string,
  cancellation: CancellationController,
  requirement: string,
  scenarioAssets: ScenarioAsset[],
  planStage: AnalysisPlanStage,
  revision?: AnalysisRevision<UseCaseProposalInput>,
): AnalysisStageConfig<UseCaseProposalInput, UseCaseAsset> {
  return {
    stage: "use case",
    planStage,
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
      runUseCaseAnalysis(pool, requirement, scenarioAssets, revision),
    toolTrace: {
      eventPrefix: "use_case_",
      skillName: "use-case-analysis",
      queryToolName: "query_use_case_library",
      libraryEventName: "use_case_library_queried",
    },
    saveProposals: (proposals) =>
      saveUseCaseProposals(
        pool,
        runId,
        proposals,
        scenarioAssets,
        cancellation.signal,
      ),
    settleProposals: (confirmed) =>
      settleUseCaseProposals(pool, runId, confirmed, cancellation.signal),
  };
}

function featureStageConfig(
  pool: SqlitePool,
  runId: string,
  cancellation: CancellationController,
  requirement: string,
  useCaseAssets: UseCaseAsset[],
  planStage: AnalysisPlanStage,
  revision?: AnalysisRevision<FeatureProposalInput>,
): AnalysisStageConfig<FeatureProposalInput, FeatureAsset> {
  return {
    stage: "feature",
    planStage,
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
      runFeatureAnalysis(pool, requirement, useCaseAssets, revision),
    toolTrace: {
      eventPrefix: "feature_",
      skillName: "feature-analysis",
      queryToolName: "query_feature_library",
      libraryEventName: "feature_library_queried",
    },
    saveProposals: (proposals) =>
      saveFeatureProposals(
        pool,
        runId,
        proposals,
        useCaseAssets,
        cancellation.signal,
      ),
    settleProposals: (confirmed) =>
      settleFeatureProposals(pool, runId, confirmed, cancellation.signal),
  };
}

async function main(gated: boolean): Promise<void> {
  const cliArgs = process.argv.slice(2).filter((arg) => arg !== "--gated");
  const requirement = cliArgs[0]?.trim();

  if (!requirement) {
    console.error("Usage: npm start -- [--gated] <requirement>");
    process.exitCode = 2;
    return;
  }

  const databasePath = process.env.BAIZE_DB_PATH;

  if (!databasePath) {
    console.error("BAIZE_DB_PATH is required");
    process.exitCode = 2;
    return;
  }

  const pool = new SqlitePool(databasePath);
  const cancellation = new CancellationController();
  const confirmation = gated ? undefined : new ConfirmationReader(cancellation);
  const model = analysisModelDescriptor();
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
      modelMode: model.mode,
      model: model.reference,
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

    let scenarioStage: StageOutcome<ScenarioAsset> | undefined;
    try {
      const scenarioConfig = scenarioStageConfig(
        pool,
        run.id,
        cancellation,
        mcp,
        requirement,
        scenarioPlanStage,
      );

      await setAnalysisRunStatus(pool, run.id, "running", "scenario");

      if (gated) {
        const proposals = await prepareAnalysisStage(
          pool,
          run.id,
          cancellation,
          scenarioConfig,
        );
        await setAnalysisRunStatus(
          pool,
          run.id,
          "awaiting_confirmation",
          "scenario",
        );
        await recordTraceEvent(
          pool,
          run.id,
          "analysis_run_awaiting_confirmation",
          { stage: "scenario" },
        );
        const snapshot = runSnapshot(
          run.id,
          requirement,
          "awaiting_confirmation",
          "scenario",
          proposals,
          0,
          0,
          0,
        );
        printRunSnapshot(snapshot);
        return;
      }

      if (!confirmation) {
        throw new Error("Interactive confirmation reader is required");
      }

      scenarioStage = await runAnalysisStage(
        pool,
        run.id,
        confirmation,
        cancellation,
        scenarioConfig,
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
          useCaseStageConfig(
            pool,
            run.id,
            cancellation,
            requirement,
            scenarioAssets,
            useCasePlanStage,
          ),
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
            featureStageConfig(
              pool,
              run.id,
              cancellation,
              requirement,
              useCaseAssets,
              featurePlanStage,
            ),
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
    confirmation?.close();
    await pool.end();
  }
}

async function reviseAnalysisStage(
  pool: SqlitePool,
  runId: string,
  requirement: string,
  cancellation: CancellationController,
  stage: AnalysisRunStage,
  feedback: string,
): Promise<RunSnapshot> {
  const analysisPlan = fixedAnalysisPlan();
  const useCasePlanStage = getPlannedStage(analysisPlan, "use_case");
  const featurePlanStage = getPlannedStage(analysisPlan, "feature");

  if (stage === "scenario") {
    const previousProposals = await listScenarioProposalsByRun(pool, runId);
    await recordTraceEvent(pool, runId, "analysis_run_revision_requested", {
      stage: "scenario",
      feedback,
      previousProposals,
    });
    await rejectScenarioProposals(pool, runId);
    await setAnalysisRunStatus(pool, runId, "running", stage);

    const mcp = new McpToolClient(pool, runId);
    const mcpStart = mcp.start();
    mcpStart.catch(() => undefined);
    await Promise.race([mcpStart, cancellation.promise]);
    cancellation.throwIfRequested();

    let proposals: ScenarioProposalInput[];
    try {
      proposals = await prepareAnalysisStage(
        pool,
        runId,
        cancellation,
        scenarioStageConfig(
          pool,
          runId,
          cancellation,
          mcp,
          requirement,
          getPlannedStage(analysisPlan, "scenario"),
          { feedback, previousProposals },
        ),
      );
    } finally {
      await mcp.close();
    }

    await setAnalysisRunStatus(pool, runId, "awaiting_confirmation", stage);
    return runSnapshot(
      runId,
      requirement,
      "awaiting_confirmation",
      stage,
      proposals,
      0,
      0,
      0,
    );
  }

  if (stage === "use_case") {
    const previousProposals = await listUseCaseProposalsByRun(pool, runId);
    const scenarioAssets = await listScenarioAssetsByRun(pool, runId);
    await recordTraceEvent(pool, runId, "analysis_run_revision_requested", {
      stage: "use_case",
      feedback,
      previousProposals,
    });
    await rejectUseCaseProposals(pool, runId);
    await setAnalysisRunStatus(pool, runId, "running", stage);

    const proposals = await prepareAnalysisStage(
      pool,
      runId,
      cancellation,
      useCaseStageConfig(
        pool,
        runId,
        cancellation,
        requirement,
        scenarioAssets,
        useCasePlanStage,
        { feedback, previousProposals },
      ),
    );
    await setAnalysisRunStatus(pool, runId, "awaiting_confirmation", stage);
    return runSnapshot(
      runId,
      requirement,
      "awaiting_confirmation",
      stage,
      proposals,
      scenarioAssets.length,
      0,
      0,
    );
  }

  const previousProposals = await listFeatureProposalsByRun(pool, runId);
  const scenarioAssets = await listScenarioAssetsByRun(pool, runId);
  const useCaseAssets = await listUseCaseAssetsByRun(pool, runId);
  await recordTraceEvent(pool, runId, "analysis_run_revision_requested", {
    stage: "feature",
    feedback,
    previousProposals,
  });
  await rejectFeatureProposals(pool, runId);
  await setAnalysisRunStatus(pool, runId, "running", stage);

  const proposals = await prepareAnalysisStage(
    pool,
    runId,
    cancellation,
    featureStageConfig(
      pool,
      runId,
      cancellation,
      requirement,
      useCaseAssets,
      featurePlanStage,
      { feedback, previousProposals },
    ),
  );
  await setAnalysisRunStatus(pool, runId, "awaiting_confirmation", stage);
  return runSnapshot(
    runId,
    requirement,
    "awaiting_confirmation",
    stage,
    proposals,
    scenarioAssets.length,
    useCaseAssets.length,
    0,
  );
}

async function resumeAnalysisRun(
  runIdArgument: string | undefined,
  actionArgument: string | undefined,
  feedbackArguments: readonly string[],
): Promise<void> {
  const resumeUsage =
    "Usage: npm start -- resume <runId> [y|n|revise -- \"<revision-feedback>\"]";

  if (!runIdArgument) {
    console.error(resumeUsage);
    process.exitCode = 2;
    return;
  }

  if (actionArgument === undefined) {
    if (feedbackArguments.length > 0) {
      console.error(resumeUsage);
      process.exitCode = 2;
      return;
    }

    await readAnalysisRunSnapshot(runIdArgument);
    return;
  }

  const databasePath = process.env.BAIZE_DB_PATH;

  if (!databasePath) {
    console.error("BAIZE_DB_PATH is required");
    process.exitCode = 2;
    return;
  }

  const action = actionArgument.trim().toLowerCase();
  const validAction = ["y", "yes", "n", "no", "revise"].includes(action);

  if (!validAction) {
    console.error(
      "Resume action must be y, yes, n, no, or revise with non-empty feedback",
    );
    process.exitCode = 2;
    return;
  }

  if (
    (action !== "revise" && feedbackArguments.length > 0) ||
    (action === "revise" &&
      (feedbackArguments[0] !== "--" || feedbackArguments.length !== 2))
  ) {
    console.error(resumeUsage);
    process.exitCode = 2;
    return;
  }

  const feedback =
    action === "revise" ? feedbackArguments.slice(1).join(" ").trim() : "";

  if (action === "revise" && !feedback) {
    console.error(
      "Resume action must be y, yes, n, no, or revise with non-empty feedback",
    );
    process.exitCode = 2;
    return;
  }

  const confirmed = action === "y" || action === "yes";

  const pool = new SqlitePool(databasePath);
  const cancellation = new CancellationController();
  let runId: string | undefined;

  cancellation.install();

  try {
    await initializeSchema(pool);
    cancellation.throwIfRequested();

    const run = await getAnalysisRun(pool, runIdArgument);
    if (!run) {
      console.error(`Analysis run not found: ${runIdArgument}`);
      process.exitCode = 2;
      return;
    }

    if (run.status !== "awaiting_confirmation" || !run.currentStage) {
      console.error(
        `Analysis run is not awaiting confirmation (status: ${run.status})`,
      );
      process.exitCode = 2;
      return;
    }

    runId = run.id;
    const stage = run.currentStage;

    if (action === "revise") {
      const snapshot = await reviseAnalysisStage(
        pool,
        run.id,
        run.requirement,
        cancellation,
        stage,
        feedback,
      );
      printRunSnapshot(snapshot);
      return;
    }

    await recordTraceEvent(pool, run.id, "analysis_run_resumed", {
      stage,
      confirmed,
    });
    await setAnalysisRunStatus(pool, run.id, "running", stage);

    const analysisPlan = fixedAnalysisPlan();
    const useCasePlanStage = getPlannedStage(analysisPlan, "use_case");
    const featurePlanStage = getPlannedStage(analysisPlan, "feature");

    if (stage === "scenario") {
      const scenarioStage = await settleAnalysisStage(
        pool,
        run.id,
        cancellation,
        {
          stage: "scenario",
          toolTrace: { eventPrefix: "scenario_" },
          settleProposals: (shouldConfirm) =>
            settleScenarioProposals(
              pool,
              run.id,
              shouldConfirm,
              cancellation.signal,
            ),
        },
        confirmed,
      );

      if (!confirmed) {
        await completeAnalysisRun(pool, run.id, "rejected");
        await recordTraceEvent(pool, run.id, "analysis_run_completed", {
          status: "rejected",
          scenarioAssetCount: 0,
          useCaseAssetCount: 0,
          featureAssetCount: 0,
        });
        const snapshot = runSnapshot(
          run.id,
          run.requirement,
          "rejected",
          stage,
          [],
          0,
          0,
          0,
        );
        printRunSnapshot(snapshot);
        process.exitCode = 2;
        return;
      }

      await setAnalysisRunStatus(pool, run.id, "running", "use_case");
      const useCaseProposals = await prepareAnalysisStage(
        pool,
        run.id,
        cancellation,
        useCaseStageConfig(
          pool,
          run.id,
          cancellation,
          run.requirement,
          scenarioStage.assets,
          useCasePlanStage,
        ),
      );
      await setAnalysisRunStatus(
        pool,
        run.id,
        "awaiting_confirmation",
        "use_case",
      );
      await recordTraceEvent(
        pool,
        run.id,
        "analysis_run_awaiting_confirmation",
        { stage: "use_case" },
      );
      const snapshot = runSnapshot(
        run.id,
        run.requirement,
        "awaiting_confirmation",
        "use_case",
        useCaseProposals,
        scenarioStage.assets.length,
        0,
        0,
      );
      printRunSnapshot(snapshot);
      return;
    }

    if (stage === "use_case") {
      const scenarioAssets = await listScenarioAssetsByRun(pool, run.id);
      const useCaseStage = await settleAnalysisStage(
        pool,
        run.id,
        cancellation,
        {
          stage: "use case",
          toolTrace: { eventPrefix: "use_case_" },
          settleProposals: (shouldConfirm) =>
            settleUseCaseProposals(
              pool,
              run.id,
              shouldConfirm,
              cancellation.signal,
            ),
        },
        confirmed,
      );

      if (!confirmed) {
        await completeAnalysisRun(pool, run.id, "rejected");
        await recordTraceEvent(pool, run.id, "analysis_run_completed", {
          status: "rejected",
          scenarioAssetCount: scenarioAssets.length,
          useCaseAssetCount: 0,
          featureAssetCount: 0,
        });
        const snapshot = runSnapshot(
          run.id,
          run.requirement,
          "rejected",
          stage,
          [],
          scenarioAssets.length,
          0,
          0,
        );
        printRunSnapshot(snapshot);
        process.exitCode = 2;
        return;
      }

      await setAnalysisRunStatus(pool, run.id, "running", "feature");
      const featureProposals = await prepareAnalysisStage(
        pool,
        run.id,
        cancellation,
        featureStageConfig(
          pool,
          run.id,
          cancellation,
          run.requirement,
          useCaseStage.assets,
          featurePlanStage,
        ),
      );
      await setAnalysisRunStatus(
        pool,
        run.id,
        "awaiting_confirmation",
        "feature",
      );
      await recordTraceEvent(
        pool,
        run.id,
        "analysis_run_awaiting_confirmation",
        { stage: "feature" },
      );
      const snapshot = runSnapshot(
        run.id,
        run.requirement,
        "awaiting_confirmation",
        "feature",
        featureProposals,
        scenarioAssets.length,
        useCaseStage.assets.length,
        0,
      );
      printRunSnapshot(snapshot);
      return;
    }

    const scenarioAssets = await listScenarioAssetsByRun(pool, run.id);
    const useCaseAssets = await listUseCaseAssetsByRun(pool, run.id);
    const featureStage = await settleAnalysisStage(
      pool,
      run.id,
      cancellation,
      {
        stage: "feature",
        toolTrace: { eventPrefix: "feature_" },
        settleProposals: (shouldConfirm) =>
          settleFeatureProposals(
            pool,
            run.id,
            shouldConfirm,
            cancellation.signal,
          ),
      },
      confirmed,
    );
    const status = confirmed ? "succeeded" : "rejected";

    await completeAnalysisRun(pool, run.id, status);
    await recordTraceEvent(pool, run.id, "analysis_run_completed", {
      status,
      scenarioAssetCount: scenarioAssets.length,
      useCaseAssetCount: useCaseAssets.length,
      featureAssetCount: featureStage.assets.length,
    });

    if (!confirmed) {
      const snapshot = runSnapshot(
        run.id,
        run.requirement,
        status,
        "feature",
        [],
        scenarioAssets.length,
        useCaseAssets.length,
        featureStage.assets.length,
      );
      printRunSnapshot(snapshot);
      process.exitCode = 2;
      return;
    }

    const snapshot = runSnapshot(
      run.id,
      run.requirement,
      "succeeded",
      "feature",
      [],
      scenarioAssets.length,
      useCaseAssets.length,
      featureStage.assets.length,
    );
    printRunSnapshot(snapshot);
    process.exitCode = 0;
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
    await pool.end();
  }
}

void (async () => {
  if (process.argv[2] === "mcp") {
    await runMcpServer();
    return;
  }

  if (process.argv[2] === "resume") {
    await resumeAnalysisRun(
      process.argv[3],
      process.argv[4],
      process.argv.slice(5),
    );
    return;
  }

  if (process.argv[2] === "status") {
    await statusAnalysisRun(process.argv[3], process.argv.slice(4));
    return;
  }

  await main(process.argv.includes("--gated"));
})().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
