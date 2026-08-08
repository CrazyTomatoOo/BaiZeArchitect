/**
 * BaiZe Agent Runtime — role-driven persistent agent turns.
 *
 * The Gateway owns HTTP, Run, and session lifecycle. This module owns Pi
 * model/provider setup and executes one role turn with domain tools only.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
	createProvider,
	envApiKeyAuth,
	lazyApi,
	type Api,
	type Model,
} from "@earendil-works/pi-ai";
import { createDomainTools, type DomainToolContext } from "./domain-tools.js";

const PROJECT_ROOT =
	process.env.BAIZE_PROJECT_ROOT ?? path.resolve(import.meta.dirname, "..");
const PROVIDER = process.env.RUNTIME_MODEL_PROVIDER ?? "bailian";
const MODEL_ID = process.env.RUNTIME_MODEL_ID ?? "glm-5.2";

const SYSTEM_PROMPT = [
	"你是 BaiZe Architect 的领域设计 agent。",
	"参考 .pi/skills 下对应角色 Skill 的职责契约。",
	"通过已注册的受限领域工具获取仓库事实，不得假设未读取的代码事实。",
	"禁止使用 bash/read/grep/find 或任何原始 shell/filesystem 工具。",
	"涉及代码证据时，只引用受限领域工具返回的真实相对路径和行号，禁止编造证据。",
	"遵循当前 Run 的任务与角色 Skill，以结构化结果或已注册领域工具完成工作。",
].join("\n");

const modelRuntime = await ModelRuntime.create();
const agentDir = getAgentDir();
const resourceLoader = new DefaultResourceLoader({
	cwd: PROJECT_ROOT,
	agentDir,
	appendSystemPromptOverride: () => [SYSTEM_PROMPT],
});
await resourceLoader.reload({ resolveProjectTrust: async () => true });

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

let activeProvider = PROVIDER;
let activeModelId = MODEL_ID;

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

const savedModelConfig = readModelConfig();
if (savedModelConfig) applyModelConfig(savedModelConfig);

function resolveModel() {
	return (
		modelRuntime.getModel(activeProvider, activeModelId) ??
		modelRuntime.getModel("bailian", activeModelId) ??
		modelRuntime.getModel("bailian", MODEL_ID)
	);
}

interface SessionControl {
	steer(text: string): Promise<void>;
	abort(): Promise<void>;
}

export interface PersistentSession {
	manager: SessionManager;
	sessionFile: string;
	sessionId: string;
}

export function openPersistentSession(
	repoPath: string,
	sessionDir: string,
	sessionFile?: string,
): PersistentSession {
	mkdirSync(sessionDir, { recursive: true });
	const manager = sessionFile
		? SessionManager.open(sessionFile, sessionDir, repoPath)
		: SessionManager.create(repoPath, sessionDir);
	const persistedFile = manager.getSessionFile();
	if (!persistedFile) throw new Error("persistent session has no session file");
	return {
		manager,
		sessionFile: persistedFile,
		sessionId: manager.getSessionId(),
	};
}

function lastAssistantText(session: unknown): string {
	const messages =
		(
			session as {
				state?: { messages?: Array<{ role?: string; content?: unknown }> };
			}
		).state?.messages ?? [];
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== "assistant") continue;
		if (typeof message.content === "string") return message.content;
		if (Array.isArray(message.content)) {
			return (message.content as Array<{ type?: string; text?: string }>)
				.map((part) => part.text ?? "")
				.join("");
		}
	}
	return "";
}

export type AgentRole =
	| "orchestrator"
	| "analyst"
	| "architect"
	| "critic"
	| "reviewer";

export interface AgentTurnInput {
	repoPath: string;
	repoId: string;
	role: AgentRole;
	prompt: string;
	domainContext?: DomainToolContext;
	sessionManager: SessionManager;
	onSession?: (session: SessionControl) => void;
}

const CRITIC_TOOL_NAMES = new Set([
	"inspect_repository",
	"search_code",
	"get_architecture",
	"search_prior_designs",
	"get_artifact",
	"run_consistency_check",
	"record_finding",
]);

async function loadRoleSkill(role: AgentRole): Promise<string> {
	try {
		return await readFile(
			path.join(PROJECT_ROOT, ".pi", "skills", role, "SKILL.md"),
			"utf8",
		);
	} catch {
		return "";
	}
}

export async function runAgentTurn(
	input: AgentTurnInput,
	onEvent?: (event: { type: "token"; text: string }) => void,
): Promise<string> {
	const model = resolveModel();
	if (!model) throw new Error(`model not found: ${PROVIDER}/${MODEL_ID}`);
	const domainTools = input.domainContext
		? createDomainTools(input.domainContext)
		: [];
	const customTools =
		input.role === "critic"
			? domainTools.filter((tool) => CRITIC_TOOL_NAMES.has(tool.name))
			: domainTools;
	const { session } = await createAgentSession({
		cwd: input.repoPath,
		model,
		modelRuntime,
		resourceLoader,
		tools: [],
		customTools,
		sessionManager: input.sessionManager,
	});
	input.onSession?.(session);
	let previousTextLength = 0;
	const unsubscribe = (
		session as unknown as {
			subscribe?: (callback: (event: unknown) => void) => () => void;
		}
	).subscribe?.((event) => {
		const item = event as {
			type?: string;
			message?: {
				role?: string;
				content?: Array<{ type?: string; text?: string }>;
			};
		};
		if (item.type === "message_start" && item.message?.role === "assistant") {
			previousTextLength = 0;
			return;
		}
		if (item.type !== "message_update" || item.message?.role !== "assistant")
			return;
		const content = item.message.content;
		if (!Array.isArray(content)) return;
		const fullText = content.reduce((text, part) => {
			if (part?.type === "text") return text + (part.text ?? "");
			return text;
		}, "");
		if (fullText.length > previousTextLength) {
			onEvent?.({ type: "token", text: fullText.slice(previousTextLength) });
			previousTextLength = fullText.length;
		}
	});
	try {
		const skill = await loadRoleSkill(input.role);
		await session.prompt(
			[
				`角色模式: ${input.role}，仓库: ${input.repoId}`,
				"只能使用已注册的受限领域工具获取仓库事实；禁止假设未读取的代码事实。",
				...(input.role === "critic"
					? [
							"这是隔离评审 Run，只能读取上游 Artifact；只能记录 Finding，不得修改 Artifact 或提出决策。",
						]
					: []),
				...(skill ? ["角色 Skill:", skill] : []),
				"任务:",
				input.prompt,
			].join("\n"),
		);
		return lastAssistantText(session);
	} finally {
		unsubscribe?.();
		await session.dispose?.();
	}
}

/** 需求录入 chat 化：多轮澄清 → 收敛为 {title,description}。 */
export async function chatIntake(
	history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
	const model = resolveModel();
	if (!model) throw new Error(`model not found: ${PROVIDER}/${MODEL_ID}`);
	const cwd = process.cwd();
	const { session } = await createAgentSession({
		cwd,
		model,
		modelRuntime,
		resourceLoader,
		tools: [],
		sessionManager: SessionManager.inMemory(cwd),
	});
	try {
		const system =
			'你是 BaiZe 的需求澄清助手。和用户对话澄清一个软件需求。每轮二选一：① 问一个聚焦的澄清问题(用户/边界/异常/约束/规模);② 信息足够时输出严格 JSON {"title":string,"description":string}(description 写完整需求,含边界与约束),且只输出该 JSON。';
		await session.prompt(
			system +
				"\n\n" +
				history
					.map(
						(message) =>
							`${message.role === "user" ? "用户" : "助手"}: ${message.content}`,
					)
					.join("\n") +
				"\n\n助手:",
		);
		return lastAssistantText(session);
	} finally {
		try {
			await session.dispose?.();
		} catch {
			/* ignore */
		}
	}
}
