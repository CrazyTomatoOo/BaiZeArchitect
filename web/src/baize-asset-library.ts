import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import {
	assetKindLabel,
	createAsset,
	deleteAsset,
	exportAssets,
	getAsset,
	importAssets,
	listAssets,
	type AssetDetail,
	type AssetSummary,
} from "./workflow-client.js";

type Kind = "scenario" | "usecase" | "function" | "actor";
const KINDS: Kind[] = ["scenario", "usecase", "function"];

/** baize-asset-library — 资产库:场景/用例/功能复用池,支持新建/删除/导入/导出。 */
class BaizeAssetLibrary extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		kind: { state: true },
		assets: { state: true },
		selected: { state: true },
		loading: { state: true },
		error: { state: true },
		createOpen: { state: true },
		title: { state: true },
		content: { state: true },
		importOpen: { state: true },
		importText: { state: true },
		busy: { state: true },
	};

	declare apiBase: string;
	declare workspaceId: number;
	declare kind: Kind;
	declare assets: AssetSummary[];
	declare selected: AssetDetail | null;
	declare loading: boolean;
	declare error: string | null;
	declare createOpen: boolean;
	declare title: string;
	declare content: string;
	declare importOpen: boolean;
	declare importText: string;
	declare busy: boolean;

	static styles = [sharedStyles, css`
		.tabs { display: flex; gap: 4px; margin-top: var(--gap); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
		.tab { padding: 9px 16px; background: transparent; border: none; border-bottom: 2px solid transparent; color: var(--text-muted); cursor: pointer; font: inherit; font-size: var(--text-sm); }
		.tab.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
		.body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: var(--gap); margin-top: var(--gap); }
		.list { display: grid; gap: 6px; align-content: start; }
		.item { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; cursor: pointer; }
		.item.active { border-color: var(--accent-line); background: var(--accent-glow); }
		.item .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.detail pre { background: var(--surface-2); border-radius: var(--radius-sm); padding: 10px; overflow: auto; max-height: 320px; }
		.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
		.form { display: flex; flex-direction: column; gap: 8px; margin-top: var(--gap); max-width: 520px; }
		@media (max-width: 900px) { .body { grid-template-columns: minmax(0, 1fr); } }
	`];

	constructor() {
		super();
		this.apiBase = "";
		this.workspaceId = 1;
		this.kind = "scenario";
		this.assets = [];
		this.selected = null;
		this.loading = true;
		this.error = null;
		this.createOpen = false;
		this.title = "";
		this.content = "";
		this.importOpen = false;
		this.importText = "";
		this.busy = false;
	}

	connectedCallback(): void {
		super.connectedCallback();
		void this.load();
	}

	private async load(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const all = await listAssets(this.apiBase, this.workspaceId);
			this.assets = all.filter((a) => a.kind === this.kind);
			this.selected = null;
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		} finally {
			this.loading = false;
		}
	}

	private setKind(kind: Kind): void {
		this.kind = kind;
		void this.load();
	}

	private async select(id: number): Promise<void> {
		try {
			this.selected = await getAsset(this.apiBase, id);
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		}
	}

	private async handleCreate(e: Event): Promise<void> {
		e.preventDefault();
		this.busy = true;
		this.error = null;
		try {
			let parsed: unknown;
			try {
				parsed = this.content.trim() ? JSON.parse(this.content) : this.content;
			} catch {
				parsed = this.content;
			}
			await createAsset(this.apiBase, this.workspaceId, { kind: this.kind, title: this.title, content: parsed });
			this.title = "";
			this.content = "";
			this.createOpen = false;
			await this.load();
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.busy = false;
		}
	}

	private async handleDelete(id: number): Promise<void> {
		this.busy = true;
		try {
			await deleteAsset(this.apiBase, id);
			await this.load();
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		} finally {
			this.busy = false;
		}
	}

	private async handleExport(): Promise<void> {
		try {
			const data = await exportAssets(this.apiBase, this.workspaceId);
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `baize-assets-ws${this.workspaceId}.json`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		}
	}

	private async handleImport(e: Event): Promise<void> {
		e.preventDefault();
		this.busy = true;
		this.error = null;
		try {
			const parsed = JSON.parse(this.importText) as { kind: Kind; title: string; content: unknown }[];
			await importAssets(this.apiBase, this.workspaceId, parsed);
			this.importText = "";
			this.importOpen = false;
			await this.load();
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.busy = false;
		}
	}

	render() {
		return html`
			<div class="page-head"><h1>资产库</h1><p class="sub">归档后的场景、用例、功能沉淀为可复用资产,供后续设计引用。</p></div>

			<div class="tabs">
				${KINDS.map((k) => html`<button class="tab ${k === this.kind ? "active" : ""}" @click=${() => this.setKind(k)}>${assetKindLabel(k)}库</button>`)}
				<span style="flex:1"></span>
				<button @click=${() => (this.importOpen = !this.importOpen)}>导入</button>
				<button @click=${() => void this.handleExport()}>导出</button>
				<button class="primary" @click=${() => (this.createOpen = !this.createOpen)}>＋ 新建</button>
			</div>

			${this.createOpen
				? html`<form class="card form" @submit=${(e: Event) => void this.handleCreate(e)}>
						<h3>新建${assetKindLabel(this.kind)}</h3>
						<input type="text" placeholder="标题" .value=${this.title} @input=${(e: Event) => (this.title = (e.target as HTMLInputElement).value)} required />
						<textarea placeholder="内容(JSON 或纯文本)" .value=${this.content} @input=${(e: Event) => (this.content = (e.target as HTMLTextAreaElement).value)} rows="5" required></textarea>
						<div class="command-row"><button class="primary" type="submit" ?disabled=${this.busy}>保存</button></div>
					</form>`
				: nothing}

			${this.importOpen
				? html`<form class="card form" @submit=${(e: Event) => void this.handleImport(e)}>
						<h3>导入资产(JSON 数组)</h3>
						<textarea placeholder='[{"kind":"scenario","title":"…","content":{…}}]' .value=${this.importText} @input=${(e: Event) => (this.importText = (e.target as HTMLTextAreaElement).value)} rows="6" required></textarea>
						<div class="command-row"><button class="primary" type="submit" ?disabled=${this.busy}>导入</button></div>
					</form>`
				: nothing}

			${this.error ? html`<div class="error">${this.error}</div>` : nothing}
			${this.loading
				? html`<div class="empty">加载中…</div>`
				: html`<div class="body">
						<div class="list">
							${this.assets.length === 0
								? html`<div class="card"><div class="empty">${assetKindLabel(this.kind)}库为空。归档需求或手动新建后,资产会出现在这里。</div></div>`
								: this.assets.map((a) => html`
									<button class="card item ${this.selected?.id === a.id ? "active" : ""}" @click=${() => void this.select(a.id)}>
										<span class="grow">${a.title}</span>
										<span class="badge">r${a.currentRevision?.revisionNo ?? 0}</span>
									</button>`)}
						</div>
						<div class="card detail">
							${this.selected
								? html`<h3>${this.selected.title}</h3>
										<div class="mono">类别:${assetKindLabel(this.selected.kind)} · 修订 ${this.selected.revisions.length} 个</div>
										<pre>${JSON.stringify(this.selected.revisions[this.selected.revisions.length - 1]?.content ?? null, null, 2)}</pre>
										<div class="actions">
											<button class="danger" ?disabled=${this.busy} @click=${() => void this.handleDelete(this.selected!.id)}>删除</button>
										</div>`
								: html`<div class="empty">从左侧选择一个${assetKindLabel(this.kind)}查看详情。</div>`}
						</div>
					</div>`}
		`;
	}
}

customElements.define("baize-asset-library", BaizeAssetLibrary);
