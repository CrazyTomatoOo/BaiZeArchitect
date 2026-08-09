import { LitElement, html, css } from "lit";

/**
 * baize-chat-intake — 需求录入 chat 化(T05/T06 F2):全屏 overlay,
 * 左侧对话(agent 反问澄清)+ 右侧结构化预览(title/description)→ 确认创建。
 * POST /api/chat/intake(每轮带全 history,无状态)→ 解析 JSON {title,description} 填预览;
 * 确认 → POST /api/requirements → 关闭 + goto 需求页。监听 baize-new-requirement 开合。
 */
interface Msg {
	role: "user" | "assistant";
	content: string;
}
interface Preview {
	title: string;
	description: string;
}

class BaizeChatIntake extends LitElement {
	static properties = {
		open: { type: Boolean, reflect: true },
		messages: { state: true },
		input: { state: true },
		preview: { state: true },
		busy: { state: true },
		ws: { state: true },
		error: { state: true },
	};

	declare open: boolean;
	declare messages: Msg[];
	declare input: string;
	declare preview: Preview | null;
	declare busy: string;
	declare ws: number;
	declare error: string;

	static styles = css`
		:host {
			position: fixed;
			inset: 0;
			z-index: 110;
			display: none;
		}
		:host([open]) {
			display: block;
		}
		.overlay {
			position: absolute;
			inset: 0;
			background: var(--scrim-strong);
			display: flex;
			align-items: center;
			justify-content: center;
		}
		.panel {
			width: min(900px, 92vw);
			height: min(80vh, 720px);
			background: var(--bg);
			border: 1px solid var(--border-strong);
			border-radius: var(--radius);
			box-shadow: 0 16px 48px var(--shadow-2);
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}
		.head {
			display: flex;
			align-items: center;
			padding: var(--pad);
			border-bottom: 1px solid var(--border);
		}
		.head h2 {
			margin: 0;
			font-size: 1rem;
		}
		.head button {
			margin-left: auto;
			background: transparent;
			border: none;
			color: var(--text-muted);
			font-size: 1.1rem;
			cursor: pointer;
		}
		.body {
			display: grid;
			grid-template-columns: 1fr 320px;
			flex: 1;
			min-height: 0;
		}
		.chat {
			display: flex;
			flex-direction: column;
			border-right: 1px solid var(--border);
			min-height: 0;
		}
		.msgs {
			flex: 1;
			overflow: auto;
			padding: var(--pad);
			display: flex;
			flex-direction: column;
			gap: 8px;
		}
		.msg {
			max-width: 80%;
			padding: 8px 12px;
			border-radius: var(--radius);
			font-size: 0.85rem;
			white-space: pre-wrap;
			word-break: break-word;
		}
		.msg.user {
			background: var(--accent);
			color: var(--accent-fg);
			align-self: flex-end;
		}
		.msg.assistant {
			background: var(--surface-2);
			color: var(--text);
			align-self: flex-start;
		}
		.err {
			color: var(--danger);
			font-size: 0.8rem;
			padding: 0 var(--pad) 6px;
		}
		.input {
			display: flex;
			gap: 8px;
			padding: var(--pad);
			border-top: 1px solid var(--border);
		}
		textarea {
			flex: 1;
			resize: none;
			height: 60px;
			background: var(--surface);
			border: 1px solid var(--border);
			color: var(--text);
			border-radius: var(--radius-sm);
			padding: 8px;
			font: inherit;
			font-size: 0.85rem;
		}
		.input button {
			padding: 0 16px;
			border-radius: var(--radius-sm);
			border: 1px solid var(--border-strong);
			background: var(--surface-2);
			color: var(--text);
			cursor: pointer;
			font: inherit;
		}
		.preview {
			padding: var(--pad);
			overflow: auto;
		}
		.preview h3 {
			margin: 0 0 10px;
			font-size: 0.9rem;
			color: var(--text-muted);
		}
		.preview .k {
			color: var(--text-subtle);
			font-size: 0.72rem;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			margin-top: 10px;
		}
		.preview p {
			margin: 4px 0;
			color: var(--text);
			font-size: 0.85rem;
			white-space: pre-wrap;
		}
		.preview .confirm {
			margin-top: 16px;
			width: 100%;
			padding: 8px;
			border-radius: var(--radius-sm);
			border: none;
			background: var(--accent);
			color: var(--accent-fg);
			font-weight: 600;
			cursor: pointer;
			font: inherit;
		}
		.preview .confirm:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
		.empty {
			color: var(--text-subtle);
			font-size: 0.85rem;
		}
	`;

	constructor() {
		super();
		this.open = false;
		this.messages = [];
		this.input = "";
		this.preview = null;
		this.busy = "";
		this.ws = Number(localStorage.getItem("baize.ui.v1.workspace") ?? "0");
		this.error = "";
	}

	connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener("baize-new-requirement", (() => {
			this.open = true;
		}) as EventListener);
		window.addEventListener("baize-workspace-change", this.onWs as EventListener);
	}

	private onWs = (e: CustomEvent<{ id: number }>) => {
		this.ws = e.detail.id;
	};

	private async send() {
		const t = this.input.trim();
		if (!t || this.busy) return;
		this.input = "";
		this.error = "";
		const history: Msg[] = [...this.messages, { role: "user", content: t }];
		this.messages = history;
		this.busy = "send";
		try {
			const r = await fetch("/api/chat/intake", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					messages: history.map((m) => ({ role: m.role, content: m.content })),
				}),
			});
			const data = (await r.json()) as { reply?: string; error?: string };
			if (!r.ok) {
				this.error = data.error || "请求失败";
				this.busy = "";
				return;
			}
			const reply = String(data.reply ?? "");
			this.messages = [...history, { role: "assistant", content: reply }];
			const parsed = this.tryParse(reply);
			if (parsed) this.preview = parsed;
		} catch (e) {
			this.error = String(e);
		}
		this.busy = "";
	}

	private tryParse(s: string): Preview | null {
		const candidates: string[] = [];
		const m = s.match(/```json\s*([\s\S]*?)```/i);
		if (m) candidates.push(m[1]);
		const m2 = s.match(/\{[\s\S]*\}/);
		if (m2) candidates.push(m2[0]);
		for (const c of candidates) {
			try {
				const j = JSON.parse(c) as { title?: unknown; description?: unknown };
				if (j && typeof j === "object" && j.title && j.description) {
					return { title: String(j.title), description: String(j.description) };
				}
			} catch {
				/* keep trying */
			}
		}
		return null;
	}

	private async confirm() {
		if (!this.preview || !this.ws) return;
		this.busy = "save";
		try {
			const r = await fetch("/api/requirements", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					workspaceId: this.ws,
					title: this.preview.title,
					description: this.preview.description,
				}),
			});
			if (!r.ok) {
				const d = (await r.json().catch(() => ({}))) as { error?: string };
				this.error = d.error || "创建失败";
				this.busy = "";
				return;
			}
			const created = (await r.json().catch(() => ({}))) as { id?: number };
			this.reset();
			this.dispatchEvent(
				new CustomEvent("baize-requirements-changed", {
					detail: { id: created.id },
					bubbles: true,
					composed: true,
				}),
			);
			this.dispatchEvent(
				new CustomEvent("baize-goto", {
					detail: { tab: "requirement" },
					bubbles: true,
					composed: true,
				}),
			);
		} catch (e) {
			this.error = String(e);
		}
		this.busy = "";
	}

	private reset() {
		this.open = false;
		this.messages = [];
		this.input = "";
		this.preview = null;
		this.error = "";
	}

	render() {
		if (!this.open) return null;
		return html`<div class="overlay">
			<div class="panel">
				<div class="head">
					<h2>新建需求(chat 澄清)</h2>
					<button @click=${() => this.reset()}>✕</button>
				</div>
				<div class="body">
					<div class="chat">
						<div class="msgs">
							${this.messages.map(
								(m) => html`<div class="msg ${m.role}">${m.content}</div>`,
							)}
							${
								this.messages.length === 0
									? html`<div class="empty">描述你要设计的需求,agent 会反问澄清…</div>`
									: null
							}
						</div>
						${this.error ? html`<div class="err">${this.error}</div>` : null}
						<div class="input">
							<textarea
								.value=${this.input}
								@input=${(e: Event) =>
									(this.input = (e.target as HTMLTextAreaElement).value)}
								@keydown=${(e: KeyboardEvent) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										this.send();
									}
								}}
								placeholder="描述你的需求…(Enter 发送,Shift+Enter 换行)"
							></textarea>
							<button ?disabled=${!!this.busy} @click=${() => this.send()}>
								${this.busy === "send" ? "…" : "发送"}
							</button>
						</div>
					</div>
					<div class="preview">
						<h3>结构化预览</h3>
						${
							this.preview
								? html`<div class="pv">
									<div class="k">标题</div>
									<p>${this.preview.title}</p>
									<div class="k">描述</div>
									<p>${this.preview.description}</p>
									<button
										class="confirm"
										?disabled=${!this.ws || !!this.busy}
										@click=${() => this.confirm()}
									>
										${
											this.busy === "save"
												? "保存中…"
												: this.ws
													? "确认创建"
													: "先选工作区"
										}
									</button>
								</div>`
								: html`<div class="empty">
									agent 收敛需求后会在此生成预览…
								</div>`
						}
					</div>
				</div>
			</div>
		</div>`;
	}
}

customElements.define("baize-chat-intake", BaizeChatIntake);
