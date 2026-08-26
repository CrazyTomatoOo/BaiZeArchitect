import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import { assetKindLabel, listAssets, type AssetSummary } from "./workflow-client.js";

class BaizeAssetLibrary extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		assets: { state: true },
		loading: { state: true },
		error: { state: true },
	};

	declare apiBase: string;
	declare workspaceId: number;
	declare assets: readonly AssetSummary[];
	declare loading: boolean;
	declare error: string | null;

	static styles = [sharedStyles, css`
		.library { margin-top: var(--gap); }
		.header { display: flex; align-items: baseline; gap: var(--gap); }
		.header h2 { margin: 0; }
		.sub { margin: 4px 0 0; color: var(--text-muted); font-size: var(--text-sm); }
		.count { margin-left: auto; color: var(--text-subtle); font: 600 var(--text-sm) var(--font-mono); }
		.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--gap); margin-top: var(--gap); }
		.asset { min-width: 0; }
		.asset-head { display: flex; align-items: center; gap: 8px; }
		.kind { color: var(--accent-hi); font-size: var(--text-xs); letter-spacing: 0.04em; }
		.title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
		.meta { margin-top: 8px; color: var(--text-muted); font-size: var(--text-sm); }
		.digest { margin-top: 4px; color: var(--text-subtle); font: var(--text-xs) var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.error { color: var(--danger); }
	`];

	constructor() {
		super();
		this.apiBase = "";
		this.workspaceId = 0;
		this.assets = [];
		this.loading = true;
		this.error = null;
	}

	connectedCallback(): void {
		super.connectedCallback();
		void this.load();
	}

	protected updated(changed: Map<string, unknown>): void {
		if ((changed.has("workspaceId") || changed.has("apiBase")) && this.workspaceId > 0 && this.isConnected) void this.load();
	}

	private async load(): Promise<void> {
		if (this.workspaceId <= 0) return;
		this.loading = true;
		this.error = null;
		try {
			this.assets = await listAssets(this.apiBase, this.workspaceId);
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
		}
	}

	render() {
		return html`
			<section class="card library" aria-labelledby="asset-library-title">
				<div class="header">
					<div>
						<h2 id="asset-library-title">设计模型资产</h2>
						<p class="sub">工作空间内可复用的干系人、场景、用例与设计事实。</p>
					</div>
					<span class="count">${this.loading ? "…" : this.assets.length}</span>
				</div>
				${this.loading
					? html`<div class="empty">正在加载资产…</div>`
					: this.error
						? html`<div class="empty error">资产加载失败：${this.error}</div>`
						: this.assets.length === 0
							? html`<div class="empty">暂无设计模型资产。归档已批准设计后，资产会自动沉淀到这里。</div>`
							: html`<div class="grid">
								${this.assets.map((asset) => html`
									<article class="card asset">
										<div class="asset-head"><span class="kind">${assetKindLabel(asset.kind)}</span><span class="title">${asset.title}</span></div>
										<div class="meta">${asset.currentRevision ? `Revision ${asset.currentRevision.revisionNo}` : "暂无当前版本"}</div>
										${asset.currentRevision ? html`<div class="digest">${asset.currentRevision.digest}</div>` : nothing}
									</article>
								`)}
							</div>`}
			</section>
		`;
	}
}

customElements.define("baize-asset-library", BaizeAssetLibrary);
