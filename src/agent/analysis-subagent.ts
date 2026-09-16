import path from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  AnalysisFailureError,
  errorMessage,
  failureCodeForError,
  withTimeout,
} from "../errors.ts";
import {
  createAnalysisModelAdapter,
  type AnalysisModelScript,
  type AnalysisToolCall,
  type AnalysisToolResult,
} from "./analysis-model-adapter.ts";

function toolTimeoutMs(): number {
  const parsed = Number(process.env.BAIZE_TOOL_TIMEOUT_MS);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5_000;
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

export interface AnalysisSubagentSkill {
  name: string;
  systemPrompt: string;
}

export interface AnalysisSubagentQueryTool<TInput> {
  name: string;
  label: string;
  description: string;
  data: (input: TInput) => Promise<unknown[]>;
}

export interface AnalysisSubagentDefinition<TInput, TResult> {
  skill: AnalysisSubagentSkill;
  queryTool: AnalysisSubagentQueryTool<TInput>;
  prompt: (input: TInput) => string;
  finalResponse: unknown;
  parseResult: (text: string) => TResult;
}

export interface AnalysisRevision<TProposal> {
  feedback: string;
  previousProposals: TProposal[];
}

export interface AnalysisSubagentResult<TResult> {
  result: TResult;
  toolCalls: AnalysisToolCall[];
  toolResults: AnalysisToolResult[];
  text: string;
  callCount: number;
}

export async function runAnalysisSubagent<TInput, TResult>(
  definition: AnalysisSubagentDefinition<TInput, TResult>,
  input: TInput,
): Promise<AnalysisSubagentResult<TResult>> {
  const adapter = await createAnalysisModelAdapter();

  try {
    const skillDirectory = path.join(
      process.cwd(),
      ".pi",
      "skills",
      definition.skill.name,
    );
    const script: AnalysisModelScript = {
      readPath: path.join(skillDirectory, "SKILL.md"),
      queryToolName: definition.queryTool.name,
      finalResponse: definition.finalResponse,
    };

    adapter.prepare(script);

    let queryError: AnalysisFailureError | undefined;
    const queryTool = defineTool({
      name: definition.queryTool.name,
      label: definition.queryTool.label,
      description: definition.queryTool.description,
      promptSnippet: definition.queryTool.description,
      parameters: Type.Object({}),
      async execute() {
        try {
          const data = await withTimeout(
            definition.queryTool.data(input),
            toolTimeoutMs(),
            `Analysis tool timed out: ${definition.queryTool.name}`,
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

    const session = await adapter.createSession({
      systemPrompt: definition.skill.systemPrompt,
      skillDirectory,
      customTools: [queryTool],
      tools: ["read", definition.queryTool.name],
    });

    try {
      const output = await session.prompt(definition.prompt(input));

      if (queryError) {
        throw queryError;
      }

      const failedToolResult = output.toolResults.find(
        (result) => result.isError,
      );

      if (failedToolResult) {
        throw new AnalysisFailureError(
          "tool_failure",
          `Analysis tool failed: ${failedToolResult.name}`,
        );
      }

      let result: TResult;

      try {
        result = definition.parseResult(modelJsonText(output.text));
      } catch (error) {
        throw new AnalysisFailureError(
          "invalid_model_output",
          errorMessage(error),
          { cause: error },
        );
      }

      return {
        result,
        toolCalls: output.toolCalls,
        toolResults: output.toolResults,
        text: output.text,
        callCount: output.callCount,
      };
    } finally {
      session.dispose();
    }
  } finally {
    adapter.dispose();
  }
}
