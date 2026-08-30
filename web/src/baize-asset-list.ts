import { LitElement, html, type PropertyValues } from "lit";
import { listAssets, type AssetKind, type AssetPage, type AssetSummary } from "./workflow-client.js";
import {
	assetKindLabel,
	emptyKindCounts,
	PAGE_SIZE_OPTIONS,
	positiveInteger,
	type Renderable,
} from "./baize-asset-library-constants.js";

export class BaizeAssetList extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		kind: { type: String },
		query: { type: String },
		page: { type: Number },
		pageSize: { type: Number, attribute: "page-size" },
		selectedAssetId: { type: Number, attribute: "selected-asset-id" },
		refresh: { type: Number },
		assets: { state: true },
		total: { state: true },
		loading: { state: true },
		error: { state: true },
		kindCounts: { state: true },
	};

	declare apiBase: string;
	declare workspaceId: number;
	declare kind: AssetKind;
	declare query: string;
	declare page: number;
	declare pageSize: number;
	declare selectedAssetId: number;
	declare refresh: number;

	declare assets: readonly AssetSummary[];
	declare total: number;
	declare loading: boolean;
	declare error: string | null;
	declare kindCounts: Readonly<Record<AssetKind, number>>;
	private currentRequest = 0;

	createRenderRoot(): HTMLElement {
		return this;
	}

	constructor() {
		super();
		this.apiBase = "";
		this.workspaceId = 0;
		this.kind = "design";
		this.query = "";
		this.page = 1;
		this.pageSize = 12;
		this.selectedAssetId = 0;
		this.refresh = 0;
		this.assets = [];
		this.total = 0;
		this.loading = false;
		this.error = null;
		this.kindCounts = emptyKindCounts();
	}

	protected updated(changed: PropertyValues<this>): void {
		if (changed.has("workspaceId") || changed.has("apiBase")) {
			if (this.workspaceId > 0) void this.load();
			return;
		}
		if (
			changed.has("kind") ||
			changed.has("query") ||
			changed.has("page") ||
			changed.has("pageSize") ||
			changed.has("refresh")
		) {
			void this.load();
		}
	}

	private async load(): Promise<void> {
		if (this.workspaceId <= 0) return;
		const requestNo = ++this.currentRequest;
		this.loading = true;
		this.error = null;
		try {
			const result: AssetPage = await listAssets(this.apiBase, this.workspaceId, {
				page: this.page,
				pageSize: this.pageSize,
				kind: this.kind,
				q: this.query,
			});
			if (requestNo !== this.currentRequest) return;
			this.assets = result.assets;
			this.total = result.total;
			this.page = result.page;
			this.pageSize = result.pageSize;
			this.kindCounts = result.kindCounts;
			this.dispatchEvent(
				new CustomEvent("baize-asset-page", {
					detail: {
						assets: this.assets,
						total: this.total,
						page: this.page,
						pageSize: this.pageSize,
						kindCounts: this.kindCounts,
					},
					bubbles: true,
					composed: true,
				}),
			);
			if (this.selectedAssetId === 0 && result.assets[0]) {
				this.dispatchEvent(
					new CustomEvent("baize-select-asset", {
						detail: result.assets[0].id,
						bubbles: true,
						composed: true,
					}),
				);
			}
		} catch (error) {
			if (requestNo !== this.currentRequest) return;
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			if (requestNo === this.currentRequest) this.loading = false;
		}
	}

	private chooseAsset(assetId: number): void {
		this.dispatchEvent(
			new CustomEvent("baize-select-asset", {
				detail: assetId,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private updatePage(delta: number): void {
		const next = positiveInteger(String(this.page + delta), 1);
		this.dispatchEvent(
			new CustomEvent("baize-page-change", {
				detail: next,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private updatePageSize(size: number): void {
		this.dispatchEvent(
			new CustomEvent("baize-page-size-change", {
				detail: size,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private renderAssetRow(asset: AssetSummary): Renderable {
		const revision = asset.currentRevision;
		const selected = this.selectedAssetId === asset.id;
		return html`<button
			class="asset-row ${selected ? "selected" : ""}"
			aria-pressed=${selected}
			@click=${() => this.chooseAsset(asset.id)}
		>
			<div class="row-head">
				<span class="kind">${assetKindLabel(asset.kind)}</span>
				<span class="title">${asset.title}</span>
			</div>
			<div class="meta">
				${revision ? `Revision ${revision.revisionNo} · ${revision.source}` : "暂无当前版本"} · ${new Date(asset.createdAt).toLocaleDateString("zh-CN")}
			</div>
			${revision ? html`<div class="digest">${revision.digest}</div>` : ""}
		</button>`;
	}

	render(): Renderable {
		if (this.loading) return html`<div class="empty">正在加载资产…</div>`;
		if (this.error) return html`<div class="empty error">资产加载失败：${this.error}</div>`;
		const selectedHidden =
			this.selectedAssetId !== 0 &&
			!this.assets.some((asset) => asset.id === this.selectedAssetId);
		if (this.assets.length === 0) {
			return html`
				${selectedHidden ? html`<p class="selected-note">当前选中的资产不在此筛选结果中。</p>` : ""}
				<div class="empty">${this.query ? "没有匹配当前标题过滤条件的资产。" : "暂无资产。归档或创建后，资产会出现在这里。"}</div>
			`;
		}
		return html`
			${selectedHidden ? html`<p class="selected-note">当前选中的资产不在此筛选结果中。</p>` : ""}
			<div class="list" role="list">${this.assets.map((asset) => html`<div role="listitem">${this.renderAssetRow(asset)}</div>`)}</div>
			<div class="pager">
				<span>第 ${this.page} / ${Math.max(1, Math.ceil(this.total / this.pageSize))} 页 · ${this.total} 项</span>
				<label
					>每页
					<select .value=${String(this.pageSize)} @change=${(event: Event) => this.updatePageSize(Number((event.target as HTMLSelectElement).value))}>
						${PAGE_SIZE_OPTIONS.map((size) => html`<option value=${size}>${size}</option>`)}
					</select>
				</label>
				<span class="pager-actions">
					<button ?disabled=${this.page <= 1} @click=${() => this.updatePage(-1)}>上一页</button>
					<button ?disabled=${this.page >= Math.ceil(this.total / this.pageSize)} @click=${() => this.updatePage(1)}>下一页</button>
				</span>
			</div>
		`;
	}
}

customElements.define("baize-asset-list", BaizeAssetList);
