/**
 * model-profiles — 模型档共享展示逻辑:角色分组、角色标签、规格文本、需求级自定义判定。
 * 词汇对齐 CONTEXT.md:模型档(Model Profile)/ 需求级(自定义)/ 部署默认档(ModelConfig defaultRoles)。
 */
import type { ModelConfig, ModelInfo, ModelProfile, ModelRoleKey } from "./workflow-client.js";

/** 模型档三段分组:分析 / 架构 / 评审(顺序即渲染顺序)。 */
export const MODEL_ROLE_GROUPS: readonly { label: string; roles: readonly ModelRoleKey[] }[] = [
	{ label: "分析", roles: ["analysis-analyst", "scenario-analyst", "usecase-analyst", "function-analyst"] },
	{ label: "架构", roles: ["design-architect", "architecture-architect", "data-architect", "api-architect"] },
	{ label: "评审", roles: ["critic"] },
];

/** 全表 9 角色,顺序与分组一致。 */
export const MODEL_ROLE_KEYS: readonly ModelRoleKey[] = MODEL_ROLE_GROUPS.flatMap((group) => group.roles);

export const ROLE_LABELS: Record<ModelRoleKey, string> = {
	"analysis-analyst": "需求分析",
	"scenario-analyst": "场景分析",
	"usecase-analyst": "用例分析",
	"function-analyst": "功能分析",
	"design-architect": "设计架构",
	"architecture-architect": "架构设计",
	"data-architect": "数据设计",
	"api-architect": "API 设计",
	critic: "评审者",
};

/** 模型规格文本:名 · ctx · 最大输出 · thinking(若支持)。目录缺失时返回占位。 */
export function modelSpecLabel(model: ModelInfo | null | undefined): string {
	if (!model) return "—";
	return `${model.name} · ${model.contextWindow.toLocaleString()} ctx · ${model.maxTokens.toLocaleString()} tok${model.reasoning ? " · thinking" : ""}`;
}

/** 从目录解析 (provider, modelId) 对应的模型信息;目录未加载或条目不存在时返回 undefined。 */
export function findModel(config: ModelConfig | null | undefined, profile: ModelProfile | undefined): ModelInfo | undefined {
	const provider = config?.providers.find((p) => p.id === profile?.provider);
	return provider?.models.find((m) => m.id === profile?.modelId);
}

/** 提供方显示名:目录名优先,缺失回落原始 id,无档返回占位。 */
export function providerLabel(config: ModelConfig | null | undefined, profile: ModelProfile | undefined): string {
	if (!profile?.provider) return "—";
	return config?.providers.find((p) => p.id === profile.provider)?.name ?? profile.provider;
}

/** 需求级自定义数:持久化 modelRoles 中与部署默认档 actual 不同的条目数(全表 9 角色口径)。 */
export function customizedRoleCount(
	modelRoles: Partial<Record<ModelRoleKey, ModelProfile>> | null | undefined,
	defaultRoles: Record<ModelRoleKey, ModelProfile>,
): number {
	if (!modelRoles) return 0;
	return MODEL_ROLE_KEYS.filter((role) => isRoleCustomized(role, modelRoles, defaultRoles)).length;
}

/** 该角色是否为需求级自定义(持久化值与部署默认档不同)。 */
export function isRoleCustomized(
	role: ModelRoleKey,
	modelRoles: Partial<Record<ModelRoleKey, ModelProfile>> | null | undefined,
	defaultRoles: Record<ModelRoleKey, ModelProfile>,
): boolean {
	const profile = modelRoles?.[role];
	return profile !== undefined && (profile.provider !== defaultRoles[role].provider || profile.modelId !== defaultRoles[role].modelId);
}