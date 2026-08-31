import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import {
	WorkspaceApiError,
	createWorkspace,
	createWorkspaceErrorCopy,
	deleteWorkspace,
	deleteWorkspaceErrorCopy,
	listWorkspaces,
	normalizeWorkspaceInput,
	type WorkspaceSummary,
} from "./workflow-client.js";

/**
 * baize-workspace-manager — 工作区管理页:列表 + 新建 + 行内两步删除确认。
 * 行容器为 div.card(非 button,防非法嵌套);整卡点击进入工作区,删除按钮 stopPropagation。
 * 当前工作区条目以 accent 左条 + accent-glow 背景标识;非当前条目左条淡化为 border 色。
 * 删除确认沿决议 10:行内展开 role="dialog" 两步确认,不可恢复文案,不使用浏览器原生确认框。
 * 对外事件:baize-enter-workspace{id}(进入/创建后直接进入)、baize-workspace-deleted{id}(删除成功)。
 */
class BaizeWorkspaceManager extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		workspaces: { state: true },
		loading: { state: true },
		loadError: { state: true },
		createOpen: { state: true },
		name: { state: true },
		repoPath: { state: true },
		creating: { state: true },
		createError: { state: true },
		confirmId: { state: true },
		deletingId: { state: true },
		deleteError: { state: true },
	};

	declare apiBase: string;
	declare workspaceId: number;
	declare workspaces: readonly WorkspaceSummary[];
	declare loading: boolean;
	declare loadError: string | null;
	declare createOpen: boolean;
	declare name: string;
	declare repoPath: string;
	declare creating: boolean;
	declare createError: string | null;
	declare confirmId: number | null;
	declare deletingId: number | null;
	declare deleteError: string | null;

	static styles = [sharedStyles, css`
		.page-head { display: flex; align-items: center; gap: var(--gap); }
		.spacer { flex: 1; }
		.row { display: flex; align-items: center; gap: var(--gap); }
		.grow { flex: 1; min-width: 0; }
		.title { font-weight: 600; }
		.meta { margin-top: 4px; color: var(--text-muted); }
		.actions { display: flex; gap: 8px; flex: 0 0 auto; }
		.form-card { display: flex; flex-direction: column; gap: 10px; margin-top: var(--gap); }
		.command-row { display: flex; justify-content: flex-end; }
		.list { display: flex; flex-direction: column; gap: var(--gap); margin-top: var(--gap); }
		/* 条目整卡可点击进入(ADR-012);非当前条目左条淡化,当前条目 accent 左条 + 微光背景 */
		.item { cursor: pointer; border-left-color: var(--border); transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out); }
		.item:hover { background: var(--surface-hover); }
		.item:focus-visible { outline: var(--focus-ring); outline-offset: 1px; }
		.item.current { border-left-color: var(--accent); background: var(--accent-glow); }
		.error { color: var(--danger); font-size: var(--text-sm); margin-top: 8px; }
		.confirm { border-top: 1px solid var(--border); margin-top: var(--gap); padding-top: var(--gap); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
		.confirm .text { font-size: var(--text-sm); color: var(--text-muted); flex: 1; min-width: 200px; }
	`];

	constructor() {
		super();
		this.apiBase = "";
		this.workspaceId = 0;
		this.workspaces = [];
		this.loading = true;
		this.loadError = null;
		this.createOpen = false;
		this.name = "";
		this.repoPath = "";
		this.creating = false;
		this.createError = null;
		this.confirmId = null;
		this.deletingId = null;
		this.deleteError = null;
	}

	connectedCallback(): void {
		super.connectedCallback();
		void this.load();
	}

	private async load(): Promise<void> {
		this.loading = true;
		this.loadError = null;
		try {
			this.workspaces = await listWorkspaces(this.apiBase);
		} catch (e) {
			this.loadError = e instanceof Error ? e.message : String(e);
		} finally {
			this.loading = false;
		}
	}

	private enter(workspaceId: number): void {
		this.dispatchEvent(new CustomEvent("baize-enter-workspace", { detail: { id: workspaceId }, bubbles: true, composed: true }));
	}

	private async handleCreate(e: Event): Promise<void> {
		e.preventDefault();
		const input = normalizeWorkspaceInput(this.name, this.repoPath);
		if (!input) {
			this.createError = createWorkspaceErrorCopy(new WorkspaceApiError(400, "malformed_workspace", "malformed"));
			return;
		}
		this.creating = true;
		this.createError = null;
		try {
			const workspaceId = await createWorkspace(this.apiBase, input);
			this.name = "";
			this.repoPath = "";
			this.createOpen = false;
			this.enter(workspaceId);
		} catch (err) {
			this.createError = createWorkspaceErrorCopy(err);
		} finally {
			this.creating = false;
		}
	}

	private askDelete(workspaceId: number): void {
		this.confirmId = workspaceId;
		this.deleteError = null;
	}

	private cancelDelete(): void {
		this.confirmId = null;
		this.deleteError = null;
	}

	private async confirmDelete(workspaceId: number): Promise<void> {
		this.deletingId = workspaceId;
		this.deleteError = null;
		try {
			await deleteWorkspace(this.apiBase, workspaceId);
			this.workspaces = this.workspaces.filter((workspace) => workspace.id !== workspaceId);
			this.dispatchEvent(new CustomEvent("baize-workspace-deleted", { detail: { id: workspaceId }, bubbles: true, composed: true }));
			// 成功才收起确认;失败(409 busy / 500)保留弹层,行内错误可见(决议 10)。
			this.confirmId = null;
		} catch (err) {
			this.deleteError = deleteWorkspaceErrorCopy(err);
		} finally {
			this.deletingId = null;
		}
	}

	render() {
		return html`
			<div class="page-head">
				<div>
					<h1>工作空间</h1>
					<p class="sub">每个工作空间对应一个仓库,组织其下的需求与资产。</p>
				</div>
				<span class="spacer"></span>
				<button class="primary" @click=${() => (this.createOpen = !this.createOpen)}>${this.createOpen ? "收起" : "＋ 新建工作空间"}</button>
			</div>

			${this.createOpen
				? html`<form class="card form-card" @submit=${(e: Event) => void this.handleCreate(e)}>
						<h3>创建新工作空间</h3>
						<input type="text" placeholder="名称" .value=${this.name} @input=${(e: Event) => (this.name = (e.target as HTMLInputElement).value)} required />
						<input type="text" placeholder="仓库路径,如 /path/to/repo" .value=${this.repoPath} @input=${(e: Event) => (this.repoPath = (e.target as HTMLInputElement).value)} required />
						<div class="command-row"><button class="primary" type="submit" ?disabled=${this.creating}>${this.creating ? "创建中…" : "创建并进入"}</button></div>
						${this.createError ? html`<div class="error">${this.createError}</div>` : nothing}
					</form>`
				: nothing}

			${this.loading
				? html`<div class="empty">加载中…</div>`
				: this.loadError
					? html`<div class="card"><div class="error">${this.loadError}</div></div>`
					: this.workspaces.length === 0
						? html`<div class="card" style="margin-top:var(--gap)">
								<div class="empty">还没有工作空间,点击「新建工作空间」创建第一个来组织需求与资产。</div>
							</div>`
						: html`<div class="list">
								${this.workspaces.map((workspace) => html`
									<div class="card item ${workspace.id === this.workspaceId ? "current" : ""}"
										role="link" tabindex="0" aria-label="进入工作区 ${workspace.name}"
										@click=${() => this.enter(workspace.id)}
										@keydown=${(e: KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); this.enter(workspace.id); } }}>
										<div class="row">
											<div class="grow">
												<div class="title">${workspace.name}</div>
												<div class="meta mono">${workspace.repoPath}</div>
											</div>
										<div class="actions" @click=${(e: Event) => e.stopPropagation()}>
											<button class="danger" ?disabled=${this.deletingId !== null} @click=${() => this.askDelete(workspace.id)}>删除</button>
										</div>
									</div>
										${this.confirmId === workspace.id
											? html`<div class="confirm" role="dialog" aria-label="确认删除工作区 ${workspace.name}" @click=${(e: Event) => e.stopPropagation()}>
													<span class="text">删除工作区「${workspace.name}」?将级联删除其下所有需求与资产（含设计历史、审批记录），<strong>不可恢复</strong>。</span>
													<div class="actions">
														<button class="danger" ?disabled=${this.deletingId !== null} @click=${() => void this.confirmDelete(workspace.id)}>${this.deletingId === workspace.id ? "删除中…" : "确认删除"}</button>
														<button ?disabled=${this.deletingId !== null} @click=${() => this.cancelDelete()}>取消</button>
													</div>
													${this.deleteError ? html`<div class="error">${this.deleteError}</div>` : nothing}
												</div>`
											: nothing}
									</div>`)}
							</div>`}
		`;
	}
}

customElements.define("baize-workspace-manager", BaizeWorkspaceManager);