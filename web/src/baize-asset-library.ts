import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { sharedStyles } from "./baize-styles.js";
import {
	ASSET_KINDS, assetKindLabel, createAsset, deleteAsset, exportAssets, getAsset, getAssetGraph, listAssets, updateAsset,
	previewImportBundle, commitImportBundle, getHierarchyRoots, getHierarchyChildren, searchHierarchyNodes, createHierarchySubtree, moveHierarchySubtree, deleteAssetSubtree, previewSubtreeDeletion,
	AssetMutationError,
	type AssetDetail, type AssetGraph, type AssetKind, type AssetPage, type AssetRelationExport, type AssetResolvedRelation, type AssetSummary, type AssetValidationError,
	type HierarchyPage, type HierarchyRoot, type HierarchyChild, type HierarchySearchResult, type ImportPreviewResult, type SubtreeCreateResult,
} from "./workflow-client.js";
import { fieldTitle } from "./artifact-labels.js";
import { BaizeApiSwagger } from "./baize-api-swagger.js";
import { BaizeDataCatalog } from "./baize-data-catalog.js";
import { BaizeArchitectureDiagram } from "./baize-architecture-diagram.js";
import { BaizeHierarchyTree } from "./baize-hierarchy-tree.js";

// --- 9 aggregated workbench tabs (fixed order) ---

type WorkbenchTab = "scenario" | "function" | "usecase" | "design" | "architecture" | "data" | "api" | "stakeholder" | "graph";

const TAB_ORDER: readonly WorkbenchTab[] = ["scenario", "function", "usecase", "design", "architecture", "data", "api", "stakeholder", "graph"];

const TAB_LABELS: Record<WorkbenchTab, string> = {
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
const TAB_KINDS: Record<Exclude<WorkbenchTab, "graph">, readonly AssetKind[]> = {
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
const KIND_TO_TAB: Record<AssetKind, WorkbenchTab> = Object.fromEntries(
	ASSET_KINDS.map((kind) => {
		for (const [tab, kinds] of Object.entries(TAB_KINDS)) {
			if ((kinds as readonly string[]).includes(kind)) return [kind, tab as WorkbenchTab];
		}
		return [kind, "stakeholder" as WorkbenchTab];
	}),
) as Record<AssetKind, WorkbenchTab>;

/** Kinds that use the hierarchy tree view. */
const HIERARCHY_KINDS: readonly string[] = ["scenario-domain", "scenario", "scenario-variant", "function-domain", "function-item", "function-point"];

type Renderable = ReturnType<typeof html> | typeof nothing;
const PAGE_SIZE_OPTIONS = [12, 24, 48] as const;

function emptyKindCounts(): Record<AssetKind, number> {
	return Object.fromEntries(ASSET_KINDS.map((kind) => [kind, 0])) as Record<AssetKind, number>;
}

function positiveInteger(value: string | null, fallback: number): number {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isWorkbenchTab(value: string | null): value is WorkbenchTab {
	return value !== null && (TAB_ORDER as readonly string[]).includes(value);
}

function relationTypeLabel(type: AssetResolvedRelation["type"]): string {
	return type === "contains" ? "包含" : "涉及";
}

function arrayItemLabel(value: unknown, index: number): string {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		const record = value as Record<string, unknown>;
		for (const key of ["title", "name", "goal", "id"]) {
			if (typeof record[key] === "string" && record[key].length > 0) return record[key];
		}
	}
	return `条目 ${index + 1}`;
}

function assetKey(kind: AssetKind, title: string): string {
	return `${kind}\u0000${title}`;
}

function assetContentWarning(kind: AssetKind, content: unknown): string | null {
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

type FormFieldType = "text" | "number" | "textarea" | "list" | "number-list" | "object-list";
interface FormField {
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
const designChangeUnitFields: readonly FormField[] = [{ key: "id", label: "标识", type: "text" }, { key: "area", label: "区域", type: "text" }, { key: "change", label: "变更", type: "textarea" }, { key: "rationale", label: "理由", type: "textarea" }, { key: "sourceRefs", label: "来源引用", type: "object-list", itemFields: [{ key: "type", label: "类型", type: "text" }, { key: "revisionId", label: "版本号", type: "number" }] }];
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
const FORM_FIELDS: Partial<Record<AssetKind, readonly FormField[]>> = {
	design: designFields,
	usecase: [{ key: "summary", label: "摘要", type: "textarea" }, { key: "useCases", label: "用例", type: "object-list", itemFields: usecaseFields }],
};

const RELATION_TARGETS: Record<AssetKind, readonly { kind: AssetKind; type: "contains" | "involves" }[]> = {
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

interface ImportDraft {
	preview: ImportPreviewResult;
	assets: readonly { kind: AssetKind; title: string; content: unknown }[];
	relations: readonly AssetRelationExport[];
}

/** Kinds that use specialized views instead of generic forms. */
const SPECIALIZED_VIEW_KINDS: ReadonlySet<string> = new Set(["api", "data", "architecture", ...HIERARCHY_KINDS]);

class BaizeAssetLibrary extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		activeTab: { state: true },
		query: { state: true },
		page: { state: true },
		pageSize: { state: true },
		total: { state: true },
		kindCounts: { state: true },
		selectedAssetId: { state: true },
		detail: { state: true },
		detailLoading: { state: true },
		detailError: { state: true },
		formMode: { state: true },
		formKind: { state: true },
		formAssetId: { state: true },
		formExpectedRevisionId: { state: true },
		formTitle: { state: true },
		formDraft: { state: true },
		formRelations: { state: true },
		formError: { state: true },
		formFieldErrors: { state: true },
		formSubmitting: { state: true },
		importDraft: { state: true },
		importError: { state: true },
		importSubmitting: { state: true },
		deleteConfirm: { state: true },
		deleteError: { state: true },
		graph: { state: true },
		graphKindFilter: { state: true },
		graphZoom: { state: true },
		graphOffset: { state: true },
		relationCandidates: { state: true },
		relationError: { state: true },
		loading: { state: true },
		error: { state: true },
		expandedNodes: { state: true },
		narrowView: { state: true },
	};

	declare apiBase: string;
	declare workspaceId: number;
	declare activeTab: WorkbenchTab;
	declare query: string;
	declare page: number;
	declare pageSize: number;
	declare total: number;
	declare kindCounts: Readonly<Record<AssetKind, number>>;
	declare selectedAssetId: number | null;
	declare detail: AssetDetail | null;
	declare detailLoading: boolean;
	declare detailError: string | null;
	declare formMode: "create" | "edit" | null;
	declare formKind: AssetKind | null;
	declare formAssetId: number | null;
	declare formExpectedRevisionId: number | null;
	declare formTitle: string;
	declare formDraft: Record<string, unknown> | null;
	declare formRelations: readonly { toAssetId: number; type: "contains" | "involves" }[];
	declare formError: string | null;
	declare formFieldErrors: Record<string, string>;
	declare formSubmitting: boolean;
	declare importDraft: ImportDraft | null;
	declare importError: string | null;
	declare importSubmitting: boolean;
	declare deleteConfirm: boolean;
	declare deleteError: string | null;
	declare graph: AssetGraph | null;
	declare graphKindFilter: AssetKind | null;
	declare graphZoom: number;
	declare graphOffset: { x: number; y: number };
	declare relationCandidates: readonly { assetId: number; kind: AssetKind; title: string }[];
	declare relationError: string | null;
	declare loading: boolean;
	declare error: string | null;
	declare expandedNodes: ReadonlySet<number>;
	declare narrowView: boolean;
	private detailRequestNo = 0;
	private mediaQuery: MediaQueryList | null = null;

	static styles = [sharedStyles, css`
		:host {
			display: block;
			--asset-toolbar-offset: 8.5rem;
			--asset-mobile-toolbar-offset: 11rem;
			--asset-list-min-width: 15rem;
			--asset-pane-height: min(68vh, 42rem);
			--asset-placeholder-height: 11rem;
			--asset-fact-min-width: 7.5rem;
			--asset-graph-node-width: 8.125rem;
			--asset-graph-edge-width: 0.125rem;
			--asset-graph-node-height: 2.25rem;
		}
		.workspace { display: grid; gap: var(--gap); }
		.toolbar {
			position: sticky; top: 0; z-index: 2;
			display: grid; gap: var(--gap); padding: var(--pad) 0;
			background: var(--bg); border-bottom: 1px solid var(--border);
		}
		.toolbar-head { display: flex; align-items: start; justify-content: space-between; gap: var(--gap); }
		.heading { min-width: 0; }
		.heading h1 { margin: 0; font: 600 var(--text-display) var(--font-display); }
		.sub { margin: var(--space-2xs) 0 0; color: var(--text-muted); font-size: var(--text-base); }
		.count { color: var(--text-subtle); font: 600 var(--text-sm) var(--font-mono); white-space: nowrap; }
		.toolbar-actions { display: flex; align-items: center; justify-content: flex-start; gap: var(--gap); flex-wrap: wrap; }
		.search { width: min(280px, 30vw); }
		.tabs {
			position: sticky; top: var(--asset-toolbar-offset); z-index: 2;
			display: flex; gap: var(--space-2xs); overflow-x: auto;
			padding: var(--space-2xs) 0;
			background: var(--bg); border-bottom: 1px solid var(--border);
		}
		.tab { border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: var(--space-2xs) var(--gap); color: var(--text-muted); }
		.tab:hover { color: var(--text); }
		.tab.active { border-bottom-color: var(--accent); color: var(--accent); font-weight: 600; }
		.tab-count { margin-left: var(--space-2xs); color: var(--text-subtle); font: var(--text-xs) var(--font-mono); }
		.content { display: grid; grid-template-columns: minmax(var(--asset-list-min-width), 0.8fr) minmax(0, 1.4fr); gap: var(--gap); min-height: 0; }
		.pane { min-width: 0; height: var(--asset-pane-height); overflow: auto; }
		.list-pane { padding: var(--gap); }
		.detail-pane { padding: var(--gap); }
		.list { display: grid; gap: var(--space-2xs); }
		.asset-row { width: 100%; display: grid; gap: var(--space-2xs); text-align: left; border-color: transparent; border-left: 2px solid transparent; padding: var(--gap); }
		.asset-row:hover { border-color: var(--border); }
		.asset-row.selected { border-left-color: var(--accent); background: var(--surface-2); }
		.row-head { display: flex; align-items: center; gap: var(--space-2xs); min-width: 0; }
		.kind { color: var(--accent-hi); font-size: var(--text-xs); letter-spacing: 0.04em; }
		.title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
		.meta { color: var(--text-muted); font-size: var(--text-sm); }
		.digest { color: var(--text-subtle); font: var(--text-xs) var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.pager { display: flex; align-items: center; justify-content: space-between; gap: var(--gap); margin-top: var(--gap); color: var(--text-muted); font-size: var(--text-sm); }
		.pager-actions { display: flex; gap: var(--space-2xs); }
		.selected-note { margin: 0 0 var(--gap); color: var(--warn); font-size: var(--text-sm); }
		.detail-placeholder { display: grid; place-items: center; min-height: var(--asset-placeholder-height); color: var(--text-muted); text-align: center; }
		.detail { display: grid; gap: var(--gap); }
		.detail-head { display: flex; align-items: start; justify-content: space-between; gap: var(--gap); }
		.detail-title { margin: 0; font: 600 var(--text-xl) var(--font-display); overflow-wrap: anywhere; }
		.detail-sub { margin: var(--space-2xs) 0 0; color: var(--text-muted); font-size: var(--text-sm); }
		.detail-block { border-top: 1px solid var(--border); padding-top: var(--gap); }
		.detail-block h2 { margin: 0 0 var(--space-2xs); font-size: var(--text-base); }
		.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--asset-fact-min-width), 1fr)); gap: var(--space-2xs); margin: 0; }
		.fact dt { color: var(--text-subtle); font-size: var(--text-xs); }
		.fact dd { margin: var(--space-2xs) 0 0; overflow-wrap: anywhere; }
		.field-list { display: grid; gap: var(--space-2xs); margin: 0; }
		.field dt { color: var(--text-muted); font-size: var(--text-sm); }
		.field dd { margin: var(--space-2xs) 0 0; }
		.value-list { display: grid; gap: var(--space-2xs); padding-left: var(--pad); }
		.value { white-space: pre-wrap; overflow-wrap: anywhere; }
		.array-item { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-2xs) var(--gap); }
		.array-item summary { cursor: pointer; color: var(--text); }
		.relations { display: grid; gap: var(--space-2xs); }
		.relation-group h3 { margin: 0 0 var(--space-2xs); color: var(--text-muted); font-size: var(--text-sm); }
		.relation { width: 100%; text-align: left; }
		pre.raw { margin: var(--space-2xs) 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
		.form { display: grid; gap: var(--gap); }
		.form h2 { margin: 0; font: 600 var(--text-xl) var(--font-display); }
		.form-field { display: grid; gap: var(--space-2xs); }
		.form-field > label, .form-field legend { color: var(--text-muted); font-size: var(--text-sm); }
		.form-field input, .form-field textarea, .form-field select { width: 100%; }
		.array-editor { display: grid; gap: var(--space-2xs); }
		.graph-controls { display: flex; gap: var(--space-2xs); align-items: center; margin-bottom: var(--gap); }
		.graph-canvas { position: relative; width: 100%; min-height: var(--asset-placeholder-height); overflow: hidden; border: 1px solid var(--border); background: var(--bg); }
		.graph-layer { position: relative; transform-origin: top left; }
		.graph-edge { position: absolute; height: 0; border-top: var(--asset-graph-edge-width) solid var(--border-strong); transform-origin: left center; pointer-events: none; }
		.graph-node { position: absolute; width: var(--asset-graph-node-width); min-height: var(--asset-graph-node-height); display: grid; gap: var(--space-2xs); text-align: left; cursor: pointer; }
		.graph-node span { color: var(--accent); font-size: var(--text-xs); }
		.graph-node strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.array-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2xs); align-items: start; }
		.array-actions { display: flex; gap: var(--space-2xs); flex-wrap: wrap; }
		.array-actions button { padding: var(--space-2xs) var(--gap); font-size: var(--text-xs); }
		.form-actions { display: flex; gap: var(--space-2xs); }
		.form-error { color: var(--danger); font-size: var(--text-sm); }
		.import-preview { display: grid; gap: var(--space-2xs); padding: var(--gap); }
		.import-preview h2 { margin: 0; font-size: var(--text-base); }
		.danger-zone { display: flex; gap: var(--space-2xs); align-items: center; flex-wrap: wrap; }
		.file-input { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; clip-path: inset(50%); }
		.file-button { display: inline-flex; align-items: center; position: relative; padding: var(--space-2xs) var(--pad); border: 1px solid var(--border-strong); border-radius: var(--radius); color: var(--text); cursor: pointer; white-space: nowrap; }
		.file-button:hover { background: var(--surface-hover); }
		.file-button:focus-within { outline: var(--focus-ring); outline-offset: 1px; }
		.mobile-back { display: none; }
		@media (max-width: 900px) {
			.toolbar { top: 0; }
			.toolbar-actions { align-items: stretch; }
			.search { width: 100%; flex: 1 1 100%; }
			.tabs { top: var(--asset-mobile-toolbar-offset); }
			.content { grid-template-columns: minmax(0, 1fr); }
			.pane { height: auto; max-height: none; overflow: visible; }
			.detail-pane { min-height: var(--asset-placeholder-height); }
			.mobile-back { display: inline-flex; }
		}
	`];

	constructor() {
		super();
		this.apiBase = "";
		this.workspaceId = 0;
		this.activeTab = "scenario";
		this.query = "";
		this.page = 1;
		this.pageSize = 12;
		this.total = 0;
		this.kindCounts = emptyKindCounts();
		this.selectedAssetId = null;
		this.detail = null;
		this.formMode = null;
		this.formKind = null;
		this.formAssetId = null;
		this.formExpectedRevisionId = null;
		this.formTitle = "";
		this.formDraft = null;
		this.formRelations = [];
		this.formError = null;
		this.formFieldErrors = {};
		this.formSubmitting = false;
		this.importDraft = null;
		this.importError = null;
		this.importSubmitting = false;
		this.deleteConfirm = false;
		this.deleteError = null;
		this.graph = null;
		this.graphKindFilter = null;
		this.graphZoom = 1;
		this.graphOffset = { x: 0, y: 0 };
		this.relationCandidates = [];
		this.relationError = null;
		this.loading = true;
		this.error = null;
		this.expandedNodes = new Set();
		this.narrowView = false;
		this.readUrl();
	}

	connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener("popstate", this.handlePopState);
		this.mediaQuery = window.matchMedia("(max-width: 1023px)");
		this.narrowView = this.mediaQuery.matches;
		this.mediaQuery.addEventListener("change", this.handleMediaChange);
		void this.load();
		if (this.selectedAssetId !== null) void this.loadDetail(this.selectedAssetId);
	}

	disconnectedCallback(): void {
		window.removeEventListener("popstate", this.handlePopState);
		this.mediaQuery?.removeEventListener("change", this.handleMediaChange);
		super.disconnectedCallback();
	}

	protected updated(changed: Map<string, unknown>): void {
		if ((changed.has("workspaceId") || changed.has("apiBase")) && this.workspaceId > 0 && this.isConnected) void this.load();
	}

	private readonly handlePopState = (): void => {
		this.readUrl();
		void this.load();
		if (this.selectedAssetId !== null) void this.loadDetail(this.selectedAssetId);
	};

	private readonly handleMediaChange = (event: MediaQueryListEvent): void => {
		this.narrowView = event.matches;
	};

	private readUrl(): void {
		const params = new URLSearchParams(window.location.search);
		const tab = params.get("tab");
		this.activeTab = isWorkbenchTab(tab) ? tab : "scenario";
		this.query = params.get("q") ?? "";
		this.page = positiveInteger(params.get("page"), 1);
		this.pageSize = positiveInteger(params.get("pageSize"), 12);
		const selected = params.get("selectedAssetId");
		this.selectedAssetId = selected === null ? null : positiveInteger(selected, 0) || null;
		const graphKind = params.get("graphKind");
		this.graphKindFilter = graphKind !== null && ASSET_KINDS.includes(graphKind as AssetKind) ? graphKind as AssetKind : null;
		const zoom = Number(params.get("graphZoom"));
		this.graphZoom = Number.isFinite(zoom) && zoom >= 0.6 && zoom <= 2 ? zoom : 1;
		this.graphOffset = { x: Number(params.get("graphX")) || 0, y: Number(params.get("graphY")) || 0 };
		const expanded = params.get("expandedNodes");
		if (expanded !== null) {
			this.expandedNodes = new Set(expanded.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0));
		} else {
			this.expandedNodes = new Set();
		}
	}

	private updateUrl(changes: Partial<{ tab: WorkbenchTab; q: string; page: number; pageSize: number; selectedAssetId: number | null; graphKind: AssetKind | null; graphZoom: number; graphX: number; graphY: number; expandedNodes: string }>, replace = false): void {
		const params = new URLSearchParams(window.location.search);
		if (changes.tab !== undefined) params.set("tab", changes.tab);
		if (changes.q !== undefined) changes.q.length > 0 ? params.set("q", changes.q) : params.delete("q");
		if (changes.page !== undefined) params.set("page", String(changes.page));
		if (changes.pageSize !== undefined) params.set("pageSize", String(changes.pageSize));
		if (changes.selectedAssetId !== undefined) {
			if (changes.selectedAssetId === null) params.delete("selectedAssetId");
			else params.set("selectedAssetId", String(changes.selectedAssetId));
		}
		if (changes.graphKind !== undefined) {
			if (changes.graphKind === null) params.delete("graphKind");
			else params.set("graphKind", changes.graphKind);
		}
		if (changes.graphZoom !== undefined) params.set("graphZoom", String(changes.graphZoom));
		if (changes.graphX !== undefined) params.set("graphX", String(changes.graphX));
		if (changes.graphY !== undefined) params.set("graphY", String(changes.graphY));
		if (changes.expandedNodes !== undefined) {
			if (changes.expandedNodes.length > 0) params.set("expandedNodes", changes.expandedNodes);
			else params.delete("expandedNodes");
		}
		const query = params.toString();
		const url = query.length > 0 ? `/assets?${query}` : "/assets";
		if (replace) window.history.replaceState({}, "", url);
		else window.history.pushState({}, "", url);
		this.readUrl();
	}

	private async load(): Promise<void> {
		if (this.workspaceId <= 0) return;
		if (this.activeTab === "graph") {
			await Promise.all([this.loadGraph(), this.loadKindCounts()]);
			return;
		}
		const tabKinds = TAB_KINDS[this.activeTab];
		if (this.activeTab === "scenario" || this.activeTab === "function") {
			await this.loadHierarchyRoots(tabKinds[0]!);
			return;
		}
		this.loading = true;
		this.error = null;
		try {
			const kind = tabKinds[0]!;
			const result: AssetPage = await listAssets(this.apiBase, this.workspaceId, {
				page: this.page, pageSize: this.pageSize, kind, q: this.query,
			});
			this.assets = result.assets;
			this.total = result.total;
			this.page = result.page;
			this.pageSize = result.pageSize;
			this.kindCounts = result.kindCounts;
			if (this.selectedAssetId === null && result.assets[0]) {
				this.selectedAssetId = result.assets[0].id;
				this.updateUrl({ selectedAssetId: this.selectedAssetId }, true);
				void this.loadDetail(this.selectedAssetId);
			}
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
		}
	}

	declare assets: readonly (AssetSummary | HierarchyRoot)[];

	private async loadHierarchyRoots(rootKind: AssetKind): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const result: HierarchyPage = await getHierarchyRoots(this.apiBase, this.workspaceId, rootKind, { page: this.page, pageSize: this.pageSize });
			this.assets = result.roots;
			this.total = result.total;
			this.page = result.page;
			this.pageSize = result.pageSize;
			this.kindCounts = result.kindCounts;
			if (this.selectedAssetId === null && result.roots[0]) {
				this.selectedAssetId = result.roots[0].assetId;
				this.updateUrl({ selectedAssetId: this.selectedAssetId }, true);
				void this.loadDetail(this.selectedAssetId);
			}
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
		}
	}

	private async loadDetail(assetId: number): Promise<void> {
		const requestNo = ++this.detailRequestNo;
		this.detailLoading = true;
		this.detailError = null;
		try {
			const detail = await getAsset(this.apiBase, assetId);
			if (requestNo === this.detailRequestNo) this.detail = detail;
		} catch (error) {
			if (requestNo === this.detailRequestNo) {
				this.detail = null;
				this.detailError = error instanceof Error ? error.message : String(error);
			}
		} finally {
			if (requestNo === this.detailRequestNo) this.detailLoading = false;
		}
	}

	private async loadGraph(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			this.graph = await getAssetGraph(this.apiBase, this.workspaceId);
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
		}
	}

	private async loadKindCounts(): Promise<void> {
		try {
			const result = await listAssets(this.apiBase, this.workspaceId, { page: 1, pageSize: 1, kind: "design" });
			this.kindCounts = result.kindCounts;
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		}
	}

	private async loadRelationCandidates(kind: AssetKind): Promise<void> {
		const targetKinds = new Set(RELATION_TARGETS[kind].map((target) => target.kind));
		if (targetKinds.size === 0) {
			this.relationCandidates = [];
			return;
		}
		try {
			const graph = await getAssetGraph(this.apiBase, this.workspaceId);
			this.relationCandidates = graph.nodes
				.filter((node) => targetKinds.has(node.kind))
				.map((node) => ({ assetId: node.assetId, kind: node.kind, title: node.title }));
		} catch (error) {
			this.relationCandidates = [];
			this.relationError = error instanceof Error ? error.message : "关联资产加载失败。";
		}
	}

	private createDraft(kind: AssetKind): Record<string, unknown> {
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

	private draftValue(path: readonly string[]): unknown {
		let value: unknown = this.formDraft;
		for (const key of path) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
			value = (value as Record<string, unknown>)[key];
		}
		return value;
	}

	private setDraftValue(path: readonly string[], value: unknown): void {
		if (!this.formDraft || path.length === 0) return;
		let target = this.formDraft;
		for (const key of path.slice(0, -1)) {
			const current = target[key];
			if (typeof current !== "object" || current === null) target[key] = {};
			target = target[key] as Record<string, unknown>;
		}
		target[path[path.length - 1] as string] = value;
		this.formDraft = { ...this.formDraft };
	}

	private openCreate(): void {
		if (this.activeTab === "graph") return;
		const kinds = TAB_KINDS[this.activeTab];
		const kind = kinds[0]!;
		if (SPECIALIZED_VIEW_KINDS.has(kind)) return; // specialized views handle creation internally
		this.formKind = kind;
		this.formMode = "create";
		this.formAssetId = null;
		this.formExpectedRevisionId = null;
		this.formTitle = "";
		this.formDraft = this.createDraft(kind);
		this.formRelations = [];
		this.formError = null;
		this.relationError = null;
		void this.loadRelationCandidates(kind);
	}

	private openEdit(): void {
		const detail = this.detail;
		const current = detail?.revisions.find((revision) => revision.id === detail.currentRevisionId) ?? detail?.revisions.at(-1);
		if (!detail || !current) return;
		const content = typeof current.content === "object" && current.content !== null && !Array.isArray(current.content)
			? JSON.parse(JSON.stringify(current.content)) as Record<string, unknown>
			: {};
		this.formMode = "edit";
		this.formKind = detail.kind;
		this.formAssetId = detail.id;
		this.formExpectedRevisionId = current.id;
		this.formTitle = detail.title;
		this.formDraft = content;
		this.formRelations = detail.resolvedGraph.outgoing.map((relation) => ({ toAssetId: relation.assetId, type: relation.type }));
		this.formError = null;
		this.relationError = null;
		void this.loadRelationCandidates(detail.kind);
	}

	private cancelForm(): void {
		this.formMode = null;
		this.formKind = null;
		this.formAssetId = null;
		this.formExpectedRevisionId = null;
		this.formDraft = null;
		this.formRelations = [];
		this.formError = null;
	}

	private updateArrayItem(path: readonly string[], index: number, value: unknown): void {
		const current = this.draftValue(path);
		if (!Array.isArray(current)) return;
		const next = [...current];
		next[index] = value;
		this.setDraftValue(path, next);
	}

	private addArrayItem(field: FormField, path: readonly string[]): void {
		const current = this.draftValue(path);
		if (!Array.isArray(current)) return;
		let value: unknown = field.type === "object-list"
			? Object.fromEntries((field.itemFields ?? []).map((item) => [item.key, item.type === "list" || item.type === "number-list" || item.type === "object-list" ? [] : ""]))
			: "";
		if (field.key === "changeUnits" && typeof value === "object" && value !== null && !Array.isArray(value)) {
			(value as Record<string, unknown>).sourceRefs = [{ type: "requirement_revision", revisionId: 1 }];
		}
		this.setDraftValue(path, [...current, value]);
	}

	private removeArrayItem(path: readonly string[], index: number): void {
		const current = this.draftValue(path);
		if (!Array.isArray(current)) return;
		this.setDraftValue(path, current.filter((_, currentIndex) => currentIndex !== index));
	}

	private moveArrayItem(path: readonly string[], index: number, direction: -1 | 1): void {
		const current = this.draftValue(path);
		if (!Array.isArray(current)) return;
		const nextIndex = index + direction;
		if (nextIndex < 0 || nextIndex >= current.length) return;
		const next = [...current];
		[next[index], next[nextIndex]] = [next[nextIndex], next[index]];
		this.setDraftValue(path, next);
	}

	private renderFormField(field: FormField, path: readonly string[]): Renderable {
		if (this.formMode === "edit" && typeof this.detail?.originArtifactId === "number" && field.key === "sourceRefs") return nothing;
		const value = this.draftValue(path);
		if (field.type === "list" || field.type === "number-list") {
			const values = Array.isArray(value) ? value : [];
			return html`<fieldset class="form-field">
				<legend>${field.label}</legend>
				<div class="array-editor">
					${values.map((item, index) => html`<div class="array-row">
						<input type=${field.type === "number-list" ? "number" : "text"} .value=${String(item)} @input=${(event: Event) => this.updateArrayItem(path, index, field.type === "number-list" ? Number((event.target as HTMLInputElement).value) : (event.target as HTMLInputElement).value)} />
						<span class="array-actions">
							<button type="button" @click=${() => this.moveArrayItem(path, index, -1)} aria-label="上移">↑</button>
							<button type="button" @click=${() => this.moveArrayItem(path, index, 1)} aria-label="下移">↓</button>
							<button type="button" @click=${() => this.removeArrayItem(path, index)} aria-label="删除">删除</button>
						</span>
					</div>`)}
					<button type="button" @click=${() => this.addArrayItem(field, path)}>添加${field.label}</button>
				</div>
			</fieldset>`;
		}
		if (field.type === "object-list") {
			const values = Array.isArray(value) ? value : [];
			return html`<fieldset class="form-field">
				<legend>${field.label}</legend>
				<div class="array-editor">
					${values.map((item, index) => html`<details class="array-item" open>
						<summary>${arrayItemLabel(item, index)}</summary>
						${typeof item === "object" && item !== null && !Array.isArray(item)
							? html`${(field.itemFields ?? []).map((child) => this.renderFormField(child, [...path, String(index), child.key]))}`
							: html`<p class="form-error">该条目格式无效。</p>`}
						<div class="array-actions">
							<button type="button" @click=${() => this.moveArrayItem(path, index, -1)}>上移</button>
							<button type="button" @click=${() => this.moveArrayItem(path, index, 1)}>下移</button>
							<button type="button" @click=${() => this.removeArrayItem(path, index)}>删除</button>
						</div>
					</details>`)}
					<button type="button" @click=${() => this.addArrayItem(field, path)}>添加${field.label}</button>
				</div>
			</fieldset>`;
		}
		const valueText = typeof value === "number" || typeof value === "string" ? String(value) : "";
		return html`<div class="form-field">
			<label>${field.label}
				${field.type === "textarea"
					? html`<textarea rows="3" .value=${valueText} @input=${(event: Event) => this.setDraftValue(path, (event.target as HTMLTextAreaElement).value)}></textarea>`
					: html`<input type=${field.type === "number" ? "number" : "text"} .value=${valueText} @input=${(event: Event) => this.setDraftValue(path, field.type === "number" ? Number((event.target as HTMLInputElement).value) : (event.target as HTMLInputElement).value)} />`}
			</label>
			${this.formFieldErrors[field.key] ? html`<p class="form-error form-field-error">${this.formFieldErrors[field.key]}</p>` : nothing}
		</div>`;
	}

	private renderFormRelations(): Renderable {
		if (!this.formKind) return nothing;
		const validTargets = RELATION_TARGETS[this.formKind];
		const candidates = this.relationCandidates;
		if (this.relationError) return html`<p class="form-error" role="alert">关联资产加载失败：${this.relationError}</p>`;
		if (candidates.length === 0) return html`<p class="detail-sub">当前类型没有可选的直接关系目标。</p>`;
		return html`<fieldset class="form-field">
			<legend>关联资产</legend>
			<div class="relations">
				${candidates.map((asset) => validTargets.filter((target) => target.kind === asset.kind).map((target) => {
					const checked = this.formRelations.some((relation) => relation.toAssetId === asset.assetId && relation.type === target.type);
					return html`<label><input type="checkbox" .checked=${checked} @change=${(event: Event) => {
						const next = this.formRelations.filter((relation) => !(relation.toAssetId === asset.assetId && relation.type === target.type));
						if ((event.target as HTMLInputElement).checked) next.push({ toAssetId: asset.assetId, type: target.type });
						this.formRelations = next;
					}} /> ${relationTypeLabel(target.type)} · ${assetKindLabel(asset.kind)} · ${asset.title}</label>`;
				}))}
			</div>
		</fieldset>`;
	}

	private async submitForm(event: Event): Promise<void> {
		event.preventDefault();
		if (this.formMode === null || this.formKind === null || this.formDraft === null || this.workspaceId <= 0) return;
		const mode = this.formMode;
		const kind = this.formKind;
		const assetId = this.formAssetId;
		const expectedRevisionId = this.formExpectedRevisionId;
		const title = this.formTitle.trim();
		if (title.length === 0) {
			this.formError = "标题不能为空。";
			return;
		}
		const content = kind === "stakeholder" ? { ...this.formDraft, name: title } : this.formDraft;
		this.formSubmitting = true;
		this.formError = null;
		try {
			const result = mode === "create"
				? await createAsset(this.apiBase, this.workspaceId, { kind, title, content, relations: this.formRelations })
				: assetId !== null && expectedRevisionId !== null
					? await updateAsset(this.apiBase, assetId, { expectedRevisionId, title, content, relations: this.formRelations })
					: undefined;
			if (!result) throw new Error("无法确定待更新的资产版本。");
			this.cancelForm();
			this.selectedAssetId = result.assetId;
			this.updateUrl({ selectedAssetId: result.assetId });
			await this.load();
			await this.loadDetail(result.assetId);
		} catch (error) {
			if (error instanceof AssetMutationError) {
				this.formError = error.message;
				this.formFieldErrors = {};
				for (const ve of error.validationErrors) {
					const key = ve.path.split("/").filter(Boolean).pop() ?? "";
					if (key) this.formFieldErrors[key] = ve.message;
				}
			} else {
				this.formError = error instanceof Error ? error.message : String(error);
				this.formFieldErrors = {};
			}
		} finally {
			this.formSubmitting = false;
		}
	}

	private async handleImportFile(event: Event): Promise<void> {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = "";
		if (!file) return;
		try {
			const parsed: unknown = JSON.parse(await file.text());
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("导入文件必须是 JSON 对象。");
			const record = parsed as Record<string, unknown>;
			if (!Array.isArray(record.assets)) throw new Error("导入文件缺少 assets 数组。");
			const assets: Array<{ kind: AssetKind; title: string; content: unknown }> = [];
			for (const item of record.assets) {
				if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("资产条目格式无效。");
				const value = item as Record<string, unknown>;
				const kind = value.kind;
				const title = value.title;
				let content = value.content;
				if (content === undefined && Array.isArray(value.revisions)) {
					const current = value.revisions.at(-1);
					if (typeof current === "object" && current !== null && !Array.isArray(current)) content = (current as Record<string, unknown>).content;
				}
				if (typeof kind !== "string" || !ASSET_KINDS.includes(kind as AssetKind) || typeof title !== "string" || content === undefined) throw new Error("资产条目必须包含有效 kind、title 和 content。");
				// Auto-supplement BaiZe extension fields for pure OpenAPI import
				if (kind === "api" && typeof content === "object" && content !== null && !Array.isArray(content) && !("schemaVersion" in content)) {
					const apiContent = content as Record<string, unknown>;
					const info = apiContent.info as Record<string, unknown> | undefined;
					apiContent.schemaVersion = "asset/api/v1";
					apiContent.artifactKind = "api";
					apiContent.summary = typeof info?.title === "string" ? info.title : "Imported API";
					apiContent.sourceRefs = [];
					content = apiContent;
				}
				assets.push({ kind: kind as AssetKind, title, content });
			}
			let relations: AssetRelationExport[] = [];
			if (record.relations !== undefined) {
				if (!Array.isArray(record.relations)) throw new Error("relations 必须是数组。");
				relations = [];
				for (const item of record.relations) {
					if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("关系条目格式无效。");
					const value = item as Record<string, unknown>;
					if (typeof value.fromTitle !== "string" || typeof value.toTitle !== "string" || typeof value.fromKind !== "string" || typeof value.toKind !== "string" || (value.type !== "contains" && value.type !== "involves")) throw new Error("关系条目字段无效。");
					if (!ASSET_KINDS.includes(value.fromKind as AssetKind) || !ASSET_KINDS.includes(value.toKind as AssetKind)) throw new Error("关系条目 kind 无效。");
					relations.push({ fromTitle: value.fromTitle, fromKind: value.fromKind as AssetKind, toTitle: value.toTitle, toKind: value.toKind as AssetKind, type: value.type });
				}
			}
			const preview = await previewImportBundle(this.apiBase, this.workspaceId, assets, relations);
			this.importDraft = { preview, assets, relations };
			this.importError = null;
		} catch (error) {
			this.importDraft = null;
			this.importError = error instanceof Error ? error.message : String(error);
		}
	}

	private async confirmImport(): Promise<void> {
		if (!this.importDraft || this.workspaceId <= 0) return;
		this.importSubmitting = true;
		this.importError = null;
		try {
			const ids = await commitImportBundle(this.apiBase, this.workspaceId, this.importDraft.assets, this.importDraft.relations, this.importDraft.preview.previewDigest);
			this.importDraft = null;
			if (ids[0]) {
				this.selectedAssetId = ids[0];
				this.updateUrl({ selectedAssetId: ids[0] }, true);
			}
			await this.load();
			if (ids[0]) await this.loadDetail(ids[0]);
		} catch (error) {
			this.importError = error instanceof Error ? error.message : String(error);
		} finally {
			this.importSubmitting = false;
		}
	}

	private async exportWorkspace(): Promise<void> {
		try {
			const bundle = await exportAssets(this.apiBase, this.workspaceId);
			const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
			const a = document.createElement("a");
			a.href = url;
			a.download = `assets-${this.workspaceId}.json`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		}
	}

	private requestDelete(): void {
		this.deleteConfirm = true;
		this.deleteError = null;
	}

	private async confirmDelete(): Promise<void> {
		const detail = this.detail;
		if (!detail) return;
		const references = [...detail.resolvedGraph.incoming, ...detail.resolvedGraph.outgoing];
		if (references.length > 0) {
			const referenceDetails = references.map((reference) => `${assetKindLabel(reference.kind)}「${reference.title}」·${relationTypeLabel(reference.type)}`).join("、");
			this.deleteError = `该资产仍被以下 ${references.length} 个资产引用，无法删除：${referenceDetails}`;
			return;
		}
		try {
			await deleteAsset(this.apiBase, detail.id);
			this.deleteConfirm = false;
			this.detail = null;
			this.selectedAssetId = null;
			this.updateUrl({ selectedAssetId: null }, true);
			await this.load();
		} catch (error) {
			this.deleteError = error instanceof Error ? error.message : String(error);
		}
	}

	private renderForm(): Renderable {
		if (this.formMode === null || this.formKind === null || this.formDraft === null) return nothing;
		const fields = FORM_FIELDS[this.formKind] ?? [];
		return html`<form class="form" @submit=${(event: Event) => void this.submitForm(event)}>
			<header><h2>${this.formMode === "create" ? "新建" : "编辑"}${assetKindLabel(this.formKind)}资产</h2><p class="detail-sub">严格遵循当前类型 v1 业务字段。</p></header>
			<div class="form-field"><label>资产标题<input required .value=${this.formTitle} @input=${(event: Event) => { const value = (event.target as HTMLInputElement).value; this.formTitle = value; if (this.formKind === "stakeholder") this.setDraftValue(["name"], value); }} /></label></div>
			${fields.map((field) => this.renderFormField(field, [field.key]))}
			${this.renderFormRelations()}
			${this.formError ? html`<p class="form-error" role="alert">${this.formError}</p>` : ""}
			<div class="form-actions">
				<button class="primary" type="submit" ?disabled=${this.formSubmitting}>${this.formSubmitting ? "保存中…" : "保存资产"}</button>
				<button type="button" @click=${() => this.cancelForm()}>取消</button>
			</div>
		</form>`;
	}

	private chooseTab(tab: WorkbenchTab): void {
		this.updateUrl({ tab, page: 1, q: "" });
		this.assets = [];
		this.total = 0;
		this.formMode = null;
		this.selectedAssetId = null;
		void this.load();
	}

	private updateQuery(event: Event): void {
		const query = (event.target as HTMLInputElement).value;
		this.updateUrl({ q: query, page: 1 });
		void this.load();
	}

	private updatePageSize(event: Event): void {
		const pageSize = Number((event.target as HTMLSelectElement).value);
		this.updateUrl({ pageSize, page: 1 });
		void this.load();
	}

	private chooseAsset(assetId: number): void {
		this.selectedAssetId = assetId;
		this.updateUrl({ selectedAssetId: assetId });
		void this.loadDetail(assetId);
	}

	private renderTabs() {
		return html`<nav class="tabs" aria-label="资产类型">
			${TAB_ORDER.map((tab) => {
				const count = tab === "graph" ? null : TAB_KINDS[tab].reduce((sum, kind) => sum + (this.kindCounts[kind] ?? 0), 0);
				return html`
					<button
						class="tab ${this.activeTab === tab ? "active" : ""}"
						aria-current=${this.activeTab === tab ? "page" : "false"}
						@click=${() => this.chooseTab(tab)}
					>
						${TAB_LABELS[tab]}
						${count !== null ? html`<span class="tab-count">${count}</span>` : ""}
					</button>
				`;
			})}
		</nav>`;
	}

	private renderAssetRow(asset: AssetSummary) {
		const revision = asset.currentRevision;
		return html`<button class="asset-row ${this.selectedAssetId === asset.id ? "selected" : ""}" aria-pressed=${this.selectedAssetId === asset.id} @click=${() => this.chooseAsset(asset.id)}>
			<div class="row-head"><span class="kind">${assetKindLabel(asset.kind)}</span><span class="title">${asset.title}</span></div>
			<div class="meta">${revision ? `Revision ${revision.revisionNo} · ${revision.source}` : "暂无当前版本"} · ${new Date(asset.createdAt).toLocaleDateString("zh-CN")}</div>
			${revision ? html`<div class="digest">${revision.digest}</div>` : ""}
		</button>`;
	}

	private renderList() {
		if (this.loading) return html`<div class="empty">正在加载资产…</div>`;
		if (this.error) return html`<div class="empty error">资产加载失败：${this.error}</div>`;
		const selectedHidden = this.selectedAssetId !== null && !this.assets.some((asset) => "id" in asset && asset.id === this.selectedAssetId);
		if (this.assets.length === 0) return html`${selectedHidden ? html`<p class="selected-note">当前选中的资产不在此筛选结果中。</p>` : ""}<div class="empty">${this.query ? "没有匹配当前标题过滤条件的资产。" : `暂无${TAB_LABELS[this.activeTab]}资产。归档或创建后，资产会出现在这里。`}</div>`;
		return html`
			${selectedHidden ? html`<p class="selected-note">当前选中的资产不在此筛选结果中。</p>` : ""}
			<div class="list" role="list">${this.assets.map((asset) => html`<div role="listitem">${this.renderAssetRow(asset as AssetSummary)}</div>`)}</div>
			<div class="pager">
				<span>第 ${this.page} / ${Math.max(1, Math.ceil(this.total / this.pageSize))} 页 · ${this.total} 项</span>
				<label>每页
					<select .value=${String(this.pageSize)} @change=${(event: Event) => this.updatePageSize(event)}>
						${PAGE_SIZE_OPTIONS.map((size) => html`<option value=${size}>${size}</option>`)}
					</select>
				</label>
				<span class="pager-actions">
					<button ?disabled=${this.page <= 1} @click=${() => { this.updateUrl({ page: this.page - 1 }); void this.load(); }}>上一页</button>
					<button ?disabled=${this.page >= Math.ceil(this.total / this.pageSize)} @click=${() => { this.updateUrl({ page: this.page + 1 }); void this.load(); }}>下一页</button>
				</span>
			</div>
		`;
	}

	private renderValue(value: unknown): ReturnType<typeof html> {
		if (Array.isArray(value)) {
			return html`<div class="value-list">
				${value.map((item, index) => html`<details class="array-item">
					<summary>${arrayItemLabel(item, index)}</summary>
					${this.renderValue(item)}
				</details>`)}
			</div>`;
		}
		if (typeof value === "object" && value !== null) {
			const record = value as Record<string, unknown>;
			return html`<dl class="field-list">
				${Object.entries(record).map(([key, child]) => html`<div class="field">
					<dt>${fieldTitle(key)}</dt>
					<dd>${this.renderValue(child)}</dd>
				</div>`)}
			</dl>`;
		}
		if (value === null || value === undefined || value === "") return html`<span class="value">—</span>`;
		return html`<span class="value">${String(value)}</span>`;
	}

	private openRelated(relation: AssetResolvedRelation): void {
		const tab = KIND_TO_TAB[relation.kind];
		this.updateUrl({ tab, q: "", page: 1, selectedAssetId: relation.assetId });
		this.assets = [];
		this.total = 0;
		void this.load();
		void this.loadDetail(relation.assetId);
	}

	private renderRelationGroup(title: string, relations: readonly AssetResolvedRelation[]) {
		return html`<div class="relation-group">
			<h3>${title} (${relations.length})</h3>
			${relations.length === 0
				? html`<p class="detail-sub">暂无直接关系。</p>`
				: html`<div class="relations">${relations.map((relation) => html`
					<button class="relation" @click=${() => this.openRelated(relation)}>
						${relationTypeLabel(relation.type)} · ${assetKindLabel(relation.kind)} · ${relation.title}
					</button>
				`)}</div>`}
		</div>`;
	}

	private renderImportPreview() {
		if (this.importError) return html`<p class="form-error" role="alert">${this.importError}</p>`;
		if (!this.importDraft) return nothing;
		const s = this.importDraft.preview.summary;
		return html`<section class="card import-preview" aria-label="导入预览">
			<h2>导入预览</h2>
			<p class="detail-sub">${this.importDraft.assets.length} 个资产 · ${this.importDraft.relations.length} 条关系</p>
			<p class="detail-sub">新建 ${s.createCount} · 复用 ${s.reuseCount} · 关系变更 ${s.relationChanges} · 路径冲突 ${s.pathConflicts} · 校验错误 ${s.validationErrors}</p>
			<p class="detail-sub">类型分布：${ASSET_KINDS.map((kind) => `${assetKindLabel(kind)} ${s.kindBreakdown[kind] ?? 0}`).join(" · ")}</p>
			<div class="form-actions">
				<button class="primary" ?disabled=${this.importSubmitting} @click=${() => void this.confirmImport()}>${this.importSubmitting ? "导入中…" : "确认导入"}</button>
				<button @click=${() => { this.importDraft = null; }}>取消</button>
			</div>
		</section>`;
	}

	private renderDetail() {
		if (this.detailLoading) return html`<div class="empty">正在加载资产详情…</div>`;
		if (this.detailError) return html`<div class="empty error">资产详情加载失败：${this.detailError}</div>`;
		if (!this.detail) return html`<div class="detail-placeholder">选择资产查看详情</div>`;
		const detail = this.detail;
		const current = detail.revisions.find((revision) => revision.id === detail.currentRevisionId) ?? detail.revisions.at(-1);
		const warning = current ? assetContentWarning(detail.kind, current.content) : null;
		const isSpecialized = detail.kind === "api" || detail.kind === "data" || detail.kind === "architecture";
		return html`<article class="detail">
			<header class="detail-head">
				<div>
					${this.narrowView && this.selectedAssetId !== null ? html`<button class="mobile-back" @click=${() => { this.selectedAssetId = null; this.updateUrl({ selectedAssetId: null }, true); }}>← 返回列表</button>` : nothing}
					<h2 class="detail-title">${detail.title}</h2>
					<p class="detail-sub">${assetKindLabel(detail.kind)} · Asset #${detail.id}</p>
				</div>
				<button @click=${() => this.openEdit()}>编辑</button>
				${this.deleteConfirm ? html`<div class="danger-zone">
					<span class="detail-sub">确认删除？资产及其历史 revision 将无法恢复。</span>
					<button class="danger" @click=${() => void this.confirmDelete()}>确认删除</button>
					<button @click=${() => { this.deleteConfirm = false; }}>取消</button>
				</div>` : html`<button class="danger" @click=${() => this.requestDelete()}>删除</button>`}
				${this.deleteError ? html`<span class="form-error" role="alert">${this.deleteError}</span>` : ""}
			</header>
			<section class="detail-block">
				<h2>资产概览</h2>
				<dl class="facts">
					<div class="fact"><dt>创建时间</dt><dd>${new Date(detail.createdAt).toLocaleDateString("zh-CN")}</dd></div>
					<div class="fact"><dt>版本数量</dt><dd>${detail.revisions.length}</dd></div>
					<div class="fact"><dt>来源需求</dt><dd>${detail.originRequirementId ?? "—"}</dd></div>
					<div class="fact"><dt>来源产物</dt><dd>${detail.originArtifactId ?? "—"}</dd></div>
					<div class="fact"><dt>来源批准</dt><dd>${detail.originApprovalId ?? "—"}</dd></div>
					<div class="fact"><dt>当前 Revision</dt><dd>${current ? `Revision ${current.revisionNo}` : "暂无"}</dd></div>
				</dl>
			</section>
			<section class="detail-block">
				<h2>当前版本</h2>
				${current ? html`<dl class="facts">
					<div class="fact"><dt>来源</dt><dd>${current.source}</dd></div>
					<div class="fact"><dt>Digest</dt><dd class="mono">${current.digest}</dd></div>
					<div class="fact"><dt>生成时间</dt><dd>${new Date(current.createdAt).toLocaleDateString("zh-CN")}</dd></div>
				</dl>` : html`<p class="detail-sub">暂无当前版本。</p>`}
			</section>
			<section class="detail-block">
				<h2>结构化内容</h2>
				${warning ? html`<p class="form-error" role="status">校验警告：${warning}</p>` : ""}
				${isSpecialized && current ? this.renderSpecializedDetail(detail.kind, current.content, detail) : current ? this.renderValue(current.content) : html`<p class="detail-sub">暂无可展示内容。</p>`}
			</section>
			<section class="detail-block">
				<h2>关联信息</h2>
				${this.renderRelationGroup("被引用资产", detail.resolvedGraph.incoming)}
				${this.renderRelationGroup("关联资产", detail.resolvedGraph.outgoing)}
			</section>
			<details class="detail-block">
				<summary>Revision 历史（${detail.revisions.length}）</summary>
				<div class="relations">${detail.revisions.map((revision) => html`<div class="array-item">
					<strong>Revision ${revision.revisionNo}</strong> · ${revision.source} · ${revision.digest}
				</div>`)}</div>
			</details>
		</article>`;
	}

	private renderSpecializedDetail(kind: AssetKind, content: unknown, detail: AssetDetail): Renderable {
		if (kind === "api") {
			return html`<baize-api-swagger
				.apiBase=${this.apiBase}
				.assetId=${detail.id}
				.expectedRevisionId=${detail.currentRevisionId ?? detail.revisions.at(-1)?.id ?? 0}
				.content=${content}
				.title=${detail.title}
				@save=${(event: CustomEvent<{ content: unknown; title: string }>) => this.handleSpecializedSave(event, detail)}
			></baize-api-swagger>`;
		}
		if (kind === "data") {
			return html`<baize-data-catalog
				.apiBase=${this.apiBase}
				.assetId=${detail.id}
				.expectedRevisionId=${detail.currentRevisionId ?? detail.revisions.at(-1)?.id ?? 0}
				.content=${content}
				.title=${detail.title}
				@save=${(event: CustomEvent<{ content: unknown; title: string }>) => this.handleSpecializedSave(event, detail)}
			></baize-data-catalog>`;
		}
		if (kind === "architecture") {
			return html`<baize-architecture-diagram
				.apiBase=${this.apiBase}
				.assetId=${detail.id}
				.expectedRevisionId=${detail.currentRevisionId ?? detail.revisions.at(-1)?.id ?? 0}
				.content=${content}
				.title=${detail.title}
				@save=${(event: CustomEvent<{ content: unknown; title: string }>) => this.handleSpecializedSave(event, detail)}
			></baize-architecture-diagram>`;
		}
		return nothing;
	}

	private async handleSpecializedSave(event: CustomEvent<{ content: unknown; title: string }>, detail: AssetDetail): Promise<void> {
		try {
			const result = await updateAsset(this.apiBase, detail.id, {
				expectedRevisionId: detail.currentRevisionId ?? detail.revisions.at(-1)?.id ?? 0,
				title: event.detail.title,
				content: event.detail.content,
				relations: detail.resolvedGraph.outgoing.map((r) => ({ toAssetId: r.assetId, type: r.type })),
			});
			await this.loadDetail(result.assetId);
			await this.load();
		} catch (error) {
			if (error instanceof AssetMutationError) {
				// Dispatch error back to the specialized component
				window.dispatchEvent(new CustomEvent("baize-asset-save-error", { detail: { errors: error.validationErrors } }));
			} else {
				window.dispatchEvent(new CustomEvent("baize-asset-save-error", { detail: { errors: [], message: error instanceof Error ? error.message : String(error) } }));
			}
		}
	}

	private setGraphKindFilter(event: Event): void {
		const value = (event.target as HTMLSelectElement).value;
		this.graphKindFilter = value === "all" ? null : value as AssetKind;
		this.updateUrl({ graphKind: this.graphKindFilter }, true);
	}

	private graphVisibleNodes(): readonly AssetGraph["nodes"][number][] {
		if (!this.graph) return [];
		if (!this.graphKindFilter) return this.graph.nodes;
		const selectedIds = new Set(this.graph.nodes.filter((node) => node.kind === this.graphKindFilter).map((node) => node.assetId));
		const visibleIds = new Set(selectedIds);
		for (const edge of this.graph.edges) {
			if (selectedIds.has(edge.fromAssetId) || selectedIds.has(edge.toAssetId)) {
				visibleIds.add(edge.fromAssetId);
				visibleIds.add(edge.toAssetId);
			}
		}
		return this.graph.nodes.filter((node) => visibleIds.has(node.assetId));
	}

	private openGraphNode(assetId: number): void {
		const node = this.graph?.nodes.find((candidate) => candidate.assetId === assetId);
		if (!node) return;
		const tab = KIND_TO_TAB[node.kind];
		this.updateUrl({ tab, q: "", page: 1, selectedAssetId: node.assetId }, false);
		this.activeTab = tab;
		this.assets = [];
		this.total = 0;
		void this.load();
		void this.loadDetail(node.assetId);
	}

	private renderGraph(): Renderable {
		if (this.loading) return html`<div class="empty">正在加载 Workspace 关系图…</div>`;
		if (this.error) return html`<div class="empty error">关系图加载失败：${this.error}</div>`;
		if (!this.graph || this.graph.nodes.length === 0) return html`<div class="empty">当前 Workspace 暂无资产关系。</div>`;
		const nodes = this.graphVisibleNodes();
		const columns = Math.max(1, Math.min(4, nodes.length));
		const positions = new Map<number, { x: number; y: number }>();
		nodes.forEach((node, index) => positions.set(node.assetId, { x: 40 + (index % columns) * 180, y: 40 + Math.floor(index / columns) * 90 }));
		const width = Math.max(560, columns * 180 + 80);
		const height = Math.max(300, Math.ceil(nodes.length / columns) * 90 + 80);
		const visibleIds = new Set(nodes.map((node) => node.assetId));
		const edges = this.graph.edges.filter((edge) => visibleIds.has(edge.fromAssetId) && visibleIds.has(edge.toAssetId));
		return html`
			<div class="graph-controls">
				<label>类型过滤
					<select @change=${(event: Event) => this.setGraphKindFilter(event)}>
						<option value="all" ?selected=${this.graphKindFilter === null}>全部相邻节点</option>
						${ASSET_KINDS.map((kind) => html`<option value=${kind} ?selected=${this.graphKindFilter === kind}>${assetKindLabel(kind)}</option>`)}
					</select>
				</label>
				<button @click=${() => { const graphZoom = Math.max(0.6, this.graphZoom - 0.1); this.updateUrl({ graphZoom }, true); }}>缩小</button>
				<button aria-label="向左平移" @click=${() => this.updateUrl({ graphX: this.graphOffset.x - 30 }, true)}>←</button>
				<button aria-label="向右平移" @click=${() => this.updateUrl({ graphX: this.graphOffset.x + 30 }, true)}>→</button>
				<button aria-label="向上平移" @click=${() => this.updateUrl({ graphY: this.graphOffset.y - 30 }, true)}>↑</button>
				<button aria-label="向下平移" @click=${() => this.updateUrl({ graphY: this.graphOffset.y + 30 }, true)}>↓</button>
				<span class="detail-sub">实线：包含 · 虚线：涉及</span>
			</div>
			<div class="graph-canvas" role="img" aria-label="Workspace 资产关系图" style="height: ${height}px">
				<div class="graph-layer" style="width: ${width}px; height: ${height}px; transform: translate(${this.graphOffset.x}px, ${this.graphOffset.y}px) scale(${this.graphZoom})">
					${edges.map((edge) => {
						const from = positions.get(edge.fromAssetId);
						const to = positions.get(edge.toAssetId);
						if (!from || !to) return nothing;
						const dx = to.x - from.x;
						const dy = to.y - from.y;
						const length = Math.sqrt(dx * dx + dy * dy);
						const angle = Math.atan2(dy, dx) * (180 / Math.PI);
						return html`<span class="graph-edge" aria-hidden="true" style="left: ${from.x + 65}px; top: ${from.y + 18}px; width: ${length}px; transform: rotate(${angle}deg); ${edge.type === "involves" ? "border-top-style: dashed;" : ""}"></span>`;
					})}
					${nodes.map((node) => {
						const position = positions.get(node.assetId);
						if (!position) return nothing;
						return html`<button class="graph-node" aria-label=${`${assetKindLabel(node.kind)} ${node.title}`} style="left: ${position.x}px; top: ${position.y}px" @click=${() => this.openGraphNode(node.assetId)}>
							<span>${assetKindLabel(node.kind)}</span>
							<strong>${node.title.slice(0, 16)}</strong>
						</button>`;
					})}
				</div>
			</div>
		`;
	}

	render() {
		const isHierarchyTab = this.activeTab === "scenario" || this.activeTab === "function";
		const showDetail = this.narrowView ? this.selectedAssetId !== null : true;
		const showList = this.narrowView ? this.selectedAssetId === null : true;
		return html`
			<section class="workspace" aria-labelledby="asset-library-title">
				<header class="toolbar">
					<div class="toolbar-head">
						<div class="heading">
							<h1 id="asset-library-title">设计模型资产</h1>
							<p class="sub">按类型浏览 Workspace 内可复用的设计事实，并追溯资产关系。</p>
						</div>
						<span class="count">${this.loading ? "…" : this.activeTab === "graph" ? "关系图" : this.total}</span>
					</div>
					<div class="toolbar-actions">
						${this.activeTab !== "graph" ? html`
							<label class="search">标题过滤
								<input type="search" .value=${this.query} placeholder="搜索当前类型" @input=${(event: Event) => this.updateQuery(event)} />
							</label>
						${!isHierarchyTab && !SPECIALIZED_VIEW_KINDS.has(TAB_KINDS[this.activeTab as Exclude<WorkbenchTab, "graph">][0]!) ? html`<button class="primary" @click=${() => this.openCreate()}>新建${assetKindLabel(TAB_KINDS[this.activeTab as Exclude<WorkbenchTab, "graph">][0]!)}</button>` : nothing}
						` : ""}
						<button @click=${() => void this.exportWorkspace()}>导出</button>
						<label class="file-button">导入<input class="file-input" type="file" accept="application/json" @change=${(event: Event) => void this.handleImportFile(event)} /></label>
					</div>
				</header>
				${this.renderTabs()}
				${this.renderImportPreview()}
				<div class="content">
					${showList ? html`<section class="card pane list-pane" aria-label="资产列表">
						${isHierarchyTab && this.activeTab !== "graph"
							? html`<baize-hierarchy-tree
								.apiBase=${this.apiBase}
								.workspaceId=${this.workspaceId}
								.rootKind=${TAB_KINDS[this.activeTab as Exclude<WorkbenchTab, "graph">][0]!}
								.selectedAssetId=${this.selectedAssetId ?? 0}
								.expandedNodes=${this.expandedNodes}
								.page=${this.page}
								.pageSize=${this.pageSize}
								.query=${this.query}
								.narrowView=${this.narrowView}
								@select=${(event: CustomEvent<number>) => { this.selectedAssetId = event.detail; this.updateUrl({ selectedAssetId: event.detail }); void this.loadDetail(event.detail); }}
								@expand=${(event: CustomEvent<number>) => { const next = new Set(this.expandedNodes); next.has(event.detail) ? next.delete(event.detail) : next.add(event.detail); this.expandedNodes = next; this.updateUrl({ expandedNodes: [...next].join(",") }, true); }}
								@navigate=${(event: CustomEvent<{ tab: WorkbenchTab; assetId: number }>) => { this.chooseTab(event.detail.tab); this.selectedAssetId = event.detail.assetId; this.updateUrl({ selectedAssetId: event.detail.assetId }); void this.loadDetail(event.detail.assetId); }}
							></baize-hierarchy-tree>`
							: this.renderList()}
					</section>` : nothing}
					${showDetail ? html`<section class="card pane detail-pane" aria-label="资产详情">
						${this.activeTab === "graph" ? html`<div class="detail-placeholder">关系图节点详情将在此展示。</div>` : this.formMode ? this.renderForm() : this.renderDetail()}
					</section>` : nothing}
				</div>
				${this.activeTab === "graph" ? this.renderGraph() : nothing}
			</section>
		`;
	}
}

customElements.define("baize-asset-library", BaizeAssetLibrary);