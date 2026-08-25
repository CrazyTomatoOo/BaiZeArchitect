import { describe, expect, it } from "vitest";

import {
	MODEL_ROLE_GROUPS,
	MODEL_ROLE_KEYS,
	ROLE_LABELS,
	customizedRoleCount,
	findModel,
	isRoleCustomized,
	modelSpecLabel,
	providerLabel,
} from "./model-profiles.js";
import type { ModelConfig, ModelProfile, ModelRoleKey } from "./workflow-client.js";

const defaultRoles: Record<ModelRoleKey, ModelProfile> = {
	"analysis-analyst": { provider: "qwen-token-plan-cn", modelId: "qwen-plus" },
	"scenario-analyst": { provider: "qwen-token-plan-cn", modelId: "qwen-plus" },
	"usecase-analyst": { provider: "qwen-token-plan-cn", modelId: "qwen-plus" },
	"function-analyst": { provider: "qwen-token-plan-cn", modelId: "qwen-plus" },
	"design-architect": { provider: "glm", modelId: "glm-5.2" },
	"architecture-architect": { provider: "glm", modelId: "glm-5.2" },
	"data-architect": { provider: "glm", modelId: "glm-5.2" },
	"api-architect": { provider: "glm", modelId: "glm-5.2" },
	critic: { provider: "glm", modelId: "glm-4.2" },
};

const config: ModelConfig = {
	defaultRoles,
	providers: [
		{
			id: "qwen-token-plan-cn",
			name: "通义千问",
			models: [
				{ id: "qwen-max", name: "Qwen Max", contextWindow: 1_048_576, maxTokens: 16_384, reasoning: true },
				{ id: "qwen-plus", name: "Qwen Plus", contextWindow: 1_048_576, maxTokens: 8_192, reasoning: false },
			],
		},
		{
			id: "glm",
			name: "智谱 GLM",
			models: [
				{ id: "glm-5.2", name: "GLM-5.2", contextWindow: 128_000, maxTokens: 8_192, reasoning: false },
				{ id: "glm-4.2", name: "GLM-4.2", contextWindow: 128_000, maxTokens: 4_096, reasoning: false },
			],
		},
	],
};

describe("model-profiles — 分组与规格文本", () => {
	it("三段分组覆盖全部 9 角色且无重复,标签齐全", () => {
		const flattened = MODEL_ROLE_GROUPS.flatMap((group) => group.roles);
		expect(flattened).toHaveLength(9);
		expect(new Set(flattened).size).toBe(9);
		expect(MODEL_ROLE_KEYS).toEqual(flattened);
		expect(Object.keys(ROLE_LABELS)).toHaveLength(9);
	});

	it("模型规格文本:含 thinking 与不含", () => {
		expect(modelSpecLabel(config.providers[0]!.models[0]!)).toBe("Qwen Max · 1,048,576 ctx · 16,384 tok · thinking");
		expect(modelSpecLabel(config.providers[0]!.models[1]!)).toBe("Qwen Plus · 1,048,576 ctx · 8,192 tok");
		expect(modelSpecLabel(undefined)).toBe("—");
	});

	it("findModel/providerLabel 解析目录;缺失回落原始 id 与占位", () => {
		expect(findModel(config, { provider: "glm", modelId: "glm-5.2" })?.name).toBe("GLM-5.2");
		expect(findModel(config, { provider: "glm", modelId: "nope" })).toBeUndefined();
		expect(providerLabel(config, { provider: "glm", modelId: "glm-5.2" })).toBe("智谱 GLM");
		expect(providerLabel(null, { provider: "glm", modelId: "glm-5.2" })).toBe("glm");
		expect(providerLabel(config, undefined)).toBe("—");
	});
});

describe("model-profiles — 需求级自定义判定", () => {
	it("undefined / 空对象均视为全部署默认", () => {
		expect(customizedRoleCount(undefined, defaultRoles)).toBe(0);
		expect(customizedRoleCount({}, defaultRoles)).toBe(0);
	});

	it("与部署默认实际不同的条目计为需求级自定义", () => {
		const roles = { "analysis-analyst": { provider: "glm", modelId: "glm-5.2" } } as Partial<Record<ModelRoleKey, ModelProfile>>;
		expect(customizedRoleCount(roles, defaultRoles)).toBe(1);
		expect(isRoleCustomized("analysis-analyst", roles, defaultRoles)).toBe(true);
		expect(isRoleCustomized("critic", roles, defaultRoles)).toBe(false);
	});

	it("值恰好等于部署默认不算自定义(持久化口径)", () => {
		const roles = { "analysis-analyst": defaultRoles["analysis-analyst"] } as Partial<Record<ModelRoleKey, ModelProfile>>;
		expect(customizedRoleCount(roles, defaultRoles)).toBe(0);
	});

	it("部分覆盖(直接 API)中缺失角色回落部署默认", () => {
		const roles = { "data-architect": { provider: "glm", modelId: "glm-4.2" } } as Partial<Record<ModelRoleKey, ModelProfile>>;
		expect(customizedRoleCount(roles, defaultRoles)).toBe(1);
		expect(isRoleCustomized("scenario-analyst", roles, defaultRoles)).toBe(false);
	});
});