import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  defineTool,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import type { Pool } from "pg";
import { listScenarioNodes, type ScenarioProposalInput } from "../db.ts";
import { createFauxRuntime } from "./faux-runtime.ts";

export interface ScenarioToolCall {
  name: string;
  args: unknown;
}

export interface ScenarioToolResult {
  name: string;
  result: unknown;
  isError: boolean;
}

export interface ScenarioAnalysisResult {
  proposals: ScenarioProposalInput[];
  toolCalls: ScenarioToolCall[];
  toolResults: ScenarioToolResult[];
  text: string;
  callCount: number;
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

function extractAssistantText(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (
      typeof message !== "object" ||
      message === null ||
      (message as { role?: unknown }).role !== "assistant"
    ) {
      continue;
    }

    const content = (message as { content?: unknown }).content;

    if (!Array.isArray(content)) {
      continue;
    }

    const text = content
      .filter(
        (block): block is { type: "text"; text: string } =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string",
      )
      .map((block) => block.text)
      .join("");

    if (text.length > 0) {
      return text;
    }
  }

  return "";
}

export async function runScenarioAnalysis(
  pool: Pool,
  requirement: string,
): Promise<ScenarioAnalysisResult> {
  const { faux, modelRuntime } = await createFauxRuntime();

  try {
    const skillPath = path.join(
      process.cwd(),
      ".pi",
      "skills",
      "scenario-analysis",
      "SKILL.md",
    );

    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("read", { path: skillPath })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall("query_scenario_tree", {})],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        JSON.stringify({
          proposals: [
            {
              kind: "related",
              title: "View dashboard",
              description: "Dashboard sharing extends the existing dashboard viewing scenario.",
            },
            {
              kind: "new",
              title: "Share dashboard",
              description: "A user shares a dashboard with another user.",
            },
          ],
        }),
      ),
    ]);

    const queryScenarioTreeTool = defineTool({
      name: "query_scenario_tree",
      label: "Query scenario tree",
      description: "Query the full scenario tree from PostgreSQL.",
      promptSnippet: "Query the full scenario tree from PostgreSQL.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
        const nodes = await listScenarioNodes(pool);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(nodes),
            },
          ],
          details: {
            count: nodes.length,
          },
        };
      },
    });

    const agentDir = getAgentDir();
    await mkdir(agentDir, { recursive: true });

    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir,
      additionalSkillPaths: [
        path.join(process.cwd(), ".pi", "skills", "scenario-analysis"),
      ],
      systemPromptOverride: () =>
        "You are the BaiZe Scenario Analysis subagent. Use the scenario-analysis skill, query the scenario tree, and return only JSON with proposals.",
      appendSystemPromptOverride: () => [],
      noContextFiles: true,
      noSkills: true,
    });

    await loader.reload();

    const { session } = await createAgentSession({
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      model: faux.getModel(),
      modelRuntime,
      customTools: [queryScenarioTreeTool],
      tools: ["read", "query_scenario_tree"],
    });

    try {
      let text = "";
      const toolCalls: ScenarioToolCall[] = [];
      const toolResults: ScenarioToolResult[] = [];

      session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          text += event.assistantMessageEvent.delta;
        }

        if (event.type === "tool_execution_start") {
          toolCalls.push({
            name: event.toolName,
            args: event.args,
          });
        }

        if (event.type === "tool_execution_end") {
          toolResults.push({
            name: event.toolName,
            result: event.result,
            isError: event.isError,
          });
        }
      });

      await session.prompt(requirement);

      const finalText = extractAssistantText(session.state.messages) || text;

      return {
        proposals: parseScenarioProposals(finalText),
        toolCalls,
        toolResults,
        text: finalText,
        callCount: faux.state.callCount,
      };
    } finally {
      session.dispose();
    }
  } finally {
    faux.unregister();
  }
}
