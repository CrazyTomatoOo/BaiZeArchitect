import type { Pool } from "pg";
import {
  listUseCaseNodes,
  type ScenarioAsset,
  type UseCaseProposalInput,
} from "../db.ts";
import {
  runFauxAnalysisAgent,
  type AnalysisAgentResult,
} from "./analysis-agent.ts";

export async function runUseCaseAnalysis(
  pool: Pool,
  requirement: string,
  confirmedScenarios: ScenarioAsset[],
): Promise<AnalysisAgentResult<UseCaseProposalInput>> {
  return runFauxAnalysisAgent({
    skillName: "use-case-analysis",
    systemPrompt:
      "You are the BaiZe Use Case Analysis subagent. Use the use-case-analysis skill, query the use-case library, and return only JSON with proposals.",
    queryToolName: "query_use_case_library",
    queryToolLabel: "Query use case library",
    queryToolDescription: "Query the full use-case library from PostgreSQL.",
    queryData: () => listUseCaseNodes(pool),
    prompt: JSON.stringify({
      requirement,
      confirmedScenarios: confirmedScenarios.map((scenario) => ({
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
    parseProposals: parseUseCaseProposals,
  });
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
