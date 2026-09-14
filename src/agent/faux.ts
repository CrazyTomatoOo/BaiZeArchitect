import { mkdir } from "node:fs/promises";
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  createAgentSession,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  registerFauxProvider,
} from "@earendil-works/pi-ai/compat";

export interface FauxAgentResult {
  text: string;
  callCount: number;
}

export async function runFauxAgent(prompt: string): Promise<FauxAgentResult> {
  const faux = registerFauxProvider({ tokensPerSecond: 100 });

  try {
    const fauxModel = faux.models[0];

    if (!fauxModel) {
      throw new Error("Faux provider did not register a model");
    }

    const modelRuntime = await ModelRuntime.create({
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

    faux.setResponses([fauxAssistantMessage("Bootstrap analysis complete.")]);

    const agentDir = getAgentDir();
    await mkdir(agentDir, { recursive: true });

    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir,
      systemPromptOverride: () =>
        "You are the BaiZe bootstrap analysis agent. Respond deterministically.",
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
      noTools: "all",
    });

    try {
      let text = "";

      session.subscribe((event) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
          text += event.assistantMessageEvent.delta;
        }
      });

      await session.prompt(prompt);

      return {
        text: text || "Bootstrap analysis complete.",
        callCount: faux.state.callCount,
      };
    } finally {
      session.dispose();
    }
  } finally {
    faux.unregister();
  }
}
