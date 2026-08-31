import { LitElement, html, css, nothing, type PropertyValues, type TemplateResult } from "lit";
import { sharedStyles } from "./baize-styles.js";
import { listAssets, type AssetKind, type AssetSummary } from "./workflow-client.js";
import { assetKindLabel, emptyKindCounts } from "./baize-asset-library-constants.js";

/**
 * baize-asset-entries — 侧栏资产条目列表(卡片式:标题 + rev/日期元信息行)。
 * 选中态通过 `baize-asset-select` 事件向上抛,由 shell/库页写入 URL `?asset=<id>`。
 */
class BaizeAssetEntries extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		kind: { type: String },
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
	declare selectedAssetId: number;
	declare refresh: number;
	declare assets: readonly AssetSummary[];
	declare total: number;
	declare loading: boolean;
	declare error: string | null;
	declare kindCounts: Readonly<Record<AssetKind, number>>;
	private currentRequest = 0;

	static styles = [sharedStyles, css`
		:host {
			display: flex;
			flex-direction: column;
			min-height: 0;
			height: 100%;
		}
		.entries {
			flex: 1 1 auto;
			min-height: 0;
			overflow-y: auto;
			padding: var(--gap);
			display: flex;
			flex-direction: column;
			gap: var(--gap);
		}
		.entry-card {
			display: block;
			width: 100%;
			text-align: left;
			background: var(--surface-2);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 8px 10px;
			color: var(--text);
			cursor: pointer;
			font-family: inherit;
			font-size: inherit;
		}
		.entry-card:hover {
			border-color: var(--border-strong);
		}
		.entry-card.selected {
			border-left: var(--accent-border-w) solid var(--accent);
		}
		.entry-title {
			font-weight: 600;
			font-size: var(--text-base);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.entry-meta {
			margin-top: 3px;
			font-size: var(--text-xs);
			color: var(--text-subtle);
			font-family: var(--font-mono);
			display: flex;
			gap: 8px;
		}
		.empty {
			padding: var(--pad);
			color: var(--text-muted);
			font-size: var(--text-sm);
			text-align: center;
		}
		.error {
			padding: var(--pad);
			color: var(--danger);
			font-size: var(--text-sm);
		}
	`];

	constructor() {
		super();
		this.apiBase = "";
		this.workspaceId = 0;
		this.kind = "design";
		this.selectedAssetId = 0;
		this.refresh = 0;
		this.assets = [];
		this.total = 0;
		this.loading = false;
		this.error = null;
		this.kindCounts = emptyKindCounts();
	}

	protected updated(changed: PropertyValues<this>): void {
		if ((changed.has("workspaceId") || changed.has("apiBase") || changed.has("kind") || changed.has("refresh")) && this.workspaceId > 0 && this.isConnected) {
			void this.load();
		}
	}

	private async load(): Promise<void> {
		const requestId = ++this.currentRequest;
		this.loading = true;
		this.error = null;
		try {
			const page = await listAssets(this.apiBase, this.workspaceId, { kind: this.kind, page: 1, pageSize: 48 });
			if (requestId !== this.currentRequest) return;
			this.assets = page.assets;
			this.total = page.total;
			this.kindCounts = page.kindCounts;
		} catch (err) {
			if (requestId !== this.currentRequest) return;
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			if (requestId === this.currentRequest) this.loading = false;
		}
	}

	private chooseAsset(assetId: number): void {
		this.dispatchEvent(
			new CustomEvent("baize-asset-select", {
				detail: { assetId },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private renderEntry(asset: AssetSummary): TemplateResult {
		const revision = asset.currentRevision;
		const selected = this.selectedAssetId === asset.id;
		return html`
			<button
				class="entry-card ${selected ? "selected" : ""}"
				aria-pressed=${selected}
				@click=${() => this.chooseAsset(asset.id)}
			>
				<div class="entry-title">${asset.title}</div>
				<div class="entry-meta">
					<span>${assetKindLabel(asset.kind)}</span>
					<span>${revision ? `r${revision.revisionNo}` : "—"}</span>
					<span>${new Date(asset.createdAt).toLocaleDateString("zh-CN")}</span>
				</div>
			</button>
		`;
	}

	render(): TemplateResult {
		if (this.loading && this.assets.length === 0) {
			return html`<div class="empty">正在加载…</div>`;
		}
		if (this.error) {
			return html`<div class="error">加载失败:${this.error}</div>`;
		}
		if (this.assets.length === 0) {
			return html`<div class="empty">暂无资产。归档或创建后,资产会出现在这里。</div>`;
		}
		return html`
			<div class="entries" role="list">
				${this.assets.map((asset) => html`<div role="listitem">${this.renderEntry(asset)}</div>`)}
			</div>
		`;
	}
}

customElements.define("baize-asset-entries", BaizeAssetEntries);
