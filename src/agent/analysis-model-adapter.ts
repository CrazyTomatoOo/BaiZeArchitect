import { mkdir } from "node:fs/promises";
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  createAgentSession,
  getAgentDir,
  resolveCliModel,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import {
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import type { Api, Model } from "@earendil-works/pi-ai";

export type AnalysisModelMode = "faux" | "real";

export interface AnalysisModelDescriptor {
  mode: AnalysisModelMode;
  reference: string;
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

export interface AnalysisModelPromptResult {
  text: string;
  toolCalls: AnalysisToolCall[];
  toolResults: AnalysisToolResult[];
  callCount: number;
}

export interface AnalysisModelSession {
  prompt(prompt: string): Promise<AnalysisModelPromptResult>;
  dispose(): void;
}

export interface AnalysisModelSessionOptions {
  systemPrompt: string;
  skillDirectory: string;
  customTools: ToolDefinition[];
  tools: string[];
}

export interface AnalysisModelScript {
  readPath: string;
  queryToolName: string;
  finalResponse: unknown;
}

export interface AnalysisModelAdapter {
  prepare(script: AnalysisModelScript): void;
  createSession(
    options: AnalysisModelSessionOptions,
  ): Promise<AnalysisModelSession>;
  dispose(): void;
}

export function analysisModelDescriptor(): AnalysisModelDescriptor {
  const reference = process.env.BAIZE_MODEL?.trim();

  return reference
    ? { mode: "real", reference }
    : { mode: "faux", reference: "faux" };
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

async function createAnalysisModelSession(
  options: AnalysisModelSessionOptions,
  model: Model<Api>,
  modelRuntime: ModelRuntime,
  callCountOverride?: () => number,
): Promise<AnalysisModelSession> {
  const agentDir = getAgentDir();
  await mkdir(agentDir, { recursive: true });

  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir,
    additionalSkillPaths: [options.skillDirectory],
    systemPromptOverride: () => options.systemPrompt,
    appendSystemPromptOverride: () => [],
    noContextFiles: true,
    noSkills: true,
  });
  await loader.reload();

  const { session } = await createAgentSession({
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
    model,
    modelRuntime,
    customTools: options.customTools,
    tools: options.tools,
  });

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

  return {
    async prompt(prompt: string) {
      await session.prompt(prompt);

      return {
        text: extractAssistantText(session.state.messages) || text,
        toolCalls,
        toolResults,
        callCount: callCountOverride
          ? callCountOverride()
          : modelCallCount,
      };
    },
    dispose() {
      session.dispose();
    },
  };
}

async function createFauxAnalysisModelAdapter(): Promise<AnalysisModelAdapter> {
  const faux = registerFauxProvider({ tokensPerSecond: 100 });
  const fauxModel = faux.models[0];

  if (!fauxModel) {
    faux.unregister();
    throw new Error("Faux provider did not register a model");
  }

  let modelRuntime: ModelRuntime;
  try {
    modelRuntime = await ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
    });

    modelRuntime.registerProvider(fauxModel.provider, {
      baseUrl: fauxModel.baseUrl,
      apiKey: "faux-key",
      api: faux.api,
      models: faux.models.map((model) => ({
        id: model.id,
        name: model.name,
        api: model.api,
        reasoning: model.reasoning,
        input: model.input,
        cost: model.cost,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        baseUrl: model.baseUrl,
      })),
    });
  } catch (error) {
    faux.unregister();
    throw error;
  }

  return {
    prepare(script: AnalysisModelScript) {
      const finalModelOutput =
        process.env.BAIZE_FAUX_MODEL_OUTPUT ??
        JSON.stringify(script.finalResponse);

      faux.setResponses([
        fauxAssistantMessage(
          [fauxToolCall("read", { path: script.readPath })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(
          [fauxToolCall(script.queryToolName, {})],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(finalModelOutput),
      ]);
    },
    createSession(options) {
      return createAnalysisModelSession(
        options,
        fauxModel,
        modelRuntime,
        () => faux.state.callCount,
      );
    },
    dispose() {
      faux.unregister();
    },
  };
}

async function createRealAnalysisModelAdapter(): Promise<AnalysisModelAdapter> {
  const descriptor = analysisModelDescriptor();
  const modelRuntime = await ModelRuntime.create({
    modelsPath: process.env.BAIZE_MODELS_PATH,
    allowModelNetwork: false,
  });
  const resolved = resolveCliModel({
    cliModel: descriptor.reference,
    modelRuntime,
  });
  const model = resolved.model;

  if (resolved.error || !model) {
    throw new Error(
      `BAIZE_MODEL could not be resolved: ${
        resolved.error ?? "model not found"
      }`,
    );
  }

  const availableModels = await modelRuntime.getAvailable(model.provider);
  const isAuthenticated = availableModels.some(
    (availableModel) => availableModel.id === model.id,
  );

  if (!isAuthenticated) {
    throw new Error(
      `BAIZE_MODEL ${descriptor.reference} is not authenticated; configure the provider API key before running real-model tests`,
    );
  }

  return {
    prepare() {
      // Real models produce their own responses.
    },
    createSession(options) {
      return createAnalysisModelSession(options, model, modelRuntime);
    },
    dispose() {
      // Real model runtime owns no per-run provider registration.
    },
  };
}

export async function createAnalysisModelAdapter(): Promise<AnalysisModelAdapter> {
  return analysisModelDescriptor().mode === "faux"
    ? createFauxAnalysisModelAdapter()
    : createRealAnalysisModelAdapter();
}
