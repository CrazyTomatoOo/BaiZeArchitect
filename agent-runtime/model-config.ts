/**
 * model-config.ts — Pi model provider setup and configuration management.
 *
 * Production boots with a builtin 双件套 default (qwen-token-plan-cn/glm-5.2)
 * unless overridden by a model-config/v1 file at BAIZE_MODEL_CONFIG_PATH.
 *
 * ScriptedModelDriver is never selectable through this module.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import {
	createProvider,
	envApiKeyAuth,
	lazyApi,
	type Api,
	type Model,
	type Provider,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { loadWorkflowContracts } from "./workflow/contracts/loader.js";
import { compileWorkflowSchema } from "./workflow/contracts/schema.js";
import type {
	ModelRef,
	ModelRoles,
	ModelRolesOverride,
	WorkflowAgentRole,
} from "./workflow/model-driver.js";

const PROJECT_ROOT =
	process.env.BAIZE_PROJECT_ROOT ?? path.resolve(import.meta.dirname, "..");
const QWEN_TOKEN_PLAN_CN_BASE =
	"https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";

const WORKFLOW_AGENT_ROLES: readonly WorkflowAgentRole[] = [
	"analysis-analyst",
	"scenario-analyst",
	"usecase-analyst",
	"function-analyst",
	"design-architect",
	"architecture-architect",
	"data-architect",
	"api-architect",
	"critic",
	"orchestrator",
];

/** pi-ai 惰性 API 库: api id -> dist/api 模块与工厂导出。配置声明的模型 api 必须是其一（boot 校验）。 */
const API_LIBRARIES: Readonly<Record<string, { file: string; factory: string }>> = {
	"openai-completions": { file: "openai-completions", factory: "openAICompletionsApi" },
	"openai-responses": { file: "openai-responses", factory: "openAIResponsesApi" },
	"anthropic-messages": { file: "anthropic-messages", factory: "anthropicMessagesApi" },
	"google-generative-ai": { file: "google-generative-ai", factory: "googleGenerativeAIApi" },
	"google-vertex": { file: "google-vertex", factory: "googleVertexApi" },
	"mistral-conversations": { file: "mistral-conversations", factory: "mistralConversationsApi" },
	"bedrock-converse-stream": { file: "bedrock-converse-stream", factory: "bedrockConverseStreamApi" },
	"openai-codex-responses": { file: "openai-codex-responses", factory: "openAICodexResponsesApi" },
	"pi-messages": { file: "pi-messages", factory: "piMessagesApi" },
	"azure-openai-responses": { file: "azure-openai-responses", factory: "azureOpenAIResponsesApi" },
};

function apiModuleFor(api: string): { file: string; factory: string } | undefined {
	return API_LIBRARIES[api];
}

type ApiKeyAuthLike = ReturnType<typeof envApiKeyAuth>;

const qwenTokenPlanCnModels = [
	{
		id: "glm-5.2",
		name: "GLM-5.2",
		api: "openai-completions",
		baseUrl: QWEN_TOKEN_PLAN_CN_BASE,
		provider: "qwen-token-plan-cn",
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
		baseUrl: QWEN_TOKEN_PLAN_CN_BASE,
		provider: "qwen-token-plan-cn",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
		compat: { supportsDeveloperRole: false },
	},
] as unknown as readonly Model<Api>[];

/** 部署默认档：全部角色默认同一模型（#15 决议：默认同模型，按需覆盖）。 */
const builtinDefaultRoles: ModelRoles = {
	"analysis-analyst": { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
	"scenario-analyst": { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
	"usecase-analyst": { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
	"function-analyst": { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
	"design-architect": { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
	"architecture-architect": { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
	"data-architect": { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
	"api-architect": { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
	critic: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
	orchestrator: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
};

const MODEL_CONFIG_PATH =
	process.env.BAIZE_MODEL_CONFIG_PATH ??
	path.join(PROJECT_ROOT, ".baize", "model-config.json");

export const modelRuntime = await ModelRuntime.create();

export interface ModelConfigV1 {
	schemaVersion: "model-config/v1";
	providers: readonly ProviderConfigEntry[];
	defaultRoles: ModelRoles;
}

export interface ProviderConfigEntry {
	id: string;
	baseUrl?: string;
	authEnv?: readonly string[];
	models: readonly ModelConfigEntry[];
}

export interface ModelConfigEntry {
	id: string;
	name: string;
	api: string;
	baseUrl?: string;
	provider: string;
	reasoning?: boolean;
	input: readonly string[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	thinkingLevelMap?: Record<string, string | null>;
	compat?: Record<string, unknown>;
}

export interface EffectiveProvider {
	id: string;
	name: string;
	models: EffectiveModel[];
}

export interface EffectiveModel {
	id: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
}

const DEFAULT_MODEL_CONFIG: ModelConfigV1 = {
	schemaVersion: "model-config/v1",
	providers: [
		{
			id: "qwen-token-plan-cn",
			baseUrl: QWEN_TOKEN_PLAN_CN_BASE,
			authEnv: ["QWEN_TOKEN_PLAN_CN_API_KEY"],
			models: qwenTokenPlanCnModels as unknown as ModelConfigEntry[],
		},
	],
	defaultRoles: builtinDefaultRoles,
};

let activeConfig: ModelConfigV1 = {
	schemaVersion: "model-config/v1",
	providers: [],
	defaultRoles: builtinDefaultRoles,
};

applyModelConfig(DEFAULT_MODEL_CONFIG);

function readOptionalString(value: object, key: string): string | undefined {
	if (!(key in value)) return undefined;
	const record = value as Record<string, unknown>;
	const candidate = record[key];
	return typeof candidate === "string" ? candidate : undefined;
}

function isLegacyModelConfig(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	return (
		"apiKey" in value ||
		readOptionalString(value, "provider") !== undefined ||
		readOptionalString(value, "modelId") !== undefined
	);
}

function readModelConfig(): ModelConfigV1 | null {
	let raw: string;
	try {
		raw = readFileSync(MODEL_CONFIG_PATH, "utf8");
	} catch {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(
			`Failed to parse model config at ${MODEL_CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (isLegacyModelConfig(parsed)) {
		throw new Error(
			`Legacy model config rejected at ${MODEL_CONFIG_PATH}: the {provider,modelId,apiKey} format is retired. ` +
				`Use model-config/v1 schema with providers + defaultRoles, and set the provider API key via its authEnv ` +
				`(e.g. QWEN_TOKEN_PLAN_CN_API_KEY) instead of apiKey in the file.`,
		);
	}
	return parsed as ModelConfigV1;
}

export interface ValidationProblem {
	role: string;
	provider: string;
	modelId: string;
	reason:
		| "provider_not_registered"
		| "model_not_in_catalog"
		| "role_missing"
		| "malformed_role_entry";
}

/** 原生 provider 探测: 已注册 provider 的端点与认证绑定, 供配置缺省回落(原生语义保留)。 */
function nativeProviderProbe(
	id: string,
): { id: string; baseUrl?: string; auth?: { apiKey: ApiKeyAuthLike } } | undefined {
	return (modelRuntime as unknown as {
		getProviders(): readonly { id: string; baseUrl?: string; auth?: { apiKey: ApiKeyAuthLike } }[];
	})
		.getProviders()
		.find((provider) => provider.id === id);
}

function buildProviderConfig(entry: ProviderConfigEntry): Provider<Api> {
	const native = nativeProviderProbe(entry.id);
	const baseUrl = entry.baseUrl ?? native?.baseUrl;
	if (!baseUrl) {
		throw new Error(
			`model-config: provider "${entry.id}" is not a pi-ai native provider and has no baseUrl; set baseUrl explicitly.`,
		);
	}
	const api = entry.models.find((model) => model.api !== undefined)?.api;
	const library = api === undefined ? undefined : apiModuleFor(api);
	if (!library) {
		throw new Error(
			`model-config: provider "${entry.id}" declares unsupported api ${api === undefined ? "(missing)" : `"${api}"`}; supported: ${Object.keys(API_LIBRARIES).join(", ")}`,
		);
	}
	const auth = entry.authEnv?.length
		? { apiKey: envApiKeyAuth("API key", [...entry.authEnv]) }
		: native?.auth;
	if (!auth) {
		throw new Error(
			`model-config: provider "${entry.id}" is not a pi-ai native provider and has no authEnv; set authEnv explicitly.`,
		);
	}
	const models: Model<Api>[] = entry.models.map((model) => ({
		id: model.id,
		name: model.name,
		api: model.api,
		baseUrl: model.baseUrl ?? baseUrl,
		provider: model.provider,
		reasoning: model.reasoning ?? false,
		input: [...model.input] as Model<Api>["input"],
		cost: { ...model.cost },
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		...(model.thinkingLevelMap !== undefined
			? { thinkingLevelMap: { ...model.thinkingLevelMap } }
			: {}),
		...(model.compat !== undefined ? { compat: { ...model.compat } } : {}),
	}));
	return createProvider({
		id: entry.id,
		name: entry.id,
		baseUrl,
		auth,
		models,
		api: lazyApi(() => {
			const specifier =
				"./node_modules/@earendil-works/pi-ai/dist/api/" + library.file + ".lazy.js";
			return import(specifier).then(
				(m) => (m as Record<string, () => unknown>)[library.factory]() as never,
			);
		}),
	});
}

function validateProviderEntries(providers: readonly ProviderConfigEntry[]): void {
	const problems: string[] = [];
	for (const provider of providers) {
		if (provider.models.length === 0) {
			problems.push(`${provider.id}: models must not be empty`);
			continue;
		}
		const seen = new Set<string>();
		const apis = new Set<string>();
		for (const model of provider.models) {
			if (seen.has(model.id)) {
				problems.push(`${provider.id}: duplicate model id "${model.id}"`);
			}
			seen.add(model.id);
			apis.add(model.api);
			if (!apiModuleFor(model.api)) {
				problems.push(`${provider.id}/${model.id}: unsupported api "${model.api}"`);
			}
		}
		if (apis.size > 1) {
			problems.push(`${provider.id}: all models must share one api, got ${[...apis].join(", ")}`);
		}
		const native = nativeProviderProbe(provider.id);
		if (provider.baseUrl === undefined && !native?.baseUrl) {
			problems.push(`${provider.id}: not a native provider and missing baseUrl`);
		}
		if ((provider.authEnv?.length ?? 0) === 0 && !native?.auth) {
			problems.push(`${provider.id}: not a native provider and missing authEnv`);
		}
	}
	if (problems.length > 0) {
		throw new Error(`Model configuration is invalid: ${problems.join("; ")}`);
	}
}

function applyModelConfig(config: ModelConfigV1): void {
	validateProviderEntries(config.providers);
	for (const provider of config.providers) {
		(
			modelRuntime as { registerNativeProvider(p: unknown): void }
		).registerNativeProvider(buildProviderConfig(provider));
	}
	activeConfig = {
		schemaVersion: "model-config/v1",
		providers: config.providers.map((p) => ({
			...p,
			models: p.models.map((m) => ({ ...m })),
		})),
		defaultRoles: { ...config.defaultRoles },
	};
}

export function currentModelConfig(): ModelConfigV1 {
	return {
		schemaVersion: "model-config/v1",
		providers: activeConfig.providers.map((p) => ({
			...p,
			models: p.models.map((m) => ({ ...m })),
		})),
		defaultRoles: { ...activeConfig.defaultRoles },
	};
}

export function resolveRoleModel(
	role: WorkflowAgentRole,
	modelRolesOverride?: ModelRolesOverride,
): Model<Api> {
	const modelRef = modelRolesOverride?.[role] ?? activeConfig.defaultRoles[role];
	if (!modelRef) {
		throw new Error(
			`No model configured for role ${role}. Add it to defaultRoles or the per-workflow modelRoles override.`,
		);
	}
	const model = modelRuntime.getModel(modelRef.provider, modelRef.modelId);
	if (!model) {
		throw new Error(
			`Role ${role} resolves to provider=${modelRef.provider}, modelId=${modelRef.modelId}, but that model is not registered in the effective catalog.`,
		);
	}
	return model;
}

export function effectiveModelCatalog(): {
	defaultRoles: ModelRoles;
	providers: readonly EffectiveProvider[];
} {
	const providers: EffectiveProvider[] = [];
	for (const provider of activeConfig.providers) {
		providers.push({
			id: provider.id,
			name: provider.id,
			models: provider.models.map((model) => ({
				id: model.id,
				name: model.name,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				reasoning: model.reasoning ?? false,
			})),
		});
	}
	return {
		defaultRoles: { ...activeConfig.defaultRoles },
		providers,
	};
}

function modelRefFromValue(value: unknown): ModelRef | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const provider = readOptionalString(value, "provider");
	const modelId = readOptionalString(value, "modelId");
	if (provider !== undefined && modelId !== undefined) {
		return { provider, modelId };
	}
	return undefined;
}

function validateRoleEntry(
	role: string,
	value: unknown,
): ValidationProblem | undefined {
	const modelRef = modelRefFromValue(value);
	if (modelRef === undefined) {
		if (value === undefined) {
			return { role, provider: "", modelId: "", reason: "role_missing" };
		}
		return {
			role,
			provider: typeof value === "object" && value !== null ? readOptionalString(value, "provider") ?? "" : "",
			modelId: typeof value === "object" && value !== null ? readOptionalString(value, "modelId") ?? "" : "",
			reason: "malformed_role_entry",
		};
	}
	const registered = modelRuntime.getProvider(modelRef.provider);
	if (!registered) {
		return {
			role,
			provider: modelRef.provider,
			modelId: modelRef.modelId,
			reason: "provider_not_registered",
		};
	}
	const model = registered.getModels().find((m) => m.id === modelRef.modelId);
	if (!model) {
		return {
			role,
			provider: modelRef.provider,
			modelId: modelRef.modelId,
			reason: "model_not_in_catalog",
		};
	}
	return undefined;
}

/**
 * per-requirement modelRoles 部分覆盖校验（#15 决议）：任意角色子集 + 每条目 provider/model 于 catalog 成员；
 * 未传角色回落部署默认档。空对象/undefined 视为合法（全回落默认）。未知角色键视为非法。
 */
export function validateModelRoles(roles: unknown): ValidationProblem[] {
	const problems: ValidationProblem[] = [];
	if (roles === undefined || roles === null) {
		return problems;
	}
	if (typeof roles !== "object" || Array.isArray(roles)) {
		for (const role of WORKFLOW_AGENT_ROLES) {
			problems.push({ role, provider: "", modelId: "", reason: "role_missing" });
		}
		return problems;
	}
	const rolesRecord = roles as Record<string, unknown>;
	const knownRoles = new Set<string>(WORKFLOW_AGENT_ROLES);
	for (const role of Object.keys(rolesRecord)) {
		if (!knownRoles.has(role)) {
			problems.push({ role, provider: "", modelId: "", reason: "role_missing" });
			continue;
		}
		const problem = validateRoleEntry(role, rolesRecord[role]);
		if (problem) problems.push(problem);
	}
	return problems;
}

function validateBootConfig(config: ModelConfigV1): void {
	const problems: ValidationProblem[] = [];
	for (const role of WORKFLOW_AGENT_ROLES) {
		const problem = validateRoleEntry(role, config.defaultRoles[role]);
		if (problem) problems.push(problem);
	}
	if (problems.length > 0) {
		throw new Error(
			`Model configuration is invalid: ${problems.map((p) => `${p.role} -> ${p.provider}/${p.modelId} (${p.reason})`).join("; ")}`,
		);
	}
}

const loadedConfig = readModelConfig();
if (loadedConfig) {
	const contracts = await loadWorkflowContracts();
	const validator = compileWorkflowSchema(contracts, "model-config/v1");
	if (!validator.check(loadedConfig)) {
		const errors = validator.errors(loadedConfig);
		throw new Error(
			`Model config at ${MODEL_CONFIG_PATH} does not match model-config/v1 schema: ${JSON.stringify(errors)}`,
		);
	}
	applyModelConfig(loadedConfig);
}
validateBootConfig(currentModelConfig());
