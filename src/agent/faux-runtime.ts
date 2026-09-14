import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";

export interface FauxRuntime {
  faux: ReturnType<typeof registerFauxProvider>;
  modelRuntime: ModelRuntime;
}

export async function createFauxRuntime(): Promise<FauxRuntime> {
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

  return { faux, modelRuntime };
}
