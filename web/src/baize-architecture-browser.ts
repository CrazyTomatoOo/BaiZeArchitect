import { LitElement, css, html, type TemplateResult } from "lit";
import type { CanvasIntent } from "./baize-c4-canvas.js";
import type { C4Layer, VisibleGraph } from "./c4-canvas-model.js";

type TreeNode = { name: string; path: string; kind: "directory" | "file"; children?: TreeNode[] };
type SnapshotMetadata = {
	id: string;
	repositoryId: string;
	headSha: string;
	projectionVersion: string;
	contentHash: string;
	generatedAt: string;
	roots: Record<C4Layer, string[]>;
	nodeCount: number;
	edgeCount: number;
};

const LAYERS: C4Layer[] = ["context", "container", "component", "code"];
const LAYER_LABEL: Record<C4Layer, string> = { context: "Context", container: "Container", component: "Component", code: "Code" };

class BaizeArchitectureBrowser extends LitElement {
	static properties = {
		repo: {}, tree: { state: true }, snapshot: { state: true }, graph: { state: true }, level: { state: true }, root: { state: true },
		query: { state: true }, selectedNodeId: { state: true }, focusNodeId: { state: true }, loading: { state: true }, error: { state: true },
	};

	declare repo: string;
	declare tree: TreeNode[];
	declare snapshot: SnapshotMetadata | null;
	declare graph: VisibleGraph | null;
	declare level: C4Layer;
	declare root: string;
	declare query: string;
	declare selectedNodeId: string;
	declare focusNodeId: string;
	declare loading: boolean;
	declare error: string;
	private controller?: AbortController;
	private canvasLoaded = false;

	static styles = css`
		:host { display:block; min-height:100%; } :host([hidden]) { display:none; }
		.page-head { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; margin-bottom:1rem; } .page-head h1 { margin:0; font:650 1.4rem var(--font-display); }
		.sub { margin:4px 0 0; color:var(--text-muted); font-size:.86rem; line-height:1.5; } .actions,.controls,.levels { display:flex; gap:.5rem; flex-wrap:wrap; align-items:center; }
		button,input { font:inherit; } button { cursor:pointer; } .primary,.secondary,.level { border:1px solid var(--border-strong); border-radius:var(--radius-sm); background:transparent; color:var(--text); padding:.5rem .8rem; }
		.primary { background:var(--accent); border-color:var(--accent); color:var(--accent-fg); font-weight:650; } button:disabled { opacity:.45; cursor:not-allowed; } button:focus-visible,input:focus-visible { outline:3px solid var(--warn); outline-offset:2px; }
		.layout { display:grid; grid-template-columns:250px minmax(0,1fr); gap:12px; }.card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:14px; min-width:0; }.tree-card { overflow:auto; }.card-title { margin:0 0 .7rem; color:var(--text-muted); font-size:.72rem; letter-spacing:.06em; }
		details { margin-left:.2rem; } details details { margin-left:.85rem; } summary { padding:.26rem .2rem; color:var(--text); cursor:pointer; font-size:.78rem; list-style:none; } summary::before { content:"▸"; display:inline-block; width:1rem; color:var(--text-subtle); } details[open] > summary::before { content:"▾"; }
		.file { display:block; padding:.26rem .2rem .26rem 1.2rem; color:var(--text-muted); font:.73rem var(--font-mono); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.level { border-radius:99px; font-size:.76rem; }.level.active { background:var(--accent); color:var(--accent-fg); border-color:var(--accent); }.level small { opacity:.75; margin-left:.25rem; }
		.controls { margin:0 0 12px; }.controls input { min-width:180px; flex:1; border:1px solid var(--border-strong); border-radius:var(--radius-sm); padding:.48rem .65rem; background:var(--surface); color:var(--text); }.snapshot { color:var(--text-muted); font:.72rem var(--font-mono); }.error,.empty { color:var(--text-muted); font-size:.8rem; }.error { color:var(--danger); } @media (max-width:900px) { .layout { grid-template-columns:1fr; }.tree-card { min-height:220px; } .page-head { flex-direction:column; } }
	`;

	constructor() {
		super();
		this.repo = ""; this.tree = []; this.snapshot = null; this.graph = null; this.level = "context"; this.root = "";
		this.query = ""; this.selectedNodeId = ""; this.focusNodeId = ""; this.loading = false; this.error = "";
	}

	updated(changed: Map<string, unknown>): void {
		if (changed.has("repo") && this.repo) void this.load();
	}

	private async load(updateToLatest = false): Promise<void> {
		if (!this.repo) return;
		this.controller?.abort();
		this.controller = new AbortController();
		this.loading = true;
		this.error = "";
		const id = encodeURIComponent(this.repo);
		const requestedSnapshot = updateToLatest ? "" : new URLSearchParams(location.search).get("c4Snapshot") ?? "";
		const snapshotRequest = requestedSnapshot
			? fetch(`/api/architecture/${id}/c4/snapshots/${encodeURIComponent(requestedSnapshot)}`, { signal: this.controller.signal })
			: fetch(`/api/architecture/${id}/c4/snapshots/resolve`, { method: "POST", signal: this.controller.signal });
		try {
			const [treeResponse, snapshotResponse] = await Promise.all([
				fetch(`/api/architecture/${id}/tree`, { signal: this.controller.signal }),
				snapshotRequest,
			]);
			if (!treeResponse.ok || !snapshotResponse.ok) throw new Error(`Architecture request failed (${treeResponse.status}/${snapshotResponse.status})`);
			this.tree = ((await treeResponse.json()) as { tree?: TreeNode[] }).tree ?? [];
			this.snapshot = await snapshotResponse.json() as SnapshotMetadata;
			if (updateToLatest) {
				this.root = "";
				this.selectedNodeId = "";
				this.focusNodeId = "";
			} else this.restoreNavigation();
			this.root = this.root || this.snapshot.roots[this.level]?.[0] || "";
			await this.loadVisibleGraph();
		} catch (error) {
			if ((error as Error).name !== "AbortError") this.error = error instanceof Error ? error.message : "Architecture data could not be loaded";
		} finally {
			this.loading = false;
		}
	}

	private async loadVisibleGraph(): Promise<void> {
		if (!this.snapshot || !this.repo) return;
		const params = new URLSearchParams({ layer: this.level, maxNodes: "500" });
		if (this.root) params.set("root", this.root);
		if (this.query) params.set("query", this.query);
		if (this.focusNodeId) params.set("focus", this.focusNodeId);
		const response = await fetch(`/api/architecture/${encodeURIComponent(this.repo)}/c4/snapshots/${encodeURIComponent(this.snapshot.id)}/visible?${params}`, { signal: this.controller?.signal });
		if (!response.ok) throw new Error(`Visible Graph request failed (${response.status})`);
		await this.ensureCanvas();
		this.graph = await response.json() as VisibleGraph;
		this.writeNavigation();
	}

	private async refresh(): Promise<void> { await this.load(true); }
	private async switchLayer(level: C4Layer): Promise<void> { this.level = level; this.root = this.snapshot?.roots[level]?.[0] || ""; this.selectedNodeId = ""; this.focusNodeId = ""; await this.loadVisibleGraph(); }
	private async submitSearch(event: Event): Promise<void> { event.preventDefault(); await this.loadVisibleGraph(); }
	private async toggleFocus(): Promise<void> { this.focusNodeId = this.focusNodeId ? "" : this.selectedNodeId; await this.loadVisibleGraph(); }
	private async drillDown(nodeId: string): Promise<void> {
		const next = LAYERS[LAYERS.indexOf(this.level) + 1];
		if (!next) return;
		this.level = next;
		this.root = nodeId;
		this.selectedNodeId = "";
		this.focusNodeId = "";
		await this.loadVisibleGraph();
	}

	private onCanvasIntent(event: CustomEvent<CanvasIntent>): void {
		const intent = event.detail;
		if (intent.type === "select") { this.selectedNodeId = intent.nodeId; this.writeNavigation(); }
		if (intent.type === "drill-down") void this.drillDown(intent.nodeId);
	}

	private restoreNavigation(): void {
		const params = new URLSearchParams(location.search);
		const level = params.get("c4Layer");
		if (level && LAYERS.includes(level as C4Layer)) this.level = level as C4Layer;
		this.root = params.get("c4Root") || "";
		this.query = params.get("c4Query") || "";
		this.focusNodeId = params.get("c4Focus") || "";
		this.selectedNodeId = params.get("c4Select") || "";
	}

	private writeNavigation(): void {
		if (!this.snapshot) return;
		const params = new URLSearchParams(location.search);
		params.set("c4Snapshot", this.snapshot.id); params.set("c4Layer", this.level);
		if (this.root) params.set("c4Root", this.root); else params.delete("c4Root");
		for (const [key, value] of [["c4Query", this.query], ["c4Focus", this.focusNodeId], ["c4Select", this.selectedNodeId]] as const) value ? params.set(key, value) : params.delete(key);
		history.replaceState(null, "", `${location.pathname}?${params.toString()}${location.hash}`);
	}

	private async ensureCanvas(): Promise<void> {
		if (this.canvasLoaded) return;
		await import("./baize-c4-canvas.js");
		this.canvasLoaded = true;
	}

	private renderTree(nodes: TreeNode[], depth = 0): TemplateResult[] {
		return nodes.map((node) => node.kind === "directory" ? html`<details ?open=${depth === 0}><summary>${node.name}</summary>${this.renderTree(node.children ?? [], depth + 1)}</details>` : html`<span class="file" title=${node.path}>${node.name}</span>`);
	}

	render() {
		return html`
			<div class="page-head"><div><h1>架构浏览</h1><p class="sub">从目录、运行单元到代码职责块，逐层理解仓库结构。当前仓库：<strong>${this.repo || "—"}</strong></p></div><div class="actions"><button class="secondary" @click=${this.refresh} ?disabled=${this.loading}>刷新</button><button class="primary" @click=${this.refresh} ?disabled=${this.loading}>${this.loading ? "更新中…" : "更新到最新提交"}</button></div></div>
			${this.error ? html`<p class="error" role="alert">${this.error}</p>` : null}
			<div class="layout">
				<section class="card tree-card"><h2 class="card-title">目录树</h2>${this.loading ? html`<p class="empty">读取中…</p>` : this.tree.length ? this.renderTree(this.tree) : html`<p class="empty">暂无目录数据</p>`}</section>
				<section>
					<div class="levels">${LAYERS.map((item) => html`<button class="level ${item === this.level ? "active" : ""}" @click=${() => this.switchLayer(item)}>${LAYER_LABEL[item]}</button>`)}</div>
					<form class="controls" @submit=${this.submitSearch}><input aria-label="Search architecture nodes" .value=${this.query} @input=${(event: InputEvent) => { this.query = (event.target as HTMLInputElement).value; }} placeholder="搜索当前快照中的节点" /><button class="secondary" type="submit">筛选</button><button class="secondary" @click=${this.toggleFocus} ?disabled=${!this.selectedNodeId}>${this.focusNodeId ? "退出邻居聚焦" : "聚焦邻居"}</button><span class="snapshot">${this.snapshot ? `${this.snapshot.headSha.slice(0, 8)} · ${this.graph?.nodes.length ?? 0} nodes` : "No snapshot"}</span></form>
					${this.graph ? html`<baize-c4-canvas .graph=${this.graph} .selectedNodeId=${this.selectedNodeId} .rootLabel=${this.root || "Architecture root"} .rootId=${this.root || "root"} .filters=${this.query ? [`query:${this.query}`] : []} .focused=${Boolean(this.focusNodeId)} .status=${this.loading ? "Refreshing architecture view" : ""} @c4-canvas-intent=${this.onCanvasIntent}></baize-c4-canvas>` : html`<section class="card empty">${this.loading ? "正在准备不可变架构快照…" : "暂无可用架构图。"}</section>`}
				</section>
			</div>
		`;
	}
}

customElements.define("baize-architecture-browser", BaizeArchitectureBrowser);

declare global { interface HTMLElementTagNameMap { "baize-architecture-browser": BaizeArchitectureBrowser; } }
