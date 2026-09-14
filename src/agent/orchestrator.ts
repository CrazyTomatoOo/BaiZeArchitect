import {
  runFauxAgent,
  type FauxAgentResult,
} from "./analysis-agent.ts";

export type AnalysisStageName = "scenario" | "use_case" | "feature";

export interface AnalysisPlanStage {
  name: AnalysisStageName;
  description: string;
}

export interface AnalysisPlan {
  stages: AnalysisPlanStage[];
}

export async function runAnalysisOrchestrator(
  requirement: string,
): Promise<FauxAgentResult<AnalysisPlan>> {
  return runFauxAgent({
    skillName: "analysis-orchestration",
    systemPrompt:
      "You are the BaiZe Analysis Orchestrator. Use the analysis-orchestration skill, query the analysis contract, and return only JSON with the sequential analysis stages.",
    queryToolName: "query_analysis_contract",
    queryToolLabel: "Query analysis contract",
    queryToolDescription: "Query the sequential analysis contract.",
    queryData: () =>
      Promise.resolve([
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
      ]),
    prompt: requirement,
    finalResponse: {
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
    },
    parseResult: parseAnalysisPlan,
  });
}

function parseAnalysisPlan(text: string): AnalysisPlan {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Analysis Orchestrator did not return valid JSON: ${text}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { stages?: unknown }).stages)
  ) {
    throw new Error("Analysis Orchestrator response must contain a stages array");
  }

  const stages = (parsed as { stages: unknown[] }).stages;

  if (
    stages.some(
      (stage) =>
        typeof stage !== "object" ||
        stage === null ||
        ((stage as { name?: unknown }).name !== "scenario" &&
          (stage as { name?: unknown }).name !== "use_case" &&
          (stage as { name?: unknown }).name !== "feature") ||
        typeof (stage as { description?: unknown }).description !== "string",
    )
  ) {
    throw new Error("Analysis plan stage has an invalid shape");
  }

  const typedStages = stages as AnalysisPlanStage[];
  const stageNames = typedStages.map((stage) => stage.name);

  if (
    JSON.stringify(stageNames) !==
    JSON.stringify(["scenario", "use_case", "feature"])
  ) {
    throw new Error("Analysis plan must contain the three sequential stages");
  }

  return { stages: typedStages };
}
