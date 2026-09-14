import type { Pool } from "pg";
import {
  listFeatureNodes,
  type FeatureProposalInput,
  type UseCaseAsset,
} from "../db.ts";
import {
  runFauxAnalysisAgent,
  type AnalysisAgentResult,
} from "./analysis-agent.ts";

export async function runFeatureAnalysis(
  pool: Pool,
  requirement: string,
  confirmedUseCases: UseCaseAsset[],
): Promise<AnalysisAgentResult<FeatureProposalInput>> {
  return runFauxAnalysisAgent({
    skillName: "feature-analysis",
    systemPrompt:
      "You are the BaiZe Feature Analysis subagent. Use the feature-analysis skill, query the feature library, and return only JSON with proposals.",
    queryToolName: "query_feature_library",
    queryToolLabel: "Query feature library",
    queryToolDescription: "Query the full feature library from PostgreSQL.",
    queryData: () => listFeatureNodes(pool),
    prompt: JSON.stringify({
      requirement,
      confirmedUseCases: confirmedUseCases.map((useCase) => ({
        title: useCase.title,
        description: useCase.description,
      })),
    }),
    finalResponse: {
      proposals: [
        {
          kind: "affected",
          title: "Dashboard access control",
          description:
            "Sharing a dashboard must respect and extend existing dashboard access rules.",
          useCaseTitle: "Share dashboard with a teammate",
        },
        {
          kind: "new",
          title: "Dashboard sharing permissions",
          description:
            "A user grants and revokes another user's access to a dashboard.",
          useCaseTitle: "Share dashboard with a teammate",
        },
      ],
    },
    parseProposals: parseFeatureProposals,
  });
}

function parseFeatureProposals(text: string): FeatureProposalInput[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Feature subagent did not return valid JSON: ${text}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { proposals?: unknown }).proposals)
  ) {
    throw new Error(
      "Feature subagent response must contain a proposals array",
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
      typeof (proposal as { useCaseTitle?: unknown }).useCaseTitle !==
        "string" ||
      (kind !== "affected" && kind !== "new")
    ) {
      throw new Error("Feature proposal has an invalid shape");
    }

    return {
      kind,
      title: (proposal as { title: string }).title,
      description: (proposal as { description: string }).description,
      useCaseTitle: (proposal as { useCaseTitle: string }).useCaseTitle,
    };
  });
}
