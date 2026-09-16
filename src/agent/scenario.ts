import type { ScenarioProposalInput } from "../db.ts";
import { AnalysisFailureError } from "../errors.ts";
import {
  type AnalysisRevision,
  runAnalysisSubagent,
  type AnalysisSubagentDefinition,
  type AnalysisSubagentResult,
} from "./analysis-subagent.ts";
import type { McpToolClient } from "../mcp.ts";

interface ScenarioAnalysisInput {
  mcp: McpToolClient;
  requirement: string;
  revision?: AnalysisRevision<ScenarioProposalInput>;
}

type ScenarioAnalysisResult = Omit<
  AnalysisSubagentResult<ScenarioProposalInput[]>,
  "result"
> & {
  proposals: ScenarioProposalInput[];
};

const scenarioAnalysisSubagent: AnalysisSubagentDefinition<
  ScenarioAnalysisInput,
  ScenarioProposalInput[]
> = {
  skill: {
    name: "scenario-analysis",
    systemPrompt:
      "You are the BaiZe Scenario Analysis subagent. Use the scenario-analysis skill, query the scenario tree, and return only JSON with proposals.",
  },
  queryTool: {
    name: "query_scenario_tree",
    label: "Query scenario tree",
    description: "Query the full scenario tree from SQLite.",
    data: async (input) => {
      const result = await input.mcp.callTool("query_scenario_tree", {});
      const structured = result.structuredContent as {
        nodes?: unknown[];
      };

      if (!Array.isArray(structured.nodes)) {
        throw new AnalysisFailureError(
          "mcp_failure",
          "MCP query_scenario_tree result is missing nodes",
        );
      }

      if (structured.nodes.length === 0) {
        throw new AnalysisFailureError(
          "missing_data",
          "Scenario data is missing; verify the scenario library and request help before retrying",
        );
      }

      return structured.nodes;
    },
  },
  prompt: (input) =>
    input.revision
      ? JSON.stringify({
          requirement: input.requirement,
          revision: input.revision,
        })
      : input.requirement,
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
  parseResult: parseScenarioProposals,
};

export async function runScenarioAnalysis(
  mcp: McpToolClient,
  requirement: string,
  revision?: AnalysisRevision<ScenarioProposalInput>,
): Promise<ScenarioAnalysisResult> {
  const { result, ...agentResult } = await runAnalysisSubagent(
    scenarioAnalysisSubagent,
    { mcp, requirement, revision },
  );

  return {
    ...agentResult,
    proposals: result,
  };
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
