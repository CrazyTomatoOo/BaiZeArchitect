import type { Pool } from "pg";
import {
  listUseCaseNodes,
  type ScenarioAsset,
  type UseCaseProposalInput,
} from "../db.ts";
import {
  runAnalysisSubagent,
  type AnalysisSubagentDefinition,
  type AnalysisSubagentResult,
} from "./analysis-subagent.ts";

interface UseCaseAnalysisInput {
  pool: Pool;
  requirement: string;
  confirmedScenarios: ScenarioAsset[];
}

type UseCaseAnalysisResult = Omit<
  AnalysisSubagentResult<UseCaseProposalInput[]>,
  "result"
> & {
  proposals: UseCaseProposalInput[];
};

const useCaseAnalysisSubagent: AnalysisSubagentDefinition<
  UseCaseAnalysisInput,
  UseCaseProposalInput[]
> = {
  skill: {
    name: "use-case-analysis",
    systemPrompt:
      "You are the BaiZe Use Case Analysis subagent. Use the use-case-analysis skill, query the use-case library, and return only JSON with proposals.",
  },
  queryTool: {
    name: "query_use_case_library",
    label: "Query use case library",
    description: "Query the full use-case library from PostgreSQL.",
    data: (input) => listUseCaseNodes(input.pool),
  },
  prompt: (input) =>
    JSON.stringify({
      requirement: input.requirement,
      confirmedScenarios: input.confirmedScenarios.map((scenario) => ({
        title: scenario.title,
        description: scenario.description,
      })),
    }),
  finalResponse: {
    proposals: [
      {
        kind: "related",
        title: "View dashboard on desktop",
        description:
          "Sharing a dashboard reuses the existing desktop viewing workflow.",
        scenarioTitle: "View dashboard",
      },
      {
        kind: "new",
        title: "Share dashboard with a teammate",
        description: "A user shares a dashboard and a teammate can open it.",
        scenarioTitle: "Share dashboard",
      },
    ],
  },
  parseResult: parseUseCaseProposals,
};

export async function runUseCaseAnalysis(
  pool: Pool,
  requirement: string,
  confirmedScenarios: ScenarioAsset[],
): Promise<UseCaseAnalysisResult> {
  const { result, ...agentResult } = await runAnalysisSubagent(
    useCaseAnalysisSubagent,
    { pool, requirement, confirmedScenarios },
  );

  return {
    ...agentResult,
    proposals: result,
  };
}

function parseUseCaseProposals(text: string): UseCaseProposalInput[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Use Case subagent did not return valid JSON: ${text}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { proposals?: unknown }).proposals)
  ) {
    throw new Error(
      "Use Case subagent response must contain a proposals array",
    );
  }

  const proposals = (parsed as { proposals: unknown[] }).proposals;

  return proposals.map((proposal) => {
    const kind = (proposal as { kind?: unknown }).kind;

    if (
      typeof proposal !== "object" ||
      proposal === null ||
      typeof (proposal as { title?: unknown }).title !== "string" ||
      typeof (proposal as { description?: unknown }).description !== "string" ||
      typeof (proposal as { scenarioTitle?: unknown }).scenarioTitle !==
        "string" ||
      (kind !== "related" && kind !== "new")
    ) {
      throw new Error("Use case proposal has an invalid shape");
    }

    return {
      kind,
      title: (proposal as { title: string }).title,
      description: (proposal as { description: string }).description,
      scenarioTitle: (proposal as { scenarioTitle: string }).scenarioTitle,
    };
  });
}
