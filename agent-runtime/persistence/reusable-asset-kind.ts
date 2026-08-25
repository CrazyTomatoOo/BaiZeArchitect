/**
 * reusable-asset-kind.ts — 资产库可复用资产类别（kind）的单一事实源。
 *
 * store / server / web 统一从此处引用来避免各处拼写漂移。
 * 注意：设计阶段 Artifact kind（artifact-content-v1）与本枚举是两套词汇，
 * 此处的 stakeholder 是 workspace 级资产 kind，不进入设计 Artifact schema。
 */
export const REUSABLE_ASSET_KINDS = ["scenario", "usecase", "function", "design", "architecture", "data", "api", "stakeholder"] as const;

export type ReusableAssetKind = (typeof REUSABLE_ASSET_KINDS)[number];

export function isReusableAssetKind(value: unknown): value is ReusableAssetKind {
	return typeof value === "string" && (REUSABLE_ASSET_KINDS as readonly string[]).includes(value);
}