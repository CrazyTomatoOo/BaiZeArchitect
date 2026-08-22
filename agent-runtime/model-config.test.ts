import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	effectiveModelCatalog,
	resolveRoleModel,
	validateModelRoles,
} from "./model-config.js";
import type { ModelRoles } from "./workflow/model-driver.js";

const validRoles: ModelRoles = {
	orchestrator: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
	analyst: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
	architect: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
	critic: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
};

test("validateModelRoles accepts all four roles from the builtin catalog", () => {
	const problems = validateModelRoles(validRoles);
	assert.deepEqual(problems, []);
});

test("validateModelRoles returns role_missing for non-object input", () => {
	const problems = validateModelRoles(null);
	assert.equal(problems.length, 4);
	for (const problem of problems) {
		assert.equal(problem.reason, "role_missing");
	}
});

test("validateModelRoles returns role_missing for a missing role", () => {
	const roles = { ...validRoles } as unknown as Record<string, unknown>;
	delete roles.orchestrator;
	const problems = validateModelRoles(roles);
	const orchestrator = problems.find((p) => p.role === "orchestrator");
	assert.ok(orchestrator);
	assert.equal(orchestrator?.reason, "role_missing");
	assert.equal(problems.length, 1);
});

test("validateModelRoles returns malformed_role_entry for a non-model-ref role", () => {
	const problems = validateModelRoles({
		...validRoles,
		orchestrator: { provider: "qwen-token-plan-cn" },
	});
	const orchestrator = problems.find((p) => p.role === "orchestrator");
	assert.ok(orchestrator);
	assert.equal(orchestrator?.reason, "malformed_role_entry");
	assert.equal(problems.length, 1);
});

test("validateModelRoles returns provider_not_registered for an unknown provider", () => {
	const problems = validateModelRoles({
		...validRoles,
		orchestrator: { provider: "unknown-provider", modelId: "glm-5.2" },
	});
	const orchestrator = problems.find((p) => p.role === "orchestrator");
	assert.ok(orchestrator);
	assert.equal(orchestrator?.reason, "provider_not_registered");
	assert.equal(problems.length, 1);
});

test("validateModelRoles returns model_not_in_catalog for an unknown model", () => {
	const problems = validateModelRoles({
		...validRoles,
		orchestrator: { provider: "qwen-token-plan-cn", modelId: "unknown-model" },
	});
	const orchestrator = problems.find((p) => p.role === "orchestrator");
	assert.ok(orchestrator);
	assert.equal(orchestrator?.reason, "model_not_in_catalog");
	assert.equal(problems.length, 1);
});

test("resolveRoleModel returns the default role model", () => {
	const model = resolveRoleModel("orchestrator");
	assert.equal(model.provider, "qwen-token-plan-cn");
	assert.equal(model.id, "glm-5.2");
});

test("resolveRoleModel honors per-workflow modelRoles override", () => {
	const override: ModelRoles = {
		orchestrator: { provider: "qwen-token-plan-cn", modelId: "qwen-max" },
		analyst: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
		architect: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
		critic: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
	};
	const model = resolveRoleModel("orchestrator", override);
	assert.equal(model.id, "qwen-max");
});

test("resolveRoleModel throws when override provider is not registered", () => {
	const override: ModelRoles = {
		...validRoles,
		orchestrator: { provider: "missing-provider", modelId: "glm-5.2" },
	};
	assert.throws(() => resolveRoleModel("orchestrator", override), /missing-provider/);
});

test("resolveRoleModel throws when override model is not in the effective catalog", () => {
	const override: ModelRoles = {
		...validRoles,
		orchestrator: { provider: "qwen-token-plan-cn", modelId: "missing-model" },
	};
	assert.throws(() => resolveRoleModel("orchestrator", override), /missing-model/);
});

test("effectiveModelCatalog exposes curated providers without auth credentials", () => {
	const catalog = effectiveModelCatalog();
	assert.equal(catalog.defaultRoles.orchestrator.provider, "qwen-token-plan-cn");
	const provider = catalog.providers.find((p) => p.id === "qwen-token-plan-cn");
	assert.ok(provider);
	assert.ok(provider?.models.some((m) => m.id === "glm-5.2"));
	assert.ok(provider?.models.some((m) => m.id === "qwen-max"));
	for (const p of catalog.providers) {
		assert.equal((p as unknown as Record<string, unknown>).authEnv, undefined);
		assert.equal((p as unknown as Record<string, unknown>).apiKey, undefined);
	}
});

function runImportWithConfig(configPath: string): { ok: boolean; stderr: string } {
	const result = spawnSync(
		process.execPath,
		["--import", "tsx", "-e", "import('./model-config.js')"],
		{
			cwd: process.cwd(),
			env: {
				...process.env,
				BAIZE_MODEL_CONFIG_PATH: configPath,
			},
			encoding: "utf8",
		},
	);
	return { ok: result.status === 0, stderr: result.stderr ?? "" };
}

test("boot rejects a legacy {provider, modelId, apiKey} config file", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "baize-model-config-"));
	const configPath = path.join(directory, "model-config.json");
	writeFileSync(
		configPath,
		JSON.stringify({ provider: "bailian", modelId: "glm-5.2", apiKey: "secret" }),
	);
	try {
		const { ok, stderr } = runImportWithConfig(configPath);
		assert.equal(ok, false);
		assert.match(stderr, /Legacy model config rejected/);
		assert.match(stderr, /apiKey/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("boot rejects a config with a missing default role", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "baize-model-config-"));
	const configPath = path.join(directory, "model-config.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			schemaVersion: "model-config/v1",
			providers: [
				{
					id: "qwen-token-plan-cn",
					baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
					authEnv: ["QWEN_TOKEN_PLAN_CN_API_KEY"],
					models: [
						{
							id: "glm-5.2",
							name: "GLM-5.2",
							api: "openai-completions",
							provider: "qwen-token-plan-cn",
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 1048576,
							maxTokens: 16384,
						},
					],
				},
			],
			defaultRoles: {
				orchestrator: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
				analyst: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
				architect: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
			},
		}),
	);
	try {
		const { ok, stderr } = runImportWithConfig(configPath);
		assert.equal(ok, false);
		assert.match(stderr, /does not match model-config\/v1 schema/);
		assert.match(stderr, /critic/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("boot rejects a config with an unknown provider in defaultRoles", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "baize-model-config-"));
	const configPath = path.join(directory, "model-config.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			schemaVersion: "model-config/v1",
			providers: [
				{
					id: "qwen-token-plan-cn",
					baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
					authEnv: ["QWEN_TOKEN_PLAN_CN_API_KEY"],
					models: [
						{
							id: "glm-5.2",
							name: "GLM-5.2",
							api: "openai-completions",
							provider: "qwen-token-plan-cn",
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 1048576,
							maxTokens: 16384,
						},
					],
				},
			],
			defaultRoles: {
				orchestrator: { provider: "missing", modelId: "x" },
				analyst: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
				architect: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
				critic: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
			},
		}),
	);
	try {
		const { ok, stderr } = runImportWithConfig(configPath);
		assert.equal(ok, false);
		assert.match(stderr, /Model configuration is invalid/);
		assert.match(stderr, /provider_not_registered/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("boot rejects a config with an unknown model in defaultRoles", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "baize-model-config-"));
	const configPath = path.join(directory, "model-config.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			schemaVersion: "model-config/v1",
			providers: [
				{
					id: "qwen-token-plan-cn",
					baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
					authEnv: ["QWEN_TOKEN_PLAN_CN_API_KEY"],
					models: [
						{
							id: "glm-5.2",
							name: "GLM-5.2",
							api: "openai-completions",
							provider: "qwen-token-plan-cn",
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 1048576,
							maxTokens: 16384,
						},
					],
				},
			],
			defaultRoles: {
				orchestrator: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
				analyst: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
				architect: { provider: "qwen-token-plan-cn", modelId: "glm-5.2" },
				critic: { provider: "qwen-token-plan-cn", modelId: "missing-model" },
			},
		}),
	);
	try {
		const { ok, stderr } = runImportWithConfig(configPath);
		assert.equal(ok, false);
		assert.match(stderr, /Model configuration is invalid/);
		assert.match(stderr, /model_not_in_catalog/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("boot accepts a valid model-config/v1 file", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "baize-model-config-"));
	const configPath = path.join(directory, "model-config.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			schemaVersion: "model-config/v1",
			providers: [
				{
					id: "qwen-token-plan-cn",
					baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
					authEnv: ["QWEN_TOKEN_PLAN_CN_API_KEY"],
					models: [
						{
							id: "glm-5.2",
							name: "GLM-5.2",
							api: "openai-completions",
							provider: "qwen-token-plan-cn",
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 1048576,
							maxTokens: 16384,
						},
					],
				},
			],
			defaultRoles: validRoles,
		}),
	);
	try {
		const { ok, stderr } = runImportWithConfig(configPath);
		assert.equal(ok, true, stderr);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("boot accepts a native overlay without baseUrl/authEnv (native defaults preserved)", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "baize-model-config-"));
	const configPath = path.join(directory, "model-config.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			schemaVersion: "model-config/v1",
			providers: [
				{
					id: "qwen-token-plan-cn",
					models: [
						{
							id: "glm-5.2",
							name: "GLM-5.2",
							api: "openai-completions",
							provider: "qwen-token-plan-cn",
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 1048576,
							maxTokens: 16384,
						},
					],
				},
			],
			defaultRoles: validRoles,
		}),
	);
	try {
		const { ok, stderr } = runImportWithConfig(configPath);
		assert.equal(ok, true, stderr);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("boot rejects a non-native provider without baseUrl or authEnv", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "baize-model-config-"));
	const configPath = path.join(directory, "model-config.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			schemaVersion: "model-config/v1",
			providers: [
				{
					id: "my-private-gateway",
					models: [
						{
							id: "gateway-model",
							name: "Gateway Model",
							api: "openai-completions",
							provider: "my-private-gateway",
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 128000,
							maxTokens: 8192,
						},
					],
				},
			],
			defaultRoles: validRoles,
		}),
	);
	try {
		const { ok, stderr } = runImportWithConfig(configPath);
		assert.equal(ok, false);
		assert.match(stderr, /Model configuration is invalid/);
		assert.match(stderr, /missing baseUrl/);
		assert.match(stderr, /missing authEnv/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("boot rejects an unsupported model api", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "baize-model-config-"));
	const configPath = path.join(directory, "model-config.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			schemaVersion: "model-config/v1",
			providers: [
				{
					id: "qwen-token-plan-cn",
					baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
					authEnv: ["QWEN_TOKEN_PLAN_CN_API_KEY"],
					models: [
						{
							id: "glm-5.2",
							name: "GLM-5.2",
							api: "bogus-api",
							provider: "qwen-token-plan-cn",
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 1048576,
							maxTokens: 16384,
						},
					],
				},
			],
			defaultRoles: validRoles,
		}),
	);
	try {
		const { ok, stderr } = runImportWithConfig(configPath);
		assert.equal(ok, false);
		assert.match(stderr, /unsupported api/);
		assert.match(stderr, /bogus-api/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("boot rejects duplicate model ids within a provider", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "baize-model-config-"));
	const configPath = path.join(directory, "model-config.json");
	const modelTemplate = {
		name: "GLM-5.2",
		api: "openai-completions",
		provider: "qwen-token-plan-cn",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1048576,
		maxTokens: 16384,
	};
	writeFileSync(
		configPath,
		JSON.stringify({
			schemaVersion: "model-config/v1",
			providers: [
				{
					id: "qwen-token-plan-cn",
					baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
					authEnv: ["QWEN_TOKEN_PLAN_CN_API_KEY"],
					models: [
						{ id: "glm-5.2", ...modelTemplate },
						{ id: "glm-5.2", ...modelTemplate },
					],
				},
			],
			defaultRoles: validRoles,
		}),
	);
	try {
		const { ok, stderr } = runImportWithConfig(configPath);
		assert.equal(ok, false);
		assert.match(stderr, /duplicate model id/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("boot rejects mixed apis within a provider", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "baize-model-config-"));
	const configPath = path.join(directory, "model-config.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			schemaVersion: "model-config/v1",
			providers: [
				{
					id: "qwen-token-plan-cn",
					baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
					authEnv: ["QWEN_TOKEN_PLAN_CN_API_KEY"],
					models: [
						{
							id: "glm-5.2",
							name: "GLM-5.2",
							api: "openai-completions",
							provider: "qwen-token-plan-cn",
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 1048576,
							maxTokens: 16384,
						},
						{
							id: "glm-5.2-anthropic",
							name: "GLM via Anthropic",
							api: "anthropic-messages",
							provider: "qwen-token-plan-cn",
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 1048576,
							maxTokens: 16384,
						},
					],
				},
			],
			defaultRoles: validRoles,
		}),
	);
	try {
		const { ok, stderr } = runImportWithConfig(configPath);
		assert.equal(ok, false);
		assert.match(stderr, /must share one api/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
