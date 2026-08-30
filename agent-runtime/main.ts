/**
 * main.ts — BaiZe production entry point; the sole long-running process.
 *
 * Assembles the Workflow governance kernel with production fixtures and the
 * Pi Model Driver, registers the Operator Server as the only HTTP transport,
 * serves the built Web SPA, and runs startup reconciliation before listening.
 *
 * ScriptedModelDriver, deterministic Clock/IDs/digests/repository snapshots,
 * crash injection, and outbox transport fixtures exist only in test assembly
 * and are never selectable through production configuration.
 */
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createHashProvider,
	type CrashInjector,
	type FixtureClock,
	type FixtureOutboxTransport,
} from "./testing/deterministic-fixtures.js";
import { openHeadlessWorkflowRuntime } from "./workflow/headless-runtime.js";
import { startOperatorServer, type OperatorIdentity } from "./workflow/operator-server.js";
import { PiModelDriver } from "./workflow/pi-model-driver.js";
import type { PiModelExecutor } from "./workflow/model-driver.js";
import {
	modelRuntime,
	resolveRoleModel,
} from "./model-config.js";
import type { WorkflowAgentRole } from "./workflow/model-driver.js";
import {
	createAgentSession,
	defineTool,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

process.env.BAIZE_GATEWAY = "1";

const ROOT =
	process.env.BAIZE_PROJECT_ROOT ??
	join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.BAIZE_DB_PATH ?? join(ROOT, ".baize", "baize.db");
const SESSION_DIR =
	process.env.BAIZE_SESSION_DIR ?? join(ROOT, ".baize", "sessions");
const PORT = Number(process.env.BAIZE_PORT ?? 18789);
const WEB_DIST = process.env.BAIZE_WEB_DIST ?? join(ROOT, "web", "dist");
const HOST = process.env.BAIZE_HOST ?? "127.0.0.1";

// — Production fixtures (no determinism, no crash injection) —

const productionClock: FixtureClock = {
	now() {
		return new Date();
	},
	advance() {
		/* production never advances the clock virtually */
	},
};

const productionCrashInjector: CrashInjector = {
	reach() {
		/* production never crashes intentionally */
	},
};

const productionOutboxTransport: FixtureOutboxTransport = {
	deliver(delivery) {
		// Production outbox delivery is a logged side-effect; actual model
		// dispatch happens synchronously through planWorkflow/executeTask.
		void delivery;
	},
	deliveries() {
		return [];
	},
};

// — Operator credentials from environment —
// Format: BAIZE_OPERATORS=token1=actorRef1:capA,capB;token2=actorRef2:capA
function parseOperators(env: string | undefined): Record<string, OperatorIdentity> {
	const operators: Record<string, OperatorIdentity> = {};
	if (!env) return operators;
	for (const entry of env.split(";")) {
		const trimmed = entry.trim();
		if (!trimmed) continue;
		const eqIndex = trimmed.indexOf("=");
		if (eqIndex === -1) continue;
		const token = trimmed.slice(0, eqIndex);
		const rest = trimmed.slice(eqIndex + 1);
		const colonIndex = rest.indexOf(":");
		if (colonIndex === -1) {
			operators[token] = { actorRef: rest, capabilities: [] };
			continue;
		}
		const actorRef = rest.slice(0, colonIndex);
		const capabilities = rest
			.slice(colonIndex + 1)
			.split(",")
			.map((c) => c.trim())
			.filter(Boolean);
		operators[token] = { actorRef, capabilities };
	}
	return operators;
}

const operators = parseOperators(process.env.BAIZE_OPERATORS);

// — Pi Model Driver —
// Production uses the real Pi SDK executor. The executor creates an isolated
// AgentSession per call, sends the instruction, and returns the structured
// result plus token usage. ScriptedModelDriver is never selectable here.
const SYSTEM_PROMPT = [
	"你是 BaiZe Architect 的领域设计 agent。",
	"参考 .pi/skills 下对应角色 Skill 的职责契约。",
	"通过已注册的受限领域工具获取仓库事实，不得假设未读取的代码事实。",
	"禁止使用 bash/read/grep/find 或任何原始 shell/filesystem 工具。",
	"涉及代码证据时，只引用受限领域工具返回的真实相对路径和行号，禁止编造证据。",
	"遵循当前 Run 的任务与角色 Skill，完成后必须调用 submit_role_result 工具提交结构化 RoleResult，禁止以自由文本回复。",
].join("\n");

const PROJECT_ROOT =
	process.env.BAIZE_PROJECT_ROOT ??
	join(dirname(fileURLToPath(import.meta.url)), "..");

const resourceLoader = new DefaultResourceLoader({
	cwd: PROJECT_ROOT,
	agentDir: getAgentDir(),
	appendSystemPromptOverride: () => [SYSTEM_PROMPT],
});
await resourceLoader.reload({ resolveProjectTrust: async () => true });

/** 从 session.getSessionStats() 返回值提取 ModelUsage 字段(SessionStats.tokens 形状 → BaiZe ModelUsage 映射)。 */
function extractUsage(stats: unknown): {
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheCreationTokens?: number;
	reasoningTokens?: number;
	cost?: number;
} {
	if (!stats || typeof stats !== "object") return {};
	const s = stats as Record<string, unknown>;
	const tokens = s.tokens;
	if (!tokens || typeof tokens !== "object") {
		return { cost: typeof s.cost === "number" ? s.cost : undefined };
	}
	const t = tokens as Record<string, unknown>;
	return {
		inputTokens: typeof t.input === "number" ? t.input : undefined,
		outputTokens: typeof t.output === "number" ? t.output : undefined,
		cacheReadTokens: typeof t.cacheRead === "number" ? t.cacheRead : undefined,
		cacheCreationTokens: typeof t.cacheWrite === "number" ? t.cacheWrite : undefined,
		cost: typeof s.cost === "number" ? s.cost : undefined,
	};
}

/** 遍历 assistant messages 累加 usage.reasoning(SessionStats 不聚 reasoning,需按消息粒度取)。 */
function aggregateReasoning(messages: unknown): number | undefined {
	if (!Array.isArray(messages)) return undefined;
	let total: number | undefined;
	for (const message of messages) {
		if (!message || typeof message !== "object") continue;
		const msg = message as Record<string, unknown>;
		if (msg.role !== "assistant") continue;
		const usage = msg.usage;
		if (!usage || typeof usage !== "object") continue;
		const reasoning = (usage as Record<string, unknown>).reasoning;
		if (typeof reasoning === "number") {
			total = (total ?? 0) + reasoning;
		}
	}
	return total;
}
/** 终止型工具：角色以它提交结构化 RoleResult 并结束 turn（terminate:true + details=params）。 */
const submitRoleResultTool = defineTool({
	name: "submit_role_result",
	label: "Submit Role Result",
	description: "Submit the final structured RoleResult and end the turn. This is the only way to return your result — never reply with free text.",
	promptSnippet: "Submit your final RoleResult via submit_role_result.",
	parameters: Type.Object({
		roleResult: Type.Any({ description: "Complete RoleResult JSON matching the role-result/v1 schema given in the instruction" }),
	}),
	async execute(_toolCallId, params) {
		return {
			content: [{ type: "text" as const, text: "RoleResult submitted" }],
			details: params.roleResult,
			terminate: true,
		};
	},
});

async function createPiExecutor(): Promise<PiModelExecutor> {
	return async (input) => {
		const model = resolveRoleModel(input.role as WorkflowAgentRole, input.modelRoles);
		const sessionManager = SessionManager.inMemory(PROJECT_ROOT);
		// 按 Role Contract 声明的 toolNames 解析工具白名单(Q2.4/C);submit_role_result 永远可用(所有角色收尾)。
		// 未知名静默丢弃——域工具(@ladybugdb/core 只读探查)是后续票,当前仅 submit 注册。
		const registeredTools: Record<string, typeof submitRoleResultTool> = { submit_role_result: submitRoleResultTool };
		const requested = input.toolNames ?? ["submit_role_result"];
		const resolvedTools = requested
			.filter((name) => name in registeredTools)
			.map((name) => registeredTools[name]);
		const { session } = await createAgentSession({
			cwd: PROJECT_ROOT,
			model,
			modelRuntime,
			resourceLoader,
			sessionManager,
			customTools: resolvedTools,
			tools: requested.filter((name) => name in registeredTools),
		});
		await session.prompt(input.instruction);
		// 优先取终止型工具 details(submit_role_result);无则回退最近一条 assistant 文本 JSON.parse
		// pi-ai 0.83 message shape: toolResult 消息 role="toolResult" + toolName + details
		let structuredResult: unknown;
		let terminationTool: string | undefined;
		let lastAssistantText = "";
		const state = "state" in session ? (session as { state?: unknown }).state : undefined;
		const messages = (state && typeof state === "object" && "messages" in state ? (state as { messages?: unknown }).messages : undefined) ?? [];
		if (Array.isArray(messages)) {
			for (let index = messages.length - 1; index >= 0; index -= 1) {
				const message = messages[index];
				if (!message || typeof message !== "object") continue;
				const msg = message as Record<string, unknown>;
				// 终止型工具结果:role=toolResult,带 details(pi-ai ToolResultMessage)
				if (msg.role === "toolResult" && msg.details !== undefined) {
					structuredResult = msg.details;
					// GLM-5.2 可能以字符串形式传递 JSON(把 JSON 当字符串参数提交),需反序列化为对象。
					if (typeof structuredResult === "string") {
						try {
							structuredResult = JSON.parse(structuredResult);
						} catch {
							// 保留原始字符串,后续 schema 验证会以 invalid_role_result_schema 拒绝。
						}
					}
					terminationTool = typeof msg.toolName === "string" ? msg.toolName : "unknown";
					break;
				}
				// 已找到终止 details 后不再回退取文本
				if (terminationTool || lastAssistantText) continue;
				if (msg.role !== "assistant") continue;
				if (typeof msg.content === "string") {
					lastAssistantText = msg.content;
				} else if (Array.isArray(msg.content)) {
					lastAssistantText = msg.content
						.filter((part): part is { type?: string; text?: string } => typeof part === "object" && part !== null && "text" in part)
						.map((part) => part.text ?? "")
						.join("");
				}
			}
		}
		if (structuredResult === undefined) {
			try {
				structuredResult = JSON.parse(lastAssistantText);
			} catch {
				structuredResult = { raw: lastAssistantText };
			}
		}
		// usage: getSessionStats() 聚合(pi-agent 0.83 无 state.usage;旧读法恒返 0)
		const usage = typeof session.getSessionStats === "function" ? extractUsage(session.getSessionStats()) : {};
		// reasoning: SessionStats 不聚,需遍历 assistant messages 累加 usage.reasoning
		const reasoningTokens = aggregateReasoning(messages);
		try {
			session.dispose();
		} catch {
			/* session disposal failure is non-fatal */
		}
		return {
			structuredResult,
			terminationTool,
			modelUsage: {
				provider: model.provider,
				modelId: model.id,
				inputTokens: usage.inputTokens ?? 0,
				outputTokens: usage.outputTokens ?? 0,
				cacheReadTokens: usage.cacheReadTokens,
				cacheCreationTokens: usage.cacheCreationTokens,
				reasoningTokens,
				cost: usage.cost,
			},
		};
	};
}
async function main(): Promise<void> {
	await mkdir(dirname(DB_PATH), { recursive: true });
	await mkdir(SESSION_DIR, { recursive: true });

	const hashProvider = createHashProvider();
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath: DB_PATH,
		clock: productionClock,
		hashProvider,
		crashInjector: productionCrashInjector,
		outboxTransport: productionOutboxTransport,
	});

	// Startup reconciliation completes before HTTP accepts traffic.
	const reconciliation = runtime.reconcile();
	if (!reconciliation.databaseIntact || !reconciliation.foreignKeysValid) {
		console.error("[baize] startup recovery: database integrity check failed");
		process.exit(1);
	}
	if (reconciliation.outboxReset > 0 || reconciliation.outboxDelivered > 0) {
		console.log(
			`[baize] startup recovery: ${reconciliation.outboxReset} outbox reset, ${reconciliation.outboxDelivered} delivered`,
		);
	}
	runtime.processOutbox();

	const executor = await createPiExecutor();
	const modelDriver = new PiModelDriver(executor);

	const server = await startOperatorServer({
		runtime,
		operators,
		host: HOST,
		port: PORT,
		staticRoot: WEB_DIST,
		modelDriver,
	});

	console.log(`[baize] http://${HOST}:${server.port} (Workflow API + Web SPA)`);
}

main().catch((error) => {
	console.error("[baize] fatal:", error);
	process.exit(1);
});
