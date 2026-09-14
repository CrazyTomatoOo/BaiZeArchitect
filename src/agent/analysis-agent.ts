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
import { createFauxRuntime } from "./faux-runtime.ts";

export interface AnalysisToolCall {
  name: string;
  args: unknown;
}

export interface AnalysisToolResult {
  name: string;
  result: unknown;
  isError: boolean;
}

export interface FauxAgentResult<TResult> {
  result: TResult;
  toolCalls: AnalysisToolCall[];
  toolResults: AnalysisToolResult[];
  text: string;
  callCount: number;
}

export interface FauxAgentConfig<TResult> {
  skillName: string;
  systemPrompt: string;
  queryToolName: string;
  queryToolLabel: string;
  queryToolDescription: string;
  queryData: () => Promise<unknown[]>;
  prompt: string;
  finalResponse: unknown;
  parseResult: (text: string) => TResult;
}

export interface AnalysisAgentResult<TProposal>
  extends Omit<FauxAgentResult<TProposal[]>, "result"> {
  proposals: TProposal[];
}

export interface AnalysisAgentConfig<TProposal>
  extends Omit<FauxAgentConfig<TProposal[]>, "parseResult"> {
  parseProposals: (text: string) => TProposal[];
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

export async function runFauxAgent<TResult>(
  config: FauxAgentConfig<TResult>,
): Promise<FauxAgentResult<TResult>> {
  const { faux, modelRuntime } = await createFauxRuntime();

  try {
    const skillDirectory = path.join(
      process.cwd(),
      ".pi",
      "skills",
      config.skillName,
    );
    const skillPath = path.join(skillDirectory, "SKILL.md");

    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("read", { path: skillPath })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall(config.queryToolName, {})],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(JSON.stringify(config.finalResponse)),
    ]);

    const queryTool = defineTool({
      name: config.queryToolName,
      label: config.queryToolLabel,
      description: config.queryToolDescription,
      promptSnippet: config.queryToolDescription,
      parameters: Type.Object({}),
      async execute() {
        const data = await config.queryData();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data),
            },
          ],
          details: {
            count: data.length,
          },
        };
      },
    });

    const agentDir = getAgentDir();
    await mkdir(agentDir, { recursive: true });

    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir,
      additionalSkillPaths: [skillDirectory],
      systemPromptOverride: () => config.systemPrompt,
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
      customTools: [queryTool],
      tools: ["read", config.queryToolName],
    });

    try {
      let text = "";
      const toolCalls: AnalysisToolCall[] = [];
      const toolResults: AnalysisToolResult[] = [];

      session.subscribe((event) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
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

      await session.prompt(config.prompt);

      const finalText = extractAssistantText(session.state.messages) || text;
      const failedToolResult = toolResults.find((result) => result.isError);

      if (failedToolResult) {
        throw new Error(`Analysis tool failed: ${failedToolResult.name}`);
      }

      return {
        result: config.parseResult(finalText),
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

export async function runFauxAnalysisAgent<TProposal>(
  config: AnalysisAgentConfig<TProposal>,
): Promise<AnalysisAgentResult<TProposal>> {
  const { parseProposals, ...agentConfig } = config;
  const { result, ...agentResult } = await runFauxAgent({
    ...agentConfig,
    parseResult: parseProposals,
  });

  return {
    ...agentResult,
    proposals: result,
  };
}
