import type { Pool } from "pg";
import { listScenarioNodes, type ScenarioProposalInput } from "../db.ts";
import {
  runFauxAnalysisAgent,
  type AnalysisAgentResult,
} from "./analysis-agent.ts";

export async function runScenarioAnalysis(
  pool: Pool,
  requirement: string,
): Promise<AnalysisAgentResult<ScenarioProposalInput>> {
  return runFauxAnalysisAgent({
    skillName: "scenario-analysis",
    systemPrompt:
      "You are the BaiZe Scenario Analysis subagent. Use the scenario-analysis skill, query the scenario tree, and return only JSON with proposals.",
    queryToolName: "query_scenario_tree",
    queryToolLabel: "Query scenario tree",
    queryToolDescription: "Query the full scenario tree from PostgreSQL.",
    queryData: () => listScenarioNodes(pool),
    prompt: requirement,
    finalResponse: {
      proposals: [
        {
          kind: "related",
          title: "View dashboard",
          description:
            "Dashboard sharing extends the existing dashboard viewing scenario.",
        },
        {
          kind: "new",
          title: "Share dashboard",
          description: "A user shares a dashboard with another user.",
        },
      ],
    },
    parseProposals: parseScenarioProposals,
  });
}

function parseScenarioProposals(text: string): ScenarioProposalInput[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Scenario subagent did not return valid JSON: ${text}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { proposals?: unknown }).proposals)
  ) {
    throw new Error("Scenario subagent response must contain a proposals array");
  }

  const proposals = (parsed as { proposals: unknown[] }).proposals;

  return proposals.map((proposal) => {
    const kind = (proposal as { kind?: unknown }).kind;

    if (
      typeof proposal !== "object" ||
      proposal === null ||
      typeof (proposal as { title?: unknown }).title !== "string" ||
      typeof (proposal as { description?: unknown }).description !== "string" ||
      (kind !== "related" && kind !== "new")
    ) {
      throw new Error("Scenario proposal has an invalid shape");
    }

    return {
      kind,
      title: (proposal as { title: string }).title,
      description: (proposal as { description: string }).description,
    };
  });
}
