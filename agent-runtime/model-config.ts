/**
 * model-config.ts — Pi model provider setup and configuration management.
 *
 * Production reads provider/model/key from a JSON config file or environment.
 * ScriptedModelDriver is never selectable through this module.
 */
import path from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
	createProvider,
	envApiKeyAuth,
	lazyApi,
	type Api,
	type Model,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const PROJECT_ROOT =
	process.env.BAIZE_PROJECT_ROOT ?? path.resolve(import.meta.dirname, "..");
const PROVIDER = process.env.RUNTIME_MODEL_PROVIDER ?? "bailian";
const MODEL_ID = process.env.RUNTIME_MODEL_ID ?? "glm-5.2";
const BAILIAN_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";

const bailianModels: readonly Model<Api>[] = [
	{
		id: "glm-5.2",
		name: "GLM-5.2",
		api: "openai-completions",
		baseUrl: BAILIAN_BASE,
		provider: "bailian",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1048576,
		maxTokens: 16384,
		thinkingLevelMap: {
			low: "high",
			medium: "high",
			high: "high",
			xhigh: "max",
			max: "max",
		},
		compat: { supportsDeveloperRole: false, supportsReasoningEffort: true },
	},
	{
		id: "qwen-max",
		name: "Qwen-Max",
		api: "openai-completions",
		baseUrl: BAILIAN_BASE,
		provider: "bailian",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
		compat: { supportsDeveloperRole: false },
	},
];

export const modelRuntime = await ModelRuntime.create();

function registerProvider(provider: string): void {
	const providerConfig = createProvider({
		id: provider,
		name: provider,
		baseUrl: BAILIAN_BASE,
		auth: { apiKey: envApiKeyAuth("API key", ["DASHSCOPE_API_KEY"]) },
		models: bailianModels,
		api: lazyApi(() =>
			import(
				"./node_modules/@earendil-works/pi-ai/dist/api/openai-completions.lazy.js"
			).then((m) => m.openAICompletionsApi()),
		),
	});
	(
		modelRuntime as { registerNativeProvider(p: unknown): void }
	).registerNativeProvider(providerConfig);
}

registerProvider("bailian");

export interface ModelConfig {
	provider?: string;
	modelId?: string;
	apiKey?: string;
}

export function applyModelConfig(config: ModelConfig): void {
	if (config.provider) activeProvider = config.provider;
	if (config.modelId) activeModelId = config.modelId;
	if (config.apiKey) process.env.DASHSCOPE_API_KEY = config.apiKey;
	registerProvider(activeProvider);
}

const MODEL_CONFIG_PATH =
	process.env.BAIZE_MODEL_CONFIG_PATH ??
	path.join(PROJECT_ROOT, ".baize", "model-config.json");

function readModelConfig(): ModelConfig | null {
	try {
		return JSON.parse(readFileSync(MODEL_CONFIG_PATH, "utf8")) as ModelConfig;
	} catch {
		return null;
	}
}

export function writeModelConfig(config: ModelConfig): void {
	mkdirSync(path.dirname(MODEL_CONFIG_PATH), { recursive: true });
	writeFileSync(MODEL_CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function currentModelConfig(): ModelConfig {
	return {
		provider: activeProvider,
		modelId: activeModelId,
		apiKey: process.env.DASHSCOPE_API_KEY ?? "",
	};
}

let activeProvider = PROVIDER;
let activeModelId = MODEL_ID;

const savedModelConfig = readModelConfig();
if (savedModelConfig) applyModelConfig(savedModelConfig);
