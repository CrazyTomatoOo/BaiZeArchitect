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
import {
  AnalysisFailureError,
  errorMessage,
  failureCodeForError,
  withTimeout,
} from "../errors.ts";
import { createAnalysisModelRuntime } from "./model-runtime.ts";

function toolTimeoutMs(): number {
  const parsed = Number(process.env.BAIZE_TOOL_TIMEOUT_MS);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5_000;
}

export interface AnalysisToolCall {
  name: string;
  args: unknown;
}

export interface AnalysisToolResult {
  name: string;
  result: unknown;
  isError: boolean;
}

export interface ModelAgentResult<TResult> {
  result: TResult;
  toolCalls: AnalysisToolCall[];
  toolResults: AnalysisToolResult[];
  text: string;
  callCount: number;
}

export interface ModelAgentConfig<TResult> {
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
  extends Omit<ModelAgentResult<TProposal[]>, "result"> {
  proposals: TProposal[];
}

export interface AnalysisAgentConfig<TProposal>
  extends Omit<ModelAgentConfig<TProposal[]>, "parseResult"> {
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

function modelJsonText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  return start >= 0 && end > start ? text.slice(start, end + 1) : text.trim();
}

export async function runModelAgent<TResult>(
  config: ModelAgentConfig<TResult>,
): Promise<ModelAgentResult<TResult>> {
  const runtime = await createAnalysisModelRuntime();

  try {
    const skillDirectory = path.join(
      process.cwd(),
      ".pi",
      "skills",
      config.skillName,
    );
    const skillPath = path.join(skillDirectory, "SKILL.md");

    if (runtime.faux) {
      const finalModelOutput =
        process.env.BAIZE_FAUX_MODEL_OUTPUT ??
        JSON.stringify(config.finalResponse);

      runtime.faux.setResponses([
        fauxAssistantMessage(
          [fauxToolCall("read", { path: skillPath })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(
          [fauxToolCall(config.queryToolName, {})],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(finalModelOutput),
      ]);
    }

    let queryError: AnalysisFailureError | undefined;
    const queryTool = defineTool({
      name: config.queryToolName,
      label: config.queryToolLabel,
      description: config.queryToolDescription,
      promptSnippet: config.queryToolDescription,
      parameters: Type.Object({}),
      async execute() {
        try {
          const data = await withTimeout(
            config.queryData(),
            toolTimeoutMs(),
            `Analysis tool timed out: ${config.queryToolName}`,
            "tool_timeout",
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(data),
              },
            ],
            details: {
              count: data.length,
              error: "",
            },
          };
        } catch (error) {
          queryError = error instanceof AnalysisFailureError
            ? error
            : new AnalysisFailureError(
              failureCodeForError(error) === "database_error"
                ? "database_error"
                : "tool_failure",
              errorMessage(error),
              { cause: error },
            );

          return {
            content: [
              {
                type: "text" as const,
                text: errorMessage(queryError),
              },
            ],
            details: {
              count: 0,
              error: errorMessage(queryError),
            },
          };
        }
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
      model: runtime.model,
      modelRuntime: runtime.modelRuntime,
      customTools: [queryTool],
      tools: ["read", config.queryToolName],
    });

    try {
      let text = "";
      let modelCallCount = 0;
      const toolCalls: AnalysisToolCall[] = [];
      const toolResults: AnalysisToolResult[] = [];

      session.subscribe((event) => {
        if (
          event.type === "message_start" &&
          event.message.role === "assistant"
        ) {
          modelCallCount += 1;
        }

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

      if (queryError) {
        throw queryError;
      }

      const finalText = extractAssistantText(session.state.messages) || text;
      const failedToolResult = toolResults.find((result) => result.isError);

      if (failedToolResult) {
        throw new AnalysisFailureError(
          "tool_failure",
          `Analysis tool failed: ${failedToolResult.name}`,
        );
      }

      let result: TResult;

      try {
        result = config.parseResult(modelJsonText(finalText));
      } catch (error) {
        throw new AnalysisFailureError(
          "invalid_model_output",
          errorMessage(error),
          { cause: error },
        );
      }

      return {
        result,
        toolCalls,
        toolResults,
        text: finalText,
        callCount: runtime.faux
          ? runtime.faux.state.callCount
          : modelCallCount,
      };
    } finally {
      session.dispose();
    }
  } finally {
    runtime.faux?.unregister();
  }
}

export async function runAnalysisAgent<TProposal>(
  config: AnalysisAgentConfig<TProposal>,
): Promise<AnalysisAgentResult<TProposal>> {
  const { parseProposals, ...agentConfig } = config;
  const { result, ...agentResult } = await runModelAgent({
    ...agentConfig,
    parseResult: parseProposals,
  });

  return {
    ...agentResult,
    proposals: result,
  };
}
