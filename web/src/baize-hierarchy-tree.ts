import { LitElement, html, css, nothing, type PropertyValues, type TemplateResult } from "lit";
import { sharedStyles } from "./baize-styles.js";
import {
	assetKindLabel,
	ASSET_KINDS,
	getHierarchyRoots,
	getHierarchyChildren,
	searchHierarchyNodes,
	createHierarchySubtree,
	moveHierarchySubtree,
	deleteAssetSubtree,
	previewSubtreeDeletion,
	getAsset,
	updateAsset,
	AssetMutationError,
	type AssetKind,
	type HierarchyRoot,
	type HierarchyChild,
	type HierarchySearchHit,
	type SubtreeNodeInput,
} from "./workflow-client.js";

// ---------------------------------------------------------------------------
// Hierarchy kind chains and containment rules.
// ---------------------------------------------------------------------------

const SCENARIO_CHAIN: readonly AssetKind[] = ["scenario-domain", "scenario", "scenario-variant"];
const FUNCTION_CHAIN: readonly AssetKind[] = ["function-domain", "function-item", "function-point"];

const CHAIN_FOR_ROOT: Record<"scenario-domain" | "function-domain", readonly AssetKind[]> = {
	"scenario-domain": SCENARIO_CHAIN,
	"function-domain": FUNCTION_CHAIN,
};

const CHILD_KIND: Record<AssetKind, AssetKind | null> = {
	"scenario-domain": "scenario",
	scenario: "scenario-variant",
	"scenario-variant": null,
	"function-domain": "function-item",
	"function-item": "function-point",
	"function-point": null,
	usecase: null,
	design: null,
	architecture: null,
	data: null,
	api: null,
	stakeholder: null,
};

const TAB_FOR_KIND: Record<AssetKind, string> = {
	"scenario-domain": "scenario",
	scenario: "scenario",
	"scenario-variant": "scenario",
	"function-domain": "function",
	"function-item": "function",
	"function-point": "function",
	usecase: "usecase",
	design: "design",
	architecture: "architecture",
	data: "data",
	api: "api",
	stakeholder: "stakeholder",
};

function clampPage(page: number, total: number, pageSize: number): number {
	if (total === 0) return 1;
	const max = Math.max(1, Math.ceil(total / pageSize));
	return Math.min(Math.max(1, page), max);
}

function generateNodeId(): string {
	return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultNodeContent(kind: AssetKind, title: string, nodeId: string): Record<string, unknown> {
	switch (kind) {
		case "scenario-domain":
		case "scenario":
		case "function-domain":
		case "function-item":
			return { nodeId, title };
		case "scenario-variant":
			return {
				nodeId,
				title,
				actors: ["用户"],
				trigger: "触发条件",
				mainFlow: ["主流程"],
				alternateFlows: [],
				expectedOutcome: "预期结果",
				preconditions: [],
			};
		case "function-point":
			return {
				nodeId,
				name: title,
				responsibility: "待补充",
				acceptanceCriteria: ["待补充"],
			};
		default:
			return { nodeId, title };
	}
}

// ---------------------------------------------------------------------------
// BaizeHierarchyTree
// ---------------------------------------------------------------------------

type EditingMode = "add-child" | "rename" | "delete";

interface ContextMenuState {
	assetId: number;
	kind: AssetKind;
	x: number;
	y: number;
}

interface DragState {
	draggingId: number;
	targetParentId: number | null;
	allowed: boolean;
}

class BaizeHierarchyTree extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		rootKind: { type: String, attribute: "root-kind" },
		selectedAssetId: { type: Number, attribute: "selected-asset-id" },
		expandedNodes: { state: true },
		page: { type: Number },
		pageSize: { type: Number, attribute: "page-size" },
		query: { type: String },
		narrowView: { type: Boolean, attribute: "narrow-view" },

		roots: { state: true },
		total: { state: true },
		kindCounts: { state: true },
		childrenMap: { state: true },
		searchHits: { state: true },
		searchQuery: { state: true },
		loading: { state: true },
		error: { state: true },
		editingNode: { state: true },
		draftTitle: { state: true },
		contextMenu: { state: true },
		dragState: { state: true },
		deleteAffected: { state: true },
	};

	declare apiBase: string;
	declare workspaceId: number;
	declare rootKind: AssetKind;
	declare selectedAssetId: number;
	declare expandedNodes: ReadonlySet<number>;
	declare page: number;
	declare pageSize: number;
	declare query: string;
	declare narrowView: boolean;

	declare roots: readonly HierarchyRoot[];
	declare total: number;
	declare kindCounts: Readonly<Record<AssetKind, number>>;
	declare childrenMap: Map<number, readonly HierarchyChild[]>;
	declare searchHits: readonly HierarchySearchHit[];
	declare searchQuery: string;
	declare loading: boolean;
	declare error: string | null;
	declare editingNode: { assetId: number; mode: EditingMode } | null;
	declare draftTitle: string;
	declare contextMenu: ContextMenuState | null;
	declare dragState: DragState | null;
	declare deleteAffected: readonly { assetId: number; kind: AssetKind; title: string }[];

	private parentMap = new Map<number, number>();
	private loadingChildren = new Set<number>();
	private loadRequestNo = 0;

	static styles = [sharedStyles, css`
		:host {
			display: flex;
			flex-direction: column;
			min-height: 0;
			height: 100%;
			--tree-indent: 18px;
			--tree-row-h: 2.25rem;
		}

		.tree-header {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--gap);
			padding-bottom: var(--gap);
			border-bottom: 1px solid var(--border);
		}

		.tree-header .counts {
			display: flex;
			align-items: baseline;
			gap: var(--space-2xs);
			font-size: var(--text-sm);
			color: var(--text-muted);
			flex: 1 1 auto;
			min-width: 0;
		}

		.tree-header .counts .total {
			font-family: var(--font-mono);
			font-variant-numeric: tabular-nums;
			color: var(--text);
			font-weight: 600;
		}

		.tree-toolbar {
			display: flex;
			align-items: center;
			gap: var(--space-2xs);
		}

		.tree-body {
			flex: 1 1 auto;
			min-height: 0;
			overflow: auto;
			padding-top: var(--gap);
		}

		.error {
			padding: var(--pad);
			border: 1px solid var(--danger);
			border-radius: var(--radius);
			color: var(--danger);
			background: color-mix(in oklch, var(--danger) 8%, transparent);
			margin-bottom: var(--gap);
		}

		.skeleton {
			display: grid;
			gap: var(--space-2xs);
		}

		.skeleton-row {
			height: var(--tree-row-h);
			background: var(--surface-2);
			border-radius: var(--radius);
			animation: pulse 1.4s ease-in-out infinite;
		}

		@keyframes pulse {
			0%, 100% { opacity: 0.6; }
			50% { opacity: 1; }
		}

		.empty {
			padding: var(--pad) 0;
			text-align: center;
		}

		.empty p {
			margin: 0 0 var(--gap);
			color: var(--text-muted);
		}

		.children {
			padding-left: var(--tree-indent);
		}

		.node {
			display: flex;
			align-items: center;
			gap: var(--space-2xs);
			min-height: var(--tree-row-h);
			padding: 2px var(--space-2xs);
			border-radius: var(--radius);
			border: 1px solid transparent;
			cursor: pointer;
			transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
		}

		.node:hover {
			background: var(--surface-hover);
		}

		.node[aria-selected="true"] {
			background: color-mix(in oklch, var(--accent) 10%, transparent);
			border-color: var(--accent-line);
		}

		.node.dragging {
			opacity: 0.5;
		}

		.node.drag-over-allow {
			border-color: var(--ok);
			background: color-mix(in oklch, var(--ok) 10%, transparent);
		}

		.node.drag-over-forbid {
			border-color: var(--danger);
			background: color-mix(in oklch, var(--danger) 10%, transparent);
			cursor: not-allowed;
		}

		.caret {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 1.25rem;
			height: 1.25rem;
			color: var(--text-subtle);
			flex: 0 0 auto;
			transition: transform var(--dur-1) var(--ease-out);
		}

		.caret[aria-expanded="true"] {
			transform: rotate(90deg);
		}

		.leaf .caret {
			visibility: hidden;
		}

		.kind {
			font-size: var(--text-xs);
			color: var(--text-subtle);
			font-family: var(--font-mono);
			flex: 0 0 auto;
			min-width: 4rem;
		}

		.title {
			flex: 1 1 auto;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			font-size: var(--text-sm);
		}

		.child-count {
			flex: 0 0 auto;
			font-size: var(--text-xs);
			font-family: var(--font-mono);
			color: var(--text-subtle);
			background: var(--surface-2);
			padding: 1px 6px;
			border-radius: 999px;
		}

		.inline-form {
			display: flex;
			align-items: center;
			gap: var(--space-2xs);
			padding: var(--space-2xs) 0 var(--space-2xs) var(--tree-indent);
		}

		.inline-form input {
			flex: 1 1 auto;
			min-width: 0;
		}

		.delete-panel {
			margin: var(--space-2xs) 0 var(--gap) var(--tree-indent);
			padding: var(--pad);
			border: 1px solid var(--danger);
			border-radius: var(--radius);
			background: color-mix(in oklch, var(--danger) 8%, transparent);
		}

		.delete-panel h4 {
			margin: 0 0 var(--space-2xs);
			font-size: var(--text-sm);
			color: var(--danger);
		}

		.delete-panel ul {
			margin: 0 0 var(--gap);
			padding-left: 1.2rem;
			font-size: var(--text-sm);
			color: var(--text-muted);
		}

		.context-menu {
			position: fixed;
			z-index: 100;
			min-width: 8rem;
			background: var(--surface);
			border: 1px solid var(--border-strong);
			border-radius: var(--radius);
			padding: 4px;
			box-shadow: 0 4px 20px oklch(0% 0 0 / 0.25);
		}

		.context-menu button {
			display: block;
			width: 100%;
			text-align: left;
			border: none;
			background: transparent;
			padding: 6px 10px;
			font-size: var(--text-sm);
			color: var(--text);
		}

		.context-menu button:hover {
			background: var(--surface-hover);
		}

		.drop-zone {
			height: 6px;
			border-radius: 2px;
			margin: 1px 0;
			transition: background var(--dur-1) var(--ease-out);
		}

		.drop-zone.drag-over {
			background: var(--accent);
		}

		.drop-zone.drag-over-forbid {
			background: var(--danger);
		}

		.pagination {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--gap);
			padding-top: var(--gap);
			border-top: 1px solid var(--border);
			font-size: var(--text-sm);
			color: var(--text-muted);
		}

		.pagination .info {
			font-family: var(--font-mono);
			font-variant-numeric: tabular-nums;
		}

		.search-results {
			display: grid;
			gap: var(--space-2xs);
		}

		.search-hit {
			display: flex;
			flex-direction: column;
			padding: var(--space-2xs) var(--space-xs);
			border-radius: var(--radius);
			cursor: pointer;
			border: 1px solid transparent;
			transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
		}

		.search-hit:hover {
			background: var(--surface-hover);
			border-color: var(--border-strong);
		}

		.search-hit .path {
			font-size: var(--text-xs);
			color: var(--text-subtle);
		}

		.search-hit .hit-title {
			font-size: var(--text-sm);
			color: var(--text);
		}

		.icon-btn {
			padding: 4px 6px;
			font-size: var(--text-xs);
			line-height: 1;
		}

		@media (max-width: 1023px) {
			.tree-header { flex-direction: column; align-items: stretch; }
			.counts { justify-content: space-between; }
		}
	`];

	constructor() {
		super();
		this.apiBase = "";
		this.workspaceId = 0;
		this.rootKind = "scenario-domain";
		this.selectedAssetId = 0;
		this.expandedNodes = new Set();
		this.page = 1;
		this.pageSize = 24;
		this.query = "";
		this.narrowView = false;

		this.roots = [];
		this.total = 0;
		this.kindCounts = Object.fromEntries(ASSET_KINDS.map((kind) => [kind, 0])) as Record<AssetKind, number>;
		this.childrenMap = new Map();
		this.searchHits = [];
		this.searchQuery = "";
		this.loading = false;
		this.error = null;
		this.editingNode = null;
		this.draftTitle = "";
		this.contextMenu = null;
		this.dragState = null;
		this.deleteAffected = [];

		this.handleSaveError = this.handleSaveError.bind(this);
		this.handleWindowClick = this.handleWindowClick.bind(this);
		this.handleKeyWindow = this.handleKeyWindow.bind(this);
	}

	connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener("baize-asset-save-error", this.handleSaveError);
		window.addEventListener("click", this.handleWindowClick);
		window.addEventListener("keydown", this.handleKeyWindow);
		void this.load();
		void this.loadMissingChildren();
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		window.removeEventListener("baize-asset-save-error", this.handleSaveError);
		window.removeEventListener("click", this.handleWindowClick);
		window.removeEventListener("keydown", this.handleKeyWindow);
	}

	protected willUpdate(changed: PropertyValues<this>): void {
		if (
			changed.has("apiBase") ||
			changed.has("workspaceId") ||
			changed.has("rootKind") ||
			changed.has("page") ||
			changed.has("pageSize") ||
			changed.has("query")
		) {
			if (changed.has("rootKind") || changed.has("apiBase") || changed.has("workspaceId")) {
				this.childrenMap = new Map();
				this.parentMap = new Map();
				this.searchHits = [];
				this.searchQuery = "";
			}
			void this.load();
		}
		if (changed.has("expandedNodes")) {
			void this.loadMissingChildren();
		}
	}

	private handleSaveError(event: Event): void {
		const custom = event as CustomEvent<{ errors?: unknown[]; message?: string }>;
		const detail = custom.detail ?? {};
		const message = detail.message ?? "保存失败";
		if (Array.isArray(detail.errors) && detail.errors.length > 0) {
			const first = detail.errors[0];
			const field = typeof first === "object" && first !== null && "path" in first ? `${String(first.path)}: ` : "";
			const body = typeof first === "object" && first !== null && "message" in first ? String(first.message) : "";
			this.error = `${message} ${field}${body}`.trim();
		} else {
			this.error = message;
		}
	}

	private handleWindowClick(event: MouseEvent): void {
		if (!this.contextMenu) return;
		const target = event.composedPath()[0] as HTMLElement | undefined;
		if (target?.closest?.(".context-menu")) return;
		this.contextMenu = null;
	}

	private handleKeyWindow(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			this.contextMenu = null;
			this.cancelEdit();
		}
	}

	private chain(): readonly AssetKind[] {
		return CHAIN_FOR_ROOT[this.rootKind as "scenario-domain" | "function-domain"] ?? SCENARIO_CHAIN;
	}

	private childKind(kind: AssetKind): AssetKind | null {
		return CHILD_KIND[kind] ?? null;
	}

	private canContain(parentKind: AssetKind, childKind: AssetKind): boolean {
		return this.childKind(parentKind) === childKind;
	}

	private nodeKind(assetId: number): AssetKind | null {
		const root = this.roots.find((r) => r.assetId === assetId);
		if (root) return root.kind;
		for (const children of this.childrenMap.values()) {
			const child = children.find((c) => c.assetId === assetId);
			if (child) return child.kind;
		}
		return null;
	}

	private isDescendant(ancestorId: number, nodeId: number): boolean {
		const children = this.childrenMap.get(ancestorId);
		if (!children) return false;
		for (const child of children) {
			if (child.assetId === nodeId || this.isDescendant(child.assetId, nodeId)) return true;
		}
		return false;
	}

	private findParent(assetId: number): number | null {
		return this.parentMap.get(assetId) ?? null;
	}

	private async load(): Promise<void> {
		if (!this.apiBase || !this.workspaceId) return;
		const requestNo = ++this.loadRequestNo;
		this.loading = true;
		this.error = null;
		try {
			const q = this.query.trim();
			if (q.length > 0) {
				const result = await searchHierarchyNodes(this.apiBase, this.workspaceId, q);
				if (requestNo !== this.loadRequestNo) return;
				this.searchHits = result.hits;
				this.searchQuery = q;
			} else {
				const page = await getHierarchyRoots(this.apiBase, this.workspaceId, this.rootKind, {
					page: clampPage(this.page, this.total, this.pageSize),
					pageSize: this.pageSize,
				});
				if (requestNo !== this.loadRequestNo) return;
				this.roots = page.roots;
				this.total = page.total;
				this.kindCounts = page.kindCounts as Record<AssetKind, number>;
				this.searchHits = [];
				this.searchQuery = "";
			}
		} catch (err) {
			if (requestNo !== this.loadRequestNo) return;
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			if (requestNo === this.loadRequestNo) this.loading = false;
		}
	}

	private async loadMissingChildren(): Promise<void> {
		if (!this.apiBase) return;
		const promises: Promise<unknown>[] = [];
		for (const assetId of this.expandedNodes) {
			if (this.childrenMap.has(assetId) || this.loadingChildren.has(assetId)) continue;
			promises.push(this.loadChildren(assetId));
		}
		await Promise.all(promises);
	}

	private async loadChildren(assetId: number): Promise<void> {
		if (!this.apiBase) return;
		this.loadingChildren.add(assetId);
		try {
			const { children } = await getHierarchyChildren(this.apiBase, assetId);
			const next = new Map(this.childrenMap);
			next.set(assetId, children);
			for (const child of children) {
				this.parentMap.set(child.assetId, assetId);
			}
			this.childrenMap = next;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.loadingChildren.delete(assetId);
		}
	}

	private async refreshParent(parentId: number | null): Promise<void> {
		if (parentId === null || parentId === 0) {
			await this.load();
		} else {
			await this.loadChildren(parentId);
		}
	}

	private setError(err: unknown): void {
		if (err instanceof AssetMutationError) {
			this.error = err.validationErrors.map((e) => `${e.path}: ${e.message}`).join("；") || err.message;
		} else {
			this.error = err instanceof Error ? err.message : String(err);
		}
	}

	private dispatchSelect(assetId: number): void {
		this.dispatchEvent(new CustomEvent<number>("select", { detail: assetId, bubbles: true, composed: true }));
	}

	private dispatchExpand(assetId: number): void {
		this.dispatchEvent(new CustomEvent<number>("expand", { detail: assetId, bubbles: true, composed: true }));
	}

	private dispatchNavigate(tab: string, assetId: number): void {
		this.dispatchEvent(new CustomEvent<{ tab: string; assetId: number }>("navigate", { detail: { tab, assetId }, bubbles: true, composed: true }));
	}

	private startAddChild(assetId: number): void {
		this.editingNode = { assetId, mode: "add-child" };
		this.draftTitle = "";
		this.contextMenu = null;
	}

	private startRename(assetId: number, title: string): void {
		this.editingNode = { assetId, mode: "rename" };
		this.draftTitle = title;
		this.contextMenu = null;
	}

	private async startDelete(assetId: number): Promise<void> {
		this.editingNode = { assetId, mode: "delete" };
		this.contextMenu = null;
		this.deleteAffected = await this.previewDelete(assetId);
	}

	private cancelEdit(): void {
		this.editingNode = null;
		this.draftTitle = "";
	}

	private async confirmAddChild(parentId: number): Promise<void> {
		const title = this.draftTitle.trim();
		if (title.length === 0) return;
		const kind = parentId === 0 ? this.rootKind : this.childKind(this.nodeKind(parentId) ?? this.rootKind);
		if (!kind) return;
		const nodeId = generateNodeId();
		const tree: SubtreeNodeInput = {
			kind,
			title,
			content: defaultNodeContent(kind, title, nodeId),
			children: [],
		};
		try {
			await createHierarchySubtree(this.apiBase, this.workspaceId, tree, parentId === 0 ? null : parentId);
			this.cancelEdit();
			if (parentId !== 0) {
				this.dispatchExpand(parentId);
				await this.refreshParent(parentId);
			} else {
				await this.load();
			}
		} catch (err) {
			this.setError(err);
		}
	}

	private async confirmRename(assetId: number): Promise<void> {
		const title = this.draftTitle.trim();
		if (title.length === 0) return;
		try {
			const detail = await getAsset(this.apiBase, assetId);
			const currentRevision = detail.revisions.find((r) => r.id === detail.currentRevisionId) ?? detail.revisions.at(-1);
			const expectedRevisionId = detail.currentRevisionId ?? currentRevision?.id ?? 0;
			const content = currentRevision?.content ?? {};
			await updateAsset(this.apiBase, assetId, {
				expectedRevisionId,
				title,
				content,
				relations: detail.resolvedGraph.outgoing.map((r) => ({ toAssetId: r.assetId, type: r.type })),
			});
			this.cancelEdit();
			const parentId = this.findParent(assetId);
			await this.refreshParent(parentId);
		} catch (err) {
			this.setError(err);
		}
	}

	private async confirmDelete(assetId: number): Promise<void> {
		try {
			await deleteAssetSubtree(this.apiBase, assetId, true);
			this.cancelEdit();
			const parentId = this.findParent(assetId);
			await this.refreshParent(parentId);
		} catch (err) {
			this.setError(err);
		}
	}

	private async previewDelete(assetId: number): Promise<readonly { assetId: number; kind: AssetKind; title: string }[]> {
		try {
			const result = await previewSubtreeDeletion(this.apiBase, assetId);
			return result.affected;
		} catch (err) {
			this.setError(err);
			return [];
		}
	}

	private async executeMove(assetId: number, newParentId: number | null): Promise<void> {
		try {
			const detail = await getAsset(this.apiBase, assetId);
			const expectedRevisionId = detail.currentRevisionId ?? detail.revisions.at(-1)?.id ?? 0;
			await moveHierarchySubtree(this.apiBase, this.workspaceId, assetId, expectedRevisionId, newParentId);
			const oldParentId = this.findParent(assetId);
			if (oldParentId !== null) await this.refreshParent(oldParentId);
			await this.refreshParent(newParentId);
		} catch (err) {
			this.setError(err);
		}
	}

	// ---------------------------------------------------------------------------
	// Rendering
	// ---------------------------------------------------------------------------

	render() {
		return html`
			<div class="tree-header">
				<div class="counts">${this.renderCounts()}</div>
				<div class="tree-toolbar">
					<button class="primary icon-btn" @click=${() => this.startAddChild(0)} title="新建顶层${assetKindLabel(this.rootKind)}">+</button>
				</div>
			</div>
			${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
			<div class="tree-body" @dragend=${this.handleDragEnd}>
				${this.renderBody()}
			</div>
			${this.contextMenu ? this.renderContextMenu() : nothing}
		`;
	}

	private renderCounts() {
		const chain = this.chain();
		const counts = chain.map((kind) => html`<span>${assetKindLabel(kind)} ${this.kindCounts[kind] ?? 0}</span>`);
		return html`
			<span>共 <span class="total">${this.total}</span></span>
			${counts}
		`;
	}

	private renderBody() {
		if (this.loading && this.roots.length === 0 && this.searchHits.length === 0) {
			return html`
				<div class="skeleton">
					<div class="skeleton-row"></div>
					<div class="skeleton-row"></div>
					<div class="skeleton-row"></div>
					<div class="skeleton-row"></div>
				</div>
			`;
		}
		if (this.searchQuery.length > 0) return this.renderSearchResults();
		if (this.roots.length === 0) {
			return html`
				<div class="empty">
					<p>暂无 ${assetKindLabel(this.rootKind)}，开始创建第一个。</p>
					<button class="primary" @click=${() => this.startAddChild(0)}>新建 ${assetKindLabel(this.rootKind)}</button>
				</div>
			`;
		}
		return html`
			<div class="tree" role="tree" aria-label="${assetKindLabel(this.rootKind)} 层级树">
				${this.editingNode?.assetId === 0 && this.editingNode.mode === "add-child"
					? this.renderRootAddForm()
					: nothing}
				${this.roots.map((root, index) => this.renderNode(root, null, 0, index))}
			</div>
			${this.renderPagination()}
		`;
	}

	private renderRootAddForm() {
		return html`
			<div class="inline-form" style="padding-left:0">
				<input
					.placeholder=${`新${assetKindLabel(this.rootKind)}标题`}
					.value=${this.draftTitle}
					@input=${(e: Event) => { this.draftTitle = (e.target as HTMLInputElement).value; }}
					@keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void this.confirmAddChild(0); } }}
				/>
				<button class="primary" ?disabled=${this.draftTitle.trim().length === 0} @click=${() => void this.confirmAddChild(0)}>创建</button>
				<button @click=${this.cancelEdit}>取消</button>
			</div>
		`;
	}

	private renderSearchResults() {
		if (this.searchHits.length === 0) {
			return html`
				<div class="empty">
					<p>没有匹配 “${this.searchQuery}” 的结果。</p>
					<button @click=${() => { this.query = ""; void this.load(); }}>清除搜索</button>
				</div>
			`;
		}
		return html`
			<div class="search-results" role="list">
				${this.searchHits.map((hit) => html`
					<div
						class="search-hit"
						role="listitem"
						@click=${() => this.handleSearchHitClick(hit)}
					>
						<div class="path">${hit.matchedPath.join(" / ")}</div>
						<div class="hit-title">${assetKindLabel(hit.kind)} · ${hit.title}</div>
					</div>
				`)}
			</div>
		`;
	}

	private handleSearchHitClick(hit: HierarchySearchHit): void {
		const currentTab = TAB_FOR_KIND[this.rootKind];
		const targetTab = TAB_FOR_KIND[hit.kind];
		if (targetTab !== currentTab) {
			this.dispatchNavigate(targetTab, hit.assetId);
			return;
		}
		this.dispatchSelect(hit.assetId);
		// Locate the hit inside the current root page and expand its ancestor chain.
		void this.locateAndExpand(hit.assetId);
	}

	private async locateAndExpand(assetId: number): Promise<void> {
		if (this.roots.some((root) => root.assetId === assetId)) return;
		for (const root of this.roots) {
			if (!this.childrenMap.has(root.assetId)) await this.loadChildren(root.assetId);
			const children = this.childrenMap.get(root.assetId) ?? [];
			if (children.some((child) => child.assetId === assetId)) {
				this.dispatchExpand(root.assetId);
				return;
			}
			for (const child of children) {
				if (!this.childrenMap.has(child.assetId)) await this.loadChildren(child.assetId);
				const grandchildren = this.childrenMap.get(child.assetId) ?? [];
				if (grandchildren.some((grandchild) => grandchild.assetId === assetId)) {
					this.dispatchExpand(root.assetId);
					this.dispatchExpand(child.assetId);
					return;
				}
			}
		}
	}

	private renderPagination() {
		if (this.searchQuery.length > 0 || this.total <= this.pageSize) return nothing;
		const maxPage = Math.max(1, Math.ceil(this.total / this.pageSize));
		const from = (this.page - 1) * this.pageSize + 1;
		const to = Math.min(this.page * this.pageSize, this.total);
		return html`
			<div class="pagination">
				<button ?disabled=${this.page <= 1} @click=${() => { this.page = Math.max(1, this.page - 1); }}>上一页</button>
				<span class="info">${from}-${to} / ${this.total}</span>
				<button ?disabled=${this.page >= maxPage} @click=${() => { this.page = Math.min(maxPage, this.page + 1); }}>下一页</button>
			</div>
		`;
	}


	private renderNode(
		node: HierarchyRoot | HierarchyChild,
		parentId: number | null,
		depth: number,
		index: number,
	): TemplateResult | typeof nothing {
		const assetId = node.assetId;
		const kind = node.kind;
		const expanded = this.expandedNodes.has(assetId);
		const isLeaf = (node.childCount ?? 0) === 0 && this.childKind(kind) === null;
		const isSelected = this.selectedAssetId === assetId;
		const isDragging = this.dragState?.draggingId === assetId;
		const isDropTarget = this.dragState?.targetParentId === assetId;
		const dropAllowed = isDropTarget && this.dragState?.allowed;
		const dropForbid = isDropTarget && !this.dragState?.allowed;
		const editing = this.editingNode;
		const editingThis = editing?.assetId === assetId ? editing : null;

		return html`
			<div class="node-wrapper" role="treeitem" aria-expanded=${expanded} aria-selected=${isSelected} aria-level=${depth + 1}>
				<div
					class="node ${isLeaf ? "leaf" : ""} ${isDragging ? "dragging" : ""} ${dropAllowed ? "drag-over-allow" : ""} ${dropForbid ? "drag-over-forbid" : ""}"
					draggable=${!this.isRootKind(kind)}
					@dragstart=${(e: DragEvent) => this.handleDragStart(e, assetId)}
					@dragover=${(e: DragEvent) => this.handleDragOver(e, assetId)}
					@dragleave=${this.handleDragLeave}
					@drop=${(e: DragEvent) => this.handleDrop(e, assetId)}
					@click=${() => { this.dispatchSelect(assetId); if (!isLeaf) this.dispatchExpand(assetId); }}
					@dblclick=${() => this.startRename(assetId, node.title)}
					@contextmenu=${(e: MouseEvent) => this.openContextMenu(e, assetId, kind)}
				>
					<span
						class="caret"
						aria-expanded=${expanded}
						@click=${(e: MouseEvent) => { e.stopPropagation(); this.dispatchExpand(assetId); }}
					>▸</span>
					<span class="kind">${assetKindLabel(kind)}</span>
					${editingThis?.mode === "rename"
						? html`<input
							.value=${this.draftTitle}
							@click=${(e: MouseEvent) => e.stopPropagation()}
							@input=${(e: Event) => { this.draftTitle = (e.target as HTMLInputElement).value; }}
							@keydown=${(e: KeyboardEvent) => {
								if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); void this.confirmRename(assetId); }
								if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.cancelEdit(); }
							}}
							@blur=${() => void this.confirmRename(assetId)}
							autofocus
						/>`
						: html`<span class="title">${node.title}</span>`}
					${node.childCount > 0 ? html`<span class="child-count">${node.childCount}</span>` : nothing}
					${this.childKind(kind) ? html`<button class="icon-btn" title="添加${assetKindLabel(this.childKind(kind)!)}" @click=${(e: MouseEvent) => { e.stopPropagation(); this.startAddChild(assetId); }}>+</button>` : nothing}
				</div>
				${editingThis?.mode === "add-child" ? this.renderAddChildForm(assetId, kind) : nothing}
				${editingThis?.mode === "delete" ? this.renderDeletePanel(assetId, kind, node.title) : nothing}
				${expanded ? html`
					<div class="children">
						${this.renderChildren(assetId, depth + 1)}
					</div>
				` : nothing}
			</div>
		`;
	}


	private isRootKind(kind: AssetKind): boolean {
		return kind === "scenario-domain" || kind === "function-domain";
	}

	private renderChildren(parentId: number, depth: number) {
		const children = this.childrenMap.get(parentId) ?? [];
		if (children.length === 0) {
			return html`<div class="empty" style="padding-left:var(--tree-indent)">暂无子节点</div>`;
		}
		return html`
			${children.map((child, index) => html`
				${this.renderDropZone(parentId, index)}
				${this.renderNode(child, parentId, depth, index)}
			`)}
			${this.renderDropZone(parentId, children.length)}
		`;
	}

	private renderDropZone(parentId: number, index: number) {
		if (!this.dragState) return nothing;
		const draggedId = this.dragState.draggingId;
		const draggedKind = this.nodeKind(draggedId);
		const currentParent = this.findParent(draggedId);
		const allowed = currentParent === parentId && draggedKind !== null && this.canContain(this.nodeKind(parentId) ?? this.rootKind, draggedKind);
		const active = this.dragState.targetParentId === -parentId && this.dragState.allowed;
		const forbid = this.dragState.targetParentId === -parentId && !this.dragState.allowed;
		return html`
			<div
				class="drop-zone ${active ? "drag-over" : ""} ${forbid ? "drag-over-forbid" : ""}"
				@dragover=${(e: DragEvent) => this.handleDropZoneDragOver(e, parentId, index)}
				@dragleave=${this.handleDragLeave}
				@drop=${(e: DragEvent) => this.handleDropZoneDrop(e, parentId)}
			></div>
		`;
	}

	private renderAddChildForm(parentId: number, parentKind: AssetKind) {
		const childKind = this.childKind(parentKind);
		if (!childKind) return nothing;
		return html`
			<div class="inline-form">
				<input
					.placeholder=${`新${assetKindLabel(childKind)}标题`}
					.value=${this.draftTitle}
					@input=${(e: Event) => { this.draftTitle = (e.target as HTMLInputElement).value; }}
					@keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void this.confirmAddChild(parentId); } if (e.key === "Escape") { this.cancelEdit(); } }}
					autofocus
				/>
				<button class="primary" ?disabled=${this.draftTitle.trim().length === 0} @click=${() => void this.confirmAddChild(parentId)}>创建</button>
				<button @click=${this.cancelEdit}>取消</button>
			</div>
		`;
	}

	private renderDeletePanel(assetId: number, kind: AssetKind, title: string) {
		return html`
			<div class="delete-panel">
				<h4>确认删除 ${assetKindLabel(kind)} “${title}” 及其子树？</h4>
				${this.renderAffectedList()}
				<div class="tree-toolbar">
					<button class="danger" ?disabled=${this.deleteAffected.length === 0} @click=${() => void this.confirmDelete(assetId)}>确认删除</button>
					<button @click=${this.cancelEdit}>取消</button>
				</div>
			</div>
		`;
	}

	private renderAffectedList() {
		if (this.deleteAffected.length === 0) {
			return html`<p>正在加载受影响节点…</p>`;
		}
		return html`
			<ul>
				${this.deleteAffected.map((node) => html`<li>${assetKindLabel(node.kind)} · ${node.title}</li>`)}
			</ul>
		`;
	}

	private renderContextMenu() {
		if (!this.contextMenu) return nothing;
		const { x, y, assetId, kind } = this.contextMenu;
		const child = this.childKind(kind);
		return html`
			<div class="context-menu" role="menu" style="left:${x}px;top:${y}px">
				${child ? html`<button role="menuitem" @click=${() => this.startAddChild(assetId)}>添加 ${assetKindLabel(child)}</button>` : nothing}
				<button role="menuitem" @click=${() => this.startRename(assetId, this.nodeTitle(assetId) ?? "")}>重命名</button>
				<button role="menuitem" class="danger" @click=${() => this.startDelete(assetId)}>删除</button>
			</div>
		`;
	}

	private nodeTitle(assetId: number): string | null {
		const root = this.roots.find((r) => r.assetId === assetId);
		if (root) return root.title;
		for (const children of this.childrenMap.values()) {
			const child = children.find((c) => c.assetId === assetId);
			if (child) return child.title;
		}
		return null;
	}

	// ---------------------------------------------------------------------------
	// Drag and drop handlers
	// ---------------------------------------------------------------------------

	private handleDragStart(event: DragEvent, assetId: number): void {
		if (!event.dataTransfer) return;
		const kind = this.nodeKind(assetId);
		if (!kind || this.isRootKind(kind)) {
			event.preventDefault();
			return;
		}
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("application/baize-asset-id", String(assetId));
		this.dragState = { draggingId: assetId, targetParentId: null, allowed: false };
	}

	private handleDragOver(event: DragEvent, targetId: number): void {
		event.preventDefault();
		if (!this.dragState) return;
		const draggingId = this.dragState.draggingId;
		const draggedKind = this.nodeKind(draggingId);
		const targetKind = this.nodeKind(targetId);
		if (!draggedKind || !targetKind) return;
		let allowed = false;
		if (targetId !== draggingId && !this.isDescendant(draggingId, targetId)) {
			allowed = this.canContain(targetKind, draggedKind);
		}
		if (this.dragState.targetParentId !== targetId || this.dragState.allowed !== allowed) {
			this.dragState = { ...this.dragState, targetParentId: targetId, allowed };
		}
	}

	private handleDragLeave(): void {
		if (this.dragState) {
			this.dragState = { ...this.dragState, targetParentId: null, allowed: false };
		}
	}

	private handleDrop(event: DragEvent, targetId: number): void {
		event.preventDefault();
		const state = this.dragState;
		this.dragState = null;
		if (!state || !state.allowed || state.targetParentId !== targetId) return;
		const draggingId = state.draggingId;
		if (draggingId === targetId) return;
		void this.executeMove(draggingId, targetId);
	}

	private handleDropZoneDragOver(event: DragEvent, parentId: number, index: number): void {
		event.preventDefault();
		if (!this.dragState) return;
		const draggingId = this.dragState.draggingId;
		const draggedKind = this.nodeKind(draggingId);
		const parentKind = this.nodeKind(parentId) ?? this.rootKind;
		const currentParent = this.findParent(draggingId);
		const allowed = currentParent === parentId && draggedKind !== null && this.canContain(parentKind, draggedKind);
		const targetId = -parentId; // negative sentinel for sibling drop zone
		if (this.dragState.targetParentId !== targetId || this.dragState.allowed !== allowed) {
			this.dragState = { ...this.dragState, targetParentId: targetId, allowed };
		}
	}

	private handleDropZoneDrop(event: DragEvent, parentId: number): void {
		event.preventDefault();
		const state = this.dragState;
		this.dragState = null;
		if (!state || !state.allowed) return;
		void this.executeMove(state.draggingId, parentId);
	}

	private handleDragEnd(): void {
		this.dragState = null;
	}

	// ---------------------------------------------------------------------------
	// Context menu
	// ---------------------------------------------------------------------------

	private openContextMenu(event: MouseEvent, assetId: number, kind: AssetKind): void {
		event.preventDefault();
		this.contextMenu = { assetId, kind, x: event.clientX, y: event.clientY };
	}
}

// Register the custom element after the class declaration.
customElements.define("baize-hierarchy-tree", BaizeHierarchyTree);

export { BaizeHierarchyTree };
