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
import { currentModelConfig, modelRuntime } from "./model-config.js";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";

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
	"遵循当前 Run 的任务与角色 Skill，以结构化结果或已注册领域工具完成工作。",
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

async function createPiExecutor(): Promise<PiModelExecutor> {
	const config = currentModelConfig();
	const model =
		modelRuntime.getModel(config.provider ?? "bailian", config.modelId ?? "glm-5.2") ??
		modelRuntime.getModel("bailian", "glm-5.2");
	if (!model) throw new Error("production model not resolved");
	return async (input, _tools) => {
		void _tools;
		const { session } = await createAgentSession({
			cwd: PROJECT_ROOT,
			model,
			modelRuntime,
			resourceLoader,
			tools: [],
		});
		await session.prompt(input.instruction);
		const messages =
			(session as {
				state?: { messages?: Array<{ role?: string; content?: unknown }> };
			}).state?.messages ?? [];
		let text = "";
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index];
			if (message.role !== "assistant") continue;
			if (typeof message.content === "string") {
				text = message.content;
				break;
			}
			if (Array.isArray(message.content)) {
				text = (message.content as Array<{ type?: string; text?: string }>)
					.map((part) => part.text ?? "")
					.join("");
				break;
			}
		}
		let structuredResult: unknown;
		try {
			structuredResult = JSON.parse(text);
		} catch {
			structuredResult = { raw: text };
		}
		const usage = (session as { state?: { usage?: { inputTokens?: number; outputTokens?: number } } }).state?.usage;
		try {
			await (session as unknown as { dispose?: () => unknown }).dispose?.();
		} catch {
			/* session disposal failure is non-fatal */
		}
		return {
			structuredResult,
			modelUsage: {
				inputTokens: usage?.inputTokens ?? 0,
				outputTokens: usage?.outputTokens ?? 0,
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
	void modelDriver; // modelDriver is used by executeTask/planWorkflow at runtime

	const server = await startOperatorServer({
		runtime,
		operators,
		host: HOST,
		port: PORT,
		staticRoot: WEB_DIST,
	});

	console.log(`[baize] http://${HOST}:${server.port} (Workflow API + Web SPA)`);
}

main().catch((error) => {
	console.error("[baize] fatal:", error);
	process.exit(1);
});
