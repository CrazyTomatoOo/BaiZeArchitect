import { nothing, type TemplateResult } from "lit";

export type Renderable = TemplateResult | typeof nothing;
import {
	ASSET_KINDS,
	assetKindLabel,
	type AssetKind,
	type AssetResolvedRelation,
} from "./workflow-client.js";

export { ASSET_KINDS, assetKindLabel };

export type WorkbenchTab =
	| "scenario"
	| "function"
	| "usecase"
	| "design"
	| "architecture"
	| "data"
	| "api"
	| "stakeholder"
	| "graph";

export const TAB_ORDER: readonly WorkbenchTab[] = [
	"scenario",
	"function",
	"usecase",
	"design",
	"architecture",
	"data",
	"api",
	"stakeholder",
	"graph",
];

export const TAB_LABELS: Record<WorkbenchTab, string> = {
	scenario: "场景库",
	function: "功能库",
	usecase: "用例库",
	design: "设计库",
	architecture: "架构库",
	data: "数据库",
	api: "接口库",
	stakeholder: "干系人库",
	graph: "关系图",
};

/** Kinds aggregated by each non-graph tab. */
export const TAB_KINDS: Record<Exclude<WorkbenchTab, "graph">, readonly AssetKind[]> = {
	scenario: ["scenario-domain", "scenario", "scenario-variant"],
	function: ["function-domain", "function-item", "function-point"],
	usecase: ["usecase"],
	design: ["design"],
	architecture: ["architecture"],
	data: ["data"],
	api: ["api"],
	stakeholder: ["stakeholder"],
};

/** Map kind → tab for navigation from graph/detail. */
export const KIND_TO_TAB: Record<AssetKind, WorkbenchTab> = Object.fromEntries(
	ASSET_KINDS.map((kind) => {
		for (const [tab, kinds] of Object.entries(TAB_KINDS)) {
			if ((kinds as readonly string[]).includes(kind)) return [kind, tab as WorkbenchTab];
		}
		return [kind, "stakeholder" as WorkbenchTab];
	}),
) as Record<AssetKind, WorkbenchTab>;

/** Kinds that use the hierarchy tree view. */
export const HIERARCHY_KINDS: readonly string[] = [
	"scenario-domain",
	"scenario",
	"scenario-variant",
	"function-domain",
	"function-item",
	"function-point",
];

export const PAGE_SIZE_OPTIONS = [12, 24, 48] as const;

export function emptyKindCounts(): Record<AssetKind, number> {
	return Object.fromEntries(ASSET_KINDS.map((kind) => [kind, 0])) as Record<AssetKind, number>;
}

export function positiveInteger(value: string | null, fallback: number): number {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function isWorkbenchTab(value: string | null): value is WorkbenchTab {
	return value !== null && (TAB_ORDER as readonly string[]).includes(value);
}

export function relationTypeLabel(type: AssetResolvedRelation["type"]): string {
	return type === "contains" ? "包含" : "涉及";
}

export function arrayItemLabel(value: unknown, index: number): string {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		const record = value as Record<string, unknown>;
		for (const key of ["title", "name", "goal", "id"]) {
			if (typeof record[key] === "string" && record[key].length > 0) return record[key];
		}
	}
	return `条目 ${index + 1}`;
}


export function assetContentWarning(kind: AssetKind, content: unknown): string | null {
	if (typeof content !== "object" || content === null || Array.isArray(content)) return "内容不是结构化对象，按原始内容展示。";
	const record = content as Record<string, unknown>;
	if (kind === "stakeholder") {
		if (typeof record.name !== "string" || record.name.trim().length === 0) return "内容缺少有效名称。";
		return null;
	}
	if (HIERARCHY_KINDS.includes(kind)) {
		if (record.schemaVersion !== `asset/${kind}/v1`) return "内容 schema 与资产类型不匹配。";
		if (typeof record.nodeId !== "string" || record.nodeId.length === 0) return "内容缺少有效节点标识。";
		return null;
	}
	return null;
}

// --- Form field definitions (for non-specialized kinds: usecase, design, stakeholder) ---

export type FormFieldType = "text" | "number" | "textarea" | "list" | "number-list" | "object-list";
export interface FormField {
	key: string;
	label: string;
	type: FormFieldType;
	itemFields?: readonly FormField[];
}

const usecaseFields: readonly FormField[] = [
	{ key: "id", label: "标识", type: "text" },
	{ key: "actor", label: "干系人", type: "text" },
	{ key: "goal", label: "目标", type: "text" },
	{ key: "preconditions", label: "前置条件", type: "list" },
	{ key: "mainFlow", label: "主流程", type: "list" },
	{ key: "alternativeFlows", label: "备选流程", type: "list" },
	{ key: "postconditions", label: "后置条件", type: "list" },
];
const designChangeUnitFields: readonly FormField[] = [
	{ key: "id", label: "标识", type: "text" },
	{ key: "area", label: "区域", type: "text" },
	{ key: "change", label: "变更", type: "textarea" },
	{ key: "rationale", label: "理由", type: "textarea" },
	{ key: "sourceRefs", label: "来源引用", type: "object-list", itemFields: [{ key: "type", label: "类型", type: "text" }, { key: "revisionId", label: "版本号", type: "number" }] },
];
const designFields: readonly FormField[] = [
	{ key: "summary", label: "摘要", type: "textarea" },
	{ key: "changeUnits", label: "变更单元", type: "object-list", itemFields: designChangeUnitFields },
	{ key: "alternatives", label: "替代方案", type: "list" },
	{ key: "failureHandling", label: "失败处理", type: "list" },
	{ key: "testStrategy", label: "测试策略", type: "list" },
	{ key: "implementationOrder", label: "实施顺序", type: "list" },
	{ key: "rolloutStrategy", label: "上线策略", type: "textarea" },
	{ key: "rollbackStrategy", label: "回滚策略", type: "textarea" },
];
export const FORM_FIELDS: Partial<Record<AssetKind, readonly FormField[]>> = {
	design: designFields,
	usecase: [{ key: "summary", label: "摘要", type: "textarea" }, { key: "useCases", label: "用例", type: "object-list", itemFields: usecaseFields }],
};

export const RELATION_TARGETS: Record<AssetKind, readonly { kind: AssetKind; type: "contains" | "involves" }[]> = {
	"scenario-domain": [{ kind: "scenario" as AssetKind, type: "contains" as const }],
	scenario: [{ kind: "scenario-variant" as AssetKind, type: "contains" as const }],
	"scenario-variant": [{ kind: "usecase" as AssetKind, type: "contains" as const }, { kind: "stakeholder" as AssetKind, type: "involves" as const }],
	"function-domain": [{ kind: "function-item" as AssetKind, type: "contains" as const }],
	"function-item": [{ kind: "function-point" as AssetKind, type: "contains" as const }],
	"function-point": [{ kind: "api" as AssetKind, type: "contains" as const }, { kind: "data" as AssetKind, type: "contains" as const }],
	usecase: [{ kind: "function-domain" as AssetKind, type: "contains" as const }, { kind: "stakeholder" as AssetKind, type: "involves" as const }],
	design: [{ kind: "architecture" as AssetKind, type: "contains" as const }],
	architecture: [{ kind: "api" as AssetKind, type: "contains" as const }, { kind: "data" as AssetKind, type: "contains" as const }],
	data: [],
	api: [],
	stakeholder: [],
};

/** Kinds that use specialized views instead of generic forms. */
export const SPECIALIZED_VIEW_KINDS: Record<string, true> = Object.fromEntries(
	["api", "data", "architecture", ...HIERARCHY_KINDS].map((kind) => [kind, true]),
);

export function createDraft(kind: AssetKind): Record<string, unknown> {
	if (kind === "stakeholder") return { name: "", description: "" };
	const isHierarchy = HIERARCHY_KINDS.includes(kind);
	const draft: Record<string, unknown> = {
		schemaVersion: isHierarchy ? `asset/${kind}/v1` : `artifact/${kind}/v1`,
		...(isHierarchy ? {} : { artifactKind: kind }),
		...(isHierarchy ? {} : { sourceRefs: [] as unknown[] }),
	};
	const fields = FORM_FIELDS[kind] ?? [];
	for (const field of fields) draft[field.key] = field.type === "list" || field.type === "number-list" || field.type === "object-list" ? [] : "";
	return draft;
}
