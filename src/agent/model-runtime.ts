import {
  ModelRuntime,
  resolveCliModel,
} from "@earendil-works/pi-coding-agent";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { Api, Model } from "@earendil-works/pi-ai";

export type AnalysisModelMode = "faux" | "real";

export interface AnalysisModelDescriptor {
  mode: AnalysisModelMode;
  reference: string;
}

export interface AnalysisModelRuntime {
  descriptor: AnalysisModelDescriptor;
  model: Model<Api>;
  modelRuntime: ModelRuntime;
  faux?: ReturnType<typeof registerFauxProvider>;
}

export function analysisModelDescriptor(): AnalysisModelDescriptor {
  const reference = process.env.BAIZE_MODEL?.trim();

  return reference
    ? { mode: "real", reference }
    : { mode: "faux", reference: "faux" };
}

export async function createAnalysisModelRuntime(): Promise<AnalysisModelRuntime> {
  const descriptor = analysisModelDescriptor();

  if (descriptor.mode === "faux") {
    const faux = registerFauxProvider({ tokensPerSecond: 100 });
    const fauxModel = faux.models[0];

    if (!fauxModel) {
      faux.unregister();
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

    return {
      descriptor,
      model: fauxModel,
      modelRuntime,
      faux,
    };
  }

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

  return { descriptor, model, modelRuntime };
}
