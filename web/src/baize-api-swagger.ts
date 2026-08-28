import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { sharedStyles } from "./baize-styles.js";
import { updateAsset, AssetMutationError, type AssetValidationError } from "./workflow-client.js";

type HttpMethod = "get" | "post" | "put" | "delete" | "patch" | "head" | "options" | "trace";
type OperationObject = Record<string, unknown>;
type PathsObject = Record<string, Record<string, OperationObject>>;

const HTTP_METHODS: HttpMethod[] = ["get", "post", "put", "delete", "patch", "head", "options", "trace"];
const METHOD_ORDER: Record<string, number> = {
	get: 1,
	post: 2,
	put: 3,
	patch: 4,
	delete: 5,
	head: 6,
	options: 7,
	trace: 8,
};
const METHOD_COLORS: Record<HttpMethod, string> = {
	get: "var(--ok)",
	post: "var(--accent)",
	put: "var(--warn)",
	patch: "var(--warn)",
	delete: "var(--danger)",
	head: "var(--text-muted)",
	options: "var(--text-muted)",
	trace: "var(--text-muted)",
};

function isHttpMethod(v: string): v is HttpMethod {
	return v in METHOD_ORDER;
}

function clone<T>(v: T): T {
	try {
		return structuredClone(v);
	} catch {
		return JSON.parse(JSON.stringify(v));
	}
}

function pointerEscape(s: string): string {
	return s.replace(/~/g, "~0").replace(/\//g, "~1");
}

function pointerPath(base: string, ...segments: string[]): string {
	return `${base}/${segments.map(pointerEscape).join("/")}`;
}

function asRecord(v: unknown): Record<string, unknown> {
	return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asArray<T = unknown>(v: unknown): T[] {
	return Array.isArray(v) ? (v as T[]) : [];
}

function asString(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function asBoolean(v: unknown): boolean {
	return typeof v === "boolean" ? v : false;
}

function firstTag(op: OperationObject): string | undefined {
	const tags = asArray<string>(op.tags);
	return tags[0];
}

function groupPrefix(path: string): string {
	const trimmed = path.replace(/^\//, "");
	const seg = trimmed.split("/")[0] ?? "";
	return seg ? `/${seg}` : "/";
}

interface OperationItem {
	path: string;
	method: HttpMethod;
	operation: OperationObject;
	tags: string[];
}

export class BaizeApiSwagger extends LitElement {
	static properties = {apiBase:{type:String},assetId:{type:Number},expectedRevisionId:{type:Number},content:{type:Object},title:{type:String},draft:{state:true},fieldErrors:{state:true},methodFilter:{state:true},selectedPath:{state:true},selectedMethod:{state:true},newMethod:{state:true},schemaJson:{state:true},schemeJson:{state:true},responseJson:{state:true}};
	apiBase!: string;
	assetId!: number;
	expectedRevisionId!: number;
	content: unknown = {};
	title!: string;

	draft: Record<string, unknown> = {};
	modified = false;
	fieldErrors: Record<string, string> = {};
	conflict = false;
	saving = false;

	private methodFilter: "all" | HttpMethod = "all";
	private pathFilter = "";
	private keywordFilter = "";
	private selectedPath: string | null = null;
	private selectedMethod: HttpMethod | null = null;

	private newPath = "";
	private newMethod: HttpMethod = "get";

	private schemaJson: Record<string, string> = {};
	private schemeJson: Record<string, string> = {};
	private responseJson: Record<string, string> = {};

	private saveErrorListener = this.onSaveError.bind(this);
	private keydownListener = this.onKeyDown.bind(this);

	override connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener("baize-asset-save-error", this.saveErrorListener);
		window.addEventListener("keydown", this.keydownListener);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		window.removeEventListener("baize-asset-save-error", this.saveErrorListener);
		window.removeEventListener("keydown", this.keydownListener);
	}

	override willUpdate(changed: Map<string, unknown>): void {
		if (changed.has("content")) {
			this.draft = clone(asRecord(this.content));
			this.modified = false;
			this.conflict = false;
			this.fieldErrors = {};
			this.saving = false;
			this.schemaJson = {};
			this.schemeJson = {};
			this.responseJson = {};
			if (!this.selectedOperationItem) {
				const first = this.filteredOperations[0];
				if (first) {
					this.selectedPath = first.path;
					this.selectedMethod = first.method;
				}
			}
		}
	}

	private get pathsRecord(): PathsObject {
		return asRecord(this.draft.paths) as PathsObject;
	}

	private get allOperations(): OperationItem[] {
		const paths = this.pathsRecord;
		const list: OperationItem[] = [];
		for (const [path, methods] of Object.entries(paths)) {
			for (const [method, op] of Object.entries(methods)) {
				if (isHttpMethod(method)) {
					list.push({ path, method, operation: op, tags: asArray<string>(op.tags) });
				}
			}
		}
		list.sort((a, b) => a.path.localeCompare(b.path) || METHOD_ORDER[a.method] - METHOD_ORDER[b.method]);
		return list;
	}

	private get filteredOperations(): OperationItem[] {
		const pathQuery = this.pathFilter.toLowerCase();
		const keyword = this.keywordFilter.toLowerCase();
		return this.allOperations.filter((item) => {
			if (this.methodFilter !== "all" && item.method !== this.methodFilter) return false;
			if (pathQuery && !item.path.toLowerCase().includes(pathQuery)) return false;
			if (keyword) {
				const hay = [
					item.path,
					item.method,
					asString(item.operation.summary),
					asString(item.operation.operationId),
					...item.tags,
				].join("\n");
				if (!hay.toLowerCase().includes(keyword)) return false;
			}
			return true;
		});
	}

	private get groupedOperations(): Map<string, OperationItem[]> {
		const map = new Map<string, OperationItem[]>();
		for (const item of this.filteredOperations) {
			const key = firstTag(item.operation) ?? groupPrefix(item.path);
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(item);
		}
		return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
	}

	private get selectedOperationItem(): OperationItem | null {
		if (!this.selectedPath || !this.selectedMethod) return null;
		return (
			this.allOperations.find((o) => o.path === this.selectedPath && o.method === this.selectedMethod) ?? null
		);
	}

	private ensureSelection(): void {
		if (!this.selectedOperationItem) {
			const first = this.filteredOperations[0];
			if (first) {
				this.selectedPath = first.path;
				this.selectedMethod = first.method;
			} else {
				this.selectedPath = null;
				this.selectedMethod = null;
			}
		}
	}

	private setDraft(patch: Record<string, unknown>): void {
		this.draft = { ...this.draft, ...patch };
		this.modified = true;
		this.fieldErrors = {};
		this.conflict = false;
	}

	private updatePaths(next: PathsObject): void {
		this.setDraft({ paths: next });
	}

	private updateOperation(path: string, method: HttpMethod, patch: Record<string, unknown>): void {
		const paths = clone(this.pathsRecord);
		paths[path] = { ...paths[path], [method]: { ...(paths[path]?.[method] ?? {}), ...patch } };
		this.updatePaths(paths);
	}

	private deleteOperation(path: string, method: HttpMethod): void {
		const paths = clone(this.pathsRecord);
		if (paths[path]) {
			const { [method]: _removed, ...rest } = paths[path];
			const hasOps = Object.keys(rest).some((m) => isHttpMethod(m));
			if (hasOps) {
				paths[path] = rest;
			} else {
				delete paths[path];
			}
		}
		this.updatePaths(paths);
		if (this.selectedPath === path && this.selectedMethod === method) {
			this.ensureSelection();
		}
	}

	private renamePath(oldPath: string, newPath: string): void {
		newPath = newPath.trim();
		if (!newPath || oldPath === newPath) return;
		const paths = clone(this.pathsRecord);
		if (paths[newPath]) return;
		paths[newPath] = paths[oldPath];
		delete paths[oldPath];
		this.updatePaths(paths);
		if (this.selectedPath === oldPath) this.selectedPath = newPath;
	}

	private addOperation(): void {
		const path = this.newPath.trim();
		const method = this.newMethod;
		if (!path || !isHttpMethod(method)) return;
		const paths = clone(this.pathsRecord);
		if (!paths[path]) paths[path] = {};
		if (paths[path][method]) return;
		paths[path][method] = { summary: "", responses: { "200": { description: "OK" } } };
		this.updatePaths(paths);
		this.selectedPath = path;
		this.selectedMethod = method;
		this.newPath = "";
	}

	private addPathOperation(path: string): void {
		const method = (HTTP_METHODS.find((m) => !this.pathsRecord[path]?.[m]) ?? "get") as HttpMethod;
		const paths = clone(this.pathsRecord);
		paths[path] = { ...paths[path], [method]: { summary: "", responses: { "200": { description: "OK" } } } };
		this.updatePaths(paths);
		this.selectedPath = path;
		this.selectedMethod = method;
	}

	private dispatchSave(): void {
		if (!this.modified || this.saving) return;
		this.saving = true;
		this.dispatchEvent(
			new CustomEvent("save", {
				detail: { content: this.draft, title: this.title },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onKeyDown(e: KeyboardEvent): void {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
			e.preventDefault();
			this.dispatchSave();
		}
	}

	private onSaveError(e: Event): void {
		const detail = (e as CustomEvent).detail as
			| { errors?: AssetValidationError[]; message?: string }
			| undefined;
		if (!detail) return;
		this.saving = false;
		if (Array.isArray(detail.errors) && detail.errors.length > 0) {
			const next: Record<string, string> = {};
			for (const err of detail.errors) {
				next[err.path] = err.message;
			}
			this.fieldErrors = next;
			this.conflict = false;
		} else if (detail.message) {
			this.conflict = true;
			this.fieldErrors = {};
			this.draft = clone(asRecord(this.content));
			this.modified = false;
		}
	}

	private reloadFromContent(): void {
		this.draft = clone(asRecord(this.content));
		this.modified = false;
		this.conflict = false;
		this.fieldErrors = {};
	}

	private errorFor(path: string): string | undefined {
		return this.fieldErrors[path];
	}

	private renderError(path: string) {
		const msg = this.errorFor(path);
		return msg ? html`<div class="field-error">${msg}</div>` : nothing;
	}

	override render() {
		this.ensureSelection();
		const selected = this.selectedOperationItem;
		return html`
			<div class="swagger">
				<div class="save-bar">
					${this.conflict
						? html`<span class="conflict-hint">版本冲突：当前编辑已被其他会话覆盖</span>
								<button class="primary" @click=${this.reloadFromContent}>重新加载</button>`
						: nothing}
					<button class="primary" ?disabled=${!this.modified || this.saving} @click=${this.dispatchSave}>
						${this.saving ? "保存中…" : "保存"}
					</button>
				</div>

				${this.renderTopErrors()}

				<div class="double-bar">
					${this.renderLeftPanel()} ${this.renderRightPanel(selected)}
				</div>

				<div class="lower">
					${this.renderConfig()} ${this.renderComponents()}
				</div>
			</div>
		`;
	}

	private renderTopErrors() {
		if (this.conflict) return nothing;
		const entries = Object.entries(this.fieldErrors);
		if (entries.length === 0) return nothing;
		return html`<div class="top-errors">
			<div class="top-errors-title">保存校验未通过</div>
			<ul>
				${entries.map(([path, msg]) => html`<li><code>${path}</code> — ${msg}</li>`)}
			</ul>
		</div>`;
	}

	private renderLeftPanel() {
		const groups = this.groupedOperations;
		return html`
			<aside class="left">
				<div class="left-header">
					<div class="filter-row">
						${["all", ...HTTP_METHODS].map((m) => {
							const active = this.methodFilter === m;
							return html`<button
								class="method-chip ${active ? "active" : ""} ${m !== "all" ? m : ""}"
								?disabled=${m !== "all" && !this.allOperations.some((o) => o.method === (m as HttpMethod))}
								@click=${() => (this.methodFilter = m as "all" | HttpMethod)}
							>
								${m === "all" ? "全部" : m.toUpperCase()}
							</button>`;
						})}
					</div>
					<input
						class="filter-input"
						placeholder="过滤路径…"
						.value=${this.pathFilter}
						@input=${(e: InputEvent) => (this.pathFilter = (e.target as HTMLInputElement).value)}
					/>
					<input
						class="filter-input"
						placeholder="关键词（summary / operationId / tag）…"
						.value=${this.keywordFilter}
						@input=${(e: InputEvent) => (this.keywordFilter = (e.target as HTMLInputElement).value)}
					/>
					<div class="add-op">
						<input
							placeholder="新路径，如 /pets"
							.value=${this.newPath}
							@input=${(e: InputEvent) => (this.newPath = (e.target as HTMLInputElement).value)}
							@keydown=${(e: KeyboardEvent) => e.key === "Enter" && this.addOperation()}
						/>
						<select
							.value=${this.newMethod}
							@change=${(e: InputEvent) => (this.newMethod = (e.target as HTMLSelectElement).value as HttpMethod)}
						>
							${HTTP_METHODS.map((m) => html`<option value=${m}>${m.toUpperCase()}</option>`)}
						</select>
						<button class="secondary" @click=${this.addOperation}>添加</button>
					</div>
				</div>
				<div class="scroll">
					${groups.size === 0
						? html`<div class="empty">没有匹配的操作</div>`
						: [...groups.entries()].map(([group, items]) => this.renderGroup(group, items))}
				</div>
			</aside>
		`;
	}

	private renderGroup(group: string, items: OperationItem[]) {
		return html`
			<section class="group">
				<header class="group-header">
					<span class="group-name">${group}</span>
					<button class="icon-btn" title="在此前缀下添加操作" @click=${() => this.addOperationToGroup(group)}>＋</button>
				</header>
				<ul class="op-list">
					${items.map((item) => this.renderOperationItem(item))}
				</ul>
			</section>
		`;
	}

	private addOperationToGroup(group: string): void {
		const prefix = group.startsWith("/") ? group : "";
		const path = prefix ? `${prefix}/new` : "/new";
		this.newPath = path;
		this.addOperation();
	}

	private renderOperationItem(item: OperationItem) {
		const active = this.selectedPath === item.path && this.selectedMethod === item.method;
		return html`
			<li class="op-item ${active ? "active" : ""}" @click=${() => {
				this.selectedPath = item.path;
				this.selectedMethod = item.method;
			}}>
				<span class="method ${item.method}">${item.method.toUpperCase()}</span>
				<span class="path mono">${item.path}</span>
				<span class="summary">${asString(item.operation.summary) || "（未命名）"}</span>
				<button
					class="icon-btn delete"
					title="删除操作"
					@click=${(e: Event) => {
						e.stopPropagation();
						this.deleteOperation(item.path, item.method);
					}}
				>
					×
				</button>
			</li>
		`;
	}

	private renderRightPanel(selected: OperationItem | null) {
		if (!selected) {
			return html`<section class="right empty">选择左侧操作以查看和编辑详情</section>`;
		}
		const op = selected.operation;
		const opPath = "/paths";
		const pathPtr = pointerPath(opPath, pointerEscape(selected.path));
		const opPtr = pointerPath(pathPtr, selected.method);
		return html`
			<section class="right">
				<div class="right-scroll">
					<div class="op-header">
						<div class="op-title-row">
							<span class="method ${selected.method}">${selected.method.toUpperCase()}</span>
							<input
								class="path-input mono"
								.value=${selected.path}
								@change=${(e: InputEvent) => this.renamePath(selected.path, (e.target as HTMLInputElement).value)}
							/>
						</div>
						${this.renderError(pathPtr)}
						<div class="op-field">
							<label>summary</label>
							<input
								.value=${asString(op.summary)}
								@input=${(e: InputEvent) =>
									this.updateOperation(selected.path, selected.method, { summary: (e.target as HTMLInputElement).value })}
							/>
							${this.renderError(pointerPath(opPtr, "summary"))}
						</div>
						<div class="op-field">
							<label>operationId</label>
							<input
								.value=${asString(op.operationId)}
								@input=${(e: InputEvent) =>
									this.updateOperation(selected.path, selected.method, { operationId: (e.target as HTMLInputElement).value })}
							/>
							${this.renderError(pointerPath(opPtr, "operationId"))}
						</div>
						<div class="op-field">
							<label>description</label>
							<textarea
								.rows=${3}
								.value=${asString(op.description)}
								@input=${(e: InputEvent) =>
									this.updateOperation(selected.path, selected.method, { description: (e.target as HTMLTextAreaElement).value })}
							></textarea>
							${this.renderError(pointerPath(opPtr, "description"))}
						</div>
						<div class="op-field">
							<label>tags</label>
							<input
								.value=${asArray<string>(op.tags).join(", ")}
								@change=${(e: InputEvent) =>
									this.updateOperation(selected.path, selected.method, {
										tags: (e.target as HTMLInputElement).value
											.split(",")
											.map((t) => t.trim())
											.filter(Boolean),
									})}
							/>
							${this.renderError(pointerPath(opPtr, "tags"))}
						</div>
					</div>

					${this.renderParameters(selected)} ${this.renderRequestBody(selected)}
					${this.renderResponses(selected)} ${this.renderOperationSecurity(selected)}
				</div>
			</section>
		`;
	}

	private renderParameters(selected: OperationItem) {
		const op = selected.operation;
		const params = asArray<Record<string, unknown>>(op.parameters);
		const opPtr = pointerPath("/paths", pointerEscape(selected.path), selected.method);
		return html`
			<div class="section card">
				<h4>Parameters</h4>
				${params.length === 0
					? html`<div class="empty-row">暂无参数</div>`
					: html`<table>
							<thead>
								<tr>
									<th>name</th>
									<th>in</th>
									<th>required</th>
									<th>schema type</th>
									<th>description</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								${params.map((param, idx) => {
									const paramPtr = pointerPath(opPtr, "parameters", String(idx));
									const schema = asRecord(param.schema);
									const type = asString(schema.type);
									const updateParam = (patch: Record<string, unknown>) => {
										const next = params.map((p, i) => (i === idx ? { ...p, ...patch } : p));
										this.updateOperation(selected.path, selected.method, { parameters: next });
									};
									return html`<tr>
										<td>
											<input
												.value=${asString(param.name)}
												@input=${(e: InputEvent) => updateParam({ name: (e.target as HTMLInputElement).value })}
											/>
											${this.renderError(pointerPath(paramPtr, "name"))}
										</td>
										<td>
											<select
												.value=${asString(param.in) || "query"}
												@change=${(e: InputEvent) => updateParam({ in: (e.target as HTMLSelectElement).value })}
											>
												${["query", "path", "header", "cookie"].map(
													(v) => html`<option value=${v}>${v}</option>`,
												)}
											</select>
											${this.renderError(pointerPath(paramPtr, "in"))}
										</td>
										<td>
											<input
												type="checkbox"
												?checked=${asBoolean(param.required)}
												@change=${(e: InputEvent) =>
													updateParam({ required: (e.target as HTMLInputElement).checked })}
											/>
										</td>
										<td>
											<select
												.value=${type || "string"}
												@change=${(e: InputEvent) =>
													updateParam({ schema: { ...schema, type: (e.target as HTMLSelectElement).value } })}
											>
												${["string", "integer", "number", "boolean", "array", "object"].map(
													(v) => html`<option value=${v}>${v}</option>`,
												)}
											</select>
										</td>
										<td>
											<input
												.value=${asString(param.description)}
												@input=${(e: InputEvent) => updateParam({ description: (e.target as HTMLInputElement).value })}
											/>
										</td>
										<td>
											<button
												class="icon-btn delete"
												@click=${() => {
													const next = params.filter((_, i) => i !== idx);
													this.updateOperation(selected.path, selected.method, { parameters: next });
												}}
											>
												×
											</button>
										</td>
									</tr>`;
								})}
							</tbody>
						</table>`}
				<button
					class="secondary small"
					@click=${() =>
						this.updateOperation(selected.path, selected.method, {
							parameters: [...params, { name: "", in: "query", required: false, schema: { type: "string" }, description: "" }],
						})}
				>
					＋ 添加参数
				</button>
				${this.renderError(pointerPath(opPtr, "parameters"))}
			</div>
		`;
	}

	private renderRequestBody(selected: OperationItem) {
		const op = selected.operation;
		const requestBody = asRecord(op.requestBody);
		const content = asRecord(requestBody.content);
		const opPtr = pointerPath("/paths", pointerEscape(selected.path), selected.method, "requestBody");
		return html`
			<div class="section card">
				<h4>Request Body</h4>
				<div class="op-field">
					<label>description</label>
					<textarea
						.rows=${2}
						.value=${asString(requestBody.description)}
						@input=${(e: InputEvent) => {
							const next = { ...requestBody, description: (e.target as HTMLTextAreaElement).value };
							this.updateOperation(selected.path, selected.method, { requestBody: next });
						}}
					></textarea>
				</div>
				${Object.entries(content).length === 0
					? html`<div class="empty-row">暂无 content</div>`
					: html`<table>
							<thead>
								<tr>
									<th>mediaType</th>
									<th>schema type</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								${Object.entries(content).map(([mediaType, media]) => {
									const schema = asRecord((media as Record<string, unknown>)?.schema);
									const updateContent = (patch: Record<string, unknown>) => {
										const nextContent = { ...content, [mediaType]: { ...(media as Record<string, unknown>), ...patch } };
										this.updateOperation(selected.path, selected.method, { requestBody: { ...requestBody, content: nextContent } });
									};
									return html`<tr>
										<td>
											<input
												.value=${mediaType}
												@change=${(e: InputEvent) => {
													const newType = (e.target as HTMLInputElement).value;
													if (newType && newType !== mediaType) {
														const { [mediaType]: val, ...rest } = content;
														this.updateOperation(selected.path, selected.method, {
															requestBody: { ...requestBody, content: { ...rest, [newType]: val } },
														});
													}
												}}
											/>
										</td>
										<td>
											<select
												.value=${asString(schema.type) || "object"}
												@change=${(e: InputEvent) =>
													updateContent({ schema: { ...schema, type: (e.target as HTMLSelectElement).value } })}
											>
												${["object", "string", "array"].map((v) => html`<option value=${v}>${v}</option>`)}
											</select>
										</td>
										<td>
											<button
												class="icon-btn delete"
												@click=${() => {
													const { [mediaType]: _, ...rest } = content;
													this.updateOperation(selected.path, selected.method, {
														requestBody: { ...requestBody, content: rest },
													});
												}}
											>
												×
											</button>
										</td>
									</tr>`;
								})}
							</tbody>
						</table>`}
				<button
					class="secondary small"
					@click=${() =>
						this.updateOperation(selected.path, selected.method, {
							requestBody: {
								...requestBody,
								content: { ...content, "application/json": { schema: { type: "object" } } },
							},
						})}
				>
					＋ 添加 Content
				</button>
				${this.renderError(opPtr)}
			</div>
		`;
	}

	private renderResponses(selected: OperationItem) {
		const op = selected.operation;
		const responses = asRecord(op.responses);
		const opPtr = pointerPath("/paths", pointerEscape(selected.path), selected.method, "responses");
		return html`
			<div class="section card">
				<h4>Responses</h4>
				${Object.entries(responses).length === 0
					? html`<div class="empty-row">暂无响应</div>`
					: Object.entries(responses).map(([code, response]) => {
							const resp = asRecord(response);
							const respPtr = pointerPath(opPtr, code);
							const content = asRecord(resp.content);
							return html`
								<div class="response-row">
									<div class="op-field inline">
										<label>status</label>
										<input
											class="status-input"
											.value=${code}
											@change=${(e: InputEvent) => {
												const newCode = (e.target as HTMLInputElement).value;
												if (newCode && newCode !== code) {
													const { [code]: val, ...rest } = responses;
													this.updateOperation(selected.path, selected.method, { responses: { ...rest, [newCode]: val } });
												}
											}}
										/>
										<button
											class="icon-btn delete"
											@click=${() => {
												const { [code]: _, ...rest } = responses;
												this.updateOperation(selected.path, selected.method, { responses: rest });
											}}
										>
											×
										</button>
									</div>
									${this.renderError(respPtr)}
									<div class="op-field">
										<label>description</label>
										<textarea
											.rows=${2}
											.value=${asString(resp.description)}
											@input=${(e: InputEvent) => {
												const next = { ...responses, [code]: { ...resp, description: (e.target as HTMLTextAreaElement).value } };
												this.updateOperation(selected.path, selected.method, { responses: next });
											}}
										></textarea>
										${this.renderError(pointerPath(respPtr, "description"))}
									</div>
									${Object.entries(content).length === 0
										? html`<div class="empty-row">无 content</div>`
										: html`<table>
												<thead>
													<tr>
														<th>mediaType</th>
														<th>schema JSON</th>
														<th></th>
													</tr>
												</thead>
												<tbody>
													${Object.entries(content).map(([mediaType, media]) => {
														const schema = asRecord((media as Record<string, unknown>)?.schema);
														const key = `${selected.path}::${selected.method}::${code}::${mediaType}`;
														const json = this.responseJson[key] ?? JSON.stringify(schema, null, 2);
														return html`<tr>
															<td>
																<input
																	.value=${mediaType}
																	@change=${(e: InputEvent) => {
																		const newType = (e.target as HTMLInputElement).value;
																		if (newType && newType !== mediaType) {
																			const { [mediaType]: val, ...rest } = content;
																			this.updateOperation(selected.path, selected.method, {
																				responses: {
																					...responses,
																					[code]: { ...resp, content: { ...rest, [newType]: val } },
																				},
																			});
																		}
																	}}
																/>
															</td>
															<td>
																<textarea
																	class="schema-json"
																	.rows=${3}
																	.value=${json}
																	@input=${(e: InputEvent) => {
																		const val = (e.target as HTMLTextAreaElement).value;
																		this.responseJson = { ...this.responseJson, [key]: val };
																		try {
																			const parsed = JSON.parse(val);
																			this.updateOperation(selected.path, selected.method, {
																				responses: {
																					...responses,
																					[code]: { ...resp, content: { ...content, [mediaType]: { schema: parsed } } },
																				},
																			});
																		} catch {
																			/* keep string until valid */
																		}
																	}}
																></textarea>
															</td>
															<td>
																<button
																	class="icon-btn delete"
																	@click=${() => {
																		const { [mediaType]: _, ...rest } = content;
																		this.updateOperation(selected.path, selected.method, {
																			responses: { ...responses, [code]: { ...resp, content: rest } },
																		});
																	}}
																>
																	×
																</button>
															</td>
														</tr>`;
													})}
												</tbody>
											</table>`}
									<button
										class="secondary small"
										@click=${() =>
											this.updateOperation(selected.path, selected.method, {
												responses: {
													...responses,
													[code]: { ...resp, content: { ...content, "application/json": { schema: { type: "object" } } } },
												},
											})}
									>
										＋ 添加 Content
									</button>
								</div>
							`;
					  })}
				<div class="add-row">
					<input
						class="status-input"
						placeholder="状态码"
						@change=${(e: InputEvent) => {
							const code = (e.target as HTMLInputElement).value;
							if (!code || responses[code]) return;
							this.updateOperation(selected.path, selected.method, {
								responses: { ...responses, [code]: { description: "" } },
							});
							(e.target as HTMLInputElement).value = "";
						}}
					/>
					<button
						class="secondary small"
						@click=${() => {
							let i = 200;
							while (responses[String(i)]) i++;
							this.updateOperation(selected.path, selected.method, {
								responses: { ...responses, [String(i)]: { description: "" } },
							});
						}}
					>
						＋ 添加响应
					</button>
				</div>
				${this.renderError(opPtr)}
			</div>
		`;
	}

	private renderOperationSecurity(selected: OperationItem) {
		const op = selected.operation;
		const security = asArray<Record<string, unknown>>(op.security);
		const opPtr = pointerPath("/paths", pointerEscape(selected.path), selected.method, "security");
		return html`
			<div class="section card">
				<h4>Security</h4>
				${security.length === 0
					? html`<div class="empty-row">未设置</div>`
					: security.map((req, idx) => {
							const names = Object.keys(req);
							return html`<div class="array-row">
								<input
									.value=${names.join(", ")}
									@change=${(e: InputEvent) => {
										const names = (e.target as HTMLInputElement).value
											.split(",")
											.map((s) => s.trim())
											.filter(Boolean);
										const next = security.map((r, i) =>
											i === idx ? Object.fromEntries(names.map((n) => [n, []])) : r,
										);
										this.updateOperation(selected.path, selected.method, { security: next });
									}}
								/>
								<button
									class="icon-btn delete"
									@click=${() =>
										this.updateOperation(selected.path, selected.method, { security: security.filter((_, i) => i !== idx) })}
								>
									×
								</button>
								${this.renderError(pointerPath(opPtr, String(idx)))}
							</div>`;
					  })}
				<button
					class="secondary small"
					@click=${() => this.updateOperation(selected.path, selected.method, { security: [...security, {}] })}
				>
					＋ 添加 Security Requirement
				</button>
				${this.renderError(opPtr)}
			</div>
		`;
	}

	private renderConfig() {
		const info = asRecord(this.draft.info);
		const servers = asArray<Record<string, unknown>>(this.draft.servers);
		const tags = asArray<Record<string, unknown>>(this.draft.tags);
		const security = asArray<Record<string, unknown>>(this.draft.security);
		return html`
			<section class="config card">
				<h3>资产级配置</h3>

				<div class="config-grid">
					<div class="op-field">
						<label>info.title</label>
						<input
							.value=${asString(info.title)}
							@input=${(e: InputEvent) => this.setDraft({ info: { ...info, title: (e.target as HTMLInputElement).value } })}
						/>
						${this.renderError("/info/title")}
					</div>
					<div class="op-field">
						<label>info.version</label>
						<input
							.value=${asString(info.version)}
							@input=${(e: InputEvent) => this.setDraft({ info: { ...info, version: (e.target as HTMLInputElement).value } })}
						/>
						${this.renderError("/info/version")}
					</div>
				</div>
				<div class="op-field">
					<label>info.description</label>
					<textarea
						.rows=${3}
						.value=${asString(info.description)}
						@input=${(e: InputEvent) => this.setDraft({ info: { ...info, description: (e.target as HTMLTextAreaElement).value } })}
					></textarea>
					${this.renderError("/info/description")}
				</div>

				<div class="subsection">
					<h4>Servers</h4>
					${servers.length === 0
						? html`<div class="empty-row">暂无服务器</div>`
						: html`<table>
								<tbody>
									${servers.map((server, idx) => {
										return html`<tr>
											<td>
												<input
													.value=${asString(server.url)}
													placeholder="URL"
													@input=${(e: InputEvent) => {
														const next = servers.map((s, i) =>
															i === idx ? { ...s, url: (e.target as HTMLInputElement).value } : s,
														);
														this.setDraft({ servers: next });
													}}
												/>
											</td>
											<td>
												<input
													.value=${asString(server.description)}
													placeholder="description"
													@input=${(e: InputEvent) => {
														const next = servers.map((s, i) =>
															i === idx ? { ...s, description: (e.target as HTMLInputElement).value } : s,
														);
														this.setDraft({ servers: next });
													}}
												/>
											</td>
											<td>
												<button
													class="icon-btn delete"
													@click=${() => this.setDraft({ servers: servers.filter((_, i) => i !== idx) })}
												>
													×
												</button>
											</td>
										</tr>`;
									})}
								</tbody>
							</table>`}
					<button class="secondary small" @click=${() => this.setDraft({ servers: [...servers, { url: "", description: "" }] })}>
						＋ 添加 Server
					</button>
					${this.renderError("/servers")}
				</div>

				<div class="subsection">
					<h4>Tags</h4>
					${tags.length === 0
						? html`<div class="empty-row">暂无标签</div>`
						: html`<table>
								<tbody>
									${tags.map((tag, idx) => {
										return html`<tr>
											<td>
												<input
													.value=${asString(tag.name)}
													placeholder="name"
													@input=${(e: InputEvent) => {
														const next = tags.map((t, i) =>
															i === idx ? { ...t, name: (e.target as HTMLInputElement).value } : t,
														);
														this.setDraft({ tags: next });
													}}
												/>
											</td>
											<td>
												<input
													.value=${asString(tag.description)}
													placeholder="description"
													@input=${(e: InputEvent) => {
														const next = tags.map((t, i) =>
															i === idx ? { ...t, description: (e.target as HTMLInputElement).value } : t,
														);
														this.setDraft({ tags: next });
													}}
												/>
											</td>
											<td>
												<button
													class="icon-btn delete"
													@click=${() => this.setDraft({ tags: tags.filter((_, i) => i !== idx) })}
												>
													×
												</button>
											</td>
										</tr>`;
									})}
								</tbody>
							</table>`}
					<button class="secondary small" @click=${() => this.setDraft({ tags: [...tags, { name: "", description: "" }] })}>
						＋ 添加 Tag
					</button>
					${this.renderError("/tags")}
				</div>

				<div class="subsection">
					<h4>Top-level Security</h4>
					${security.length === 0
						? html`<div class="empty-row">未设置</div>`
						: security.map((req, idx) => {
								const names = Object.keys(req);
								return html`<div class="array-row">
									<input
										.value=${names.join(", ")}
										@change=${(e: InputEvent) => {
											const names = (e.target as HTMLInputElement).value
												.split(",")
												.map((s) => s.trim())
												.filter(Boolean);
											const next = security.map((r, i) => (i === idx ? Object.fromEntries(names.map((n) => [n, []])) : r));
											this.setDraft({ security: next });
										}}
									/>
									<button class="icon-btn delete" @click=${() => this.setDraft({ security: security.filter((_, i) => i !== idx) })}>
										×
									</button>
									${this.renderError(`/security/${idx}`)}
								</div>`;
					  })}
					<button class="secondary small" @click=${() => this.setDraft({ security: [...security, {}] })}>＋ 添加 Security</button>
					${this.renderError("/security")}
				</div>
			</section>
		`;
	}

	private renderComponents() {
		const components = asRecord(this.draft.components);
		const schemas = asRecord(components.schemas);
		const securitySchemes = asRecord(components.securitySchemes);
		return html`
			<section class="components card">
				<h3>Components</h3>

				<div class="subsection">
					<h4>Schemas</h4>
					${Object.entries(schemas).length === 0
						? html`<div class="empty-row">暂无 schema</div>`
						: Object.entries(schemas).map(([name, schema]) => {
								const json = this.schemaJson[name] ?? JSON.stringify(schema, null, 2);
								return html`<div class="component-row">
									<div class="component-name-row">
										<input
											.value=${name}
										@change=${(e: InputEvent) => {
											const newName = (e.target as HTMLInputElement).value;
											if (!newName || newName === name) return;
											const { [name]: val, ...rest } = schemas;
											this.setDraft({ components: { ...components, schemas: { ...rest, [newName]: val } } });
											const saved = this.schemaJson[name];
											if (saved !== undefined) {
												this.schemaJson = { ...this.schemaJson, [newName]: saved };
												delete this.schemaJson[name];
											}
										}}
										/>
										<button
											class="icon-btn delete"
											@click=${() => {
												const { [name]: _, ...rest } = schemas;
												this.setDraft({ components: { ...components, schemas: rest } });
												const copy = { ...this.schemaJson };
												delete copy[name];
												this.schemaJson = copy;
											}}
										>
											×
										</button>
									</div>
									<textarea
										class="schema-json"
										.rows=${5}
										.value=${json}
										@input=${(e: InputEvent) => {
											const val = (e.target as HTMLTextAreaElement).value;
											this.schemaJson = { ...this.schemaJson, [name]: val };
											try {
												const parsed = JSON.parse(val);
												this.setDraft({ components: { ...components, schemas: { ...schemas, [name]: parsed } } });
											} catch {
												/* wait for valid JSON */
											}
										}}
									></textarea>
									${this.renderError(`/components/schemas/${pointerEscape(name)}`)}
								</div>`;
					  })}
				<div class="add-row">
					<input id="new-schema-name" placeholder="schema 名称" />
					<button
						class="secondary small"
						@click=${() => {
							const input = this.shadowRoot?.getElementById("new-schema-name") as HTMLInputElement | undefined;
							const name = input?.value.trim();
							if (!name || schemas[name]) return;
							this.setDraft({ components: { ...components, schemas: { ...schemas, [name]: { type: "object" } } } });
							if (input) input.value = "";
						}}
					>
						＋ 添加 Schema
					</button>
				</div>
				${this.renderError("/components/schemas")}
			</div>

			<div class="subsection">
				<h4>Security Schemes</h4>
				${Object.entries(securitySchemes).length === 0
					? html`<div class="empty-row">暂无 security scheme</div>`
					: Object.entries(securitySchemes).map(([name, scheme]) => {
							const rec = asRecord(scheme);
							const json = this.schemeJson[name] ?? JSON.stringify(rec, null, 2);
							return html`<div class="component-row">
								<div class="component-name-row">
									<input
										.value=${name}
									@change=${(e: InputEvent) => {
										const newName = (e.target as HTMLInputElement).value;
										if (!newName || newName === name) return;
										const { [name]: val, ...rest } = securitySchemes;
										this.setDraft({ components: { ...components, securitySchemes: { ...rest, [newName]: val } } });
									}}
									/>
									<button
										class="icon-btn delete"
										@click=${() => {
											const { [name]: _, ...rest } = securitySchemes;
											this.setDraft({ components: { ...components, securitySchemes: rest } });
											const copy = { ...this.schemeJson };
											delete copy[name];
											this.schemeJson = copy;
										}}
									>
										×
									</button>
								</div>
								<div class="op-field inline">
									<label>type</label>
									<select
										.value=${asString(rec.type) || "http"}
										@change=${(e: InputEvent) => {
											const type = (e.target as HTMLSelectElement).value;
											this.setDraft({
												components: {
													...components,
													securitySchemes: { ...securitySchemes, [name]: { type } },
												},
											});
										}}
									>
										${["http", "apiKey", "oauth2", "openIdConnect"].map((v) => html`<option value=${v}>${v}</option>`)}
									</select>
								</div>
								<textarea
									class="schema-json"
									.rows=${4}
									.value=${json}
									@input=${(e: InputEvent) => {
										const val = (e.target as HTMLTextAreaElement).value;
										this.schemeJson = { ...this.schemeJson, [name]: val };
										try {
											const parsed = JSON.parse(val);
											this.setDraft({
												components: {
													...components,
													securitySchemes: { ...securitySchemes, [name]: { ...rec, ...parsed } },
												},
											});
										} catch {
											/* wait for valid JSON */
										}
									}}
								></textarea>
								${this.renderError(`/components/securitySchemes/${pointerEscape(name)}`)}
							</div>`;
					  })}
				<div class="add-row">
					<input id="new-scheme-name" placeholder="scheme 名称" />
					<button
						class="secondary small"
						@click=${() => {
							const input = this.shadowRoot?.getElementById("new-scheme-name") as HTMLInputElement | undefined;
							const name = input?.value.trim();
							if (!name || securitySchemes[name]) return;
							this.setDraft({ components: { ...components, securitySchemes: { ...securitySchemes, [name]: { type: "http", scheme: "bearer" } } } });
							if (input) input.value = "";
						}}
					>
						＋ 添加 Security Scheme
					</button>
				</div>
				${this.renderError("/components/securitySchemes")}
			</div>
		</section>
		`;
	}

	static override styles = [
		sharedStyles,
		css`
			:host {
				display: block;
				height: 100%;
				--swagger-gap: var(--gap, 12px);
				--swagger-pad: var(--pad, 14px);
				--swagger-radius: var(--radius, 6px);
			}
			.swagger {
				display: flex;
				flex-direction: column;
				height: 100%;
				overflow: hidden;
				background: var(--bg);
				color: var(--text);
				gap: var(--swagger-gap);
				padding: var(--swagger-pad);
				box-sizing: border-box;
			}
			.save-bar {
				display: flex;
				justify-content: flex-end;
				align-items: center;
				gap: 12px;
				flex: 0 0 auto;
			}
			.conflict-hint {
				color: var(--danger);
				font-weight: 600;
			}
			.top-errors {
				flex: 0 0 auto;
				background: color-mix(in oklch, var(--danger) 12%, transparent);
				border: 1px solid var(--danger);
				border-radius: var(--swagger-radius);
				padding: 10px 12px;
				font-size: var(--text-sm);
			}
			.top-errors code {
				font-family: var(--font-mono);
				color: var(--text-muted);
			}
			.top-errors-title {
				font-weight: 600;
				color: var(--danger);
				margin-bottom: 4px;
			}
			.top-errors ul {
				margin: 0;
				padding-left: 18px;
			}
			.double-bar {
				display: flex;
				flex: 1 1 0;
				min-height: 0;
				gap: var(--swagger-gap);
			}
			.left,
			.right {
				display: flex;
				flex-direction: column;
				background: var(--surface);
				border: 1px solid var(--border);
				border-radius: var(--swagger-radius);
				overflow: hidden;
				min-height: 0;
			}
			.left {
				width: 40%;
				min-width: 320px;
			}
			.right {
				flex: 1 1 0;
				min-width: 0;
			}
			.left-header {
				flex: 0 0 auto;
				padding: var(--swagger-pad);
				border-bottom: 1px solid var(--border);
				display: flex;
				flex-direction: column;
				gap: 8px;
			}
			.filter-row {
				display: flex;
				flex-wrap: wrap;
				gap: 6px;
			}
			.method-chip {
				padding: 3px 8px;
				font-size: var(--text-xs);
				text-transform: uppercase;
				font-weight: 600;
			}
			.method-chip.active {
				background: var(--surface-2);
				border-color: var(--border-strong);
			}
			.method-chip.get.active,
			.method-chip.get:hover:not(:disabled) {
				color: var(--ok);
				border-color: var(--ok);
			}
			.method-chip.post.active,
			.method-chip.post:hover:not(:disabled) {
				color: var(--accent);
				border-color: var(--accent);
			}
			.method-chip.put.active,
			.method-chip.patch.active,
			.method-chip.put:hover:not(:disabled),
			.method-chip.patch:hover:not(:disabled) {
				color: var(--warn);
				border-color: var(--warn);
			}
			.method-chip.delete.active,
			.method-chip.delete:hover:not(:disabled) {
				color: var(--danger);
				border-color: var(--danger);
			}
			.filter-input {
				width: 100%;
			}
			.add-op {
				display: flex;
				gap: 6px;
			}
			.add-op input {
				flex: 1 1 auto;
			}
			.add-op select {
				flex: 0 0 auto;
			}
			.scroll,
			.right-scroll {
				flex: 1 1 0;
				overflow: auto;
				padding: var(--swagger-pad);
				min-height: 0;
			}
			.group {
				margin-bottom: 14px;
			}
			.group-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 8px;
				color: var(--text-muted);
				font-size: var(--text-sm);
				font-weight: 600;
				margin-bottom: 4px;
			}
			.group-name {
				text-transform: uppercase;
				letter-spacing: 0.06em;
			}
			.op-list {
				list-style: none;
				margin: 0;
				padding: 0;
				display: flex;
				flex-direction: column;
				gap: 4px;
			}
			.op-item {
				display: flex;
				align-items: center;
				gap: 8px;
				padding: 6px 8px;
				border-radius: 4px;
				cursor: pointer;
				border: 1px solid transparent;
			}
			.op-item:hover {
				background: var(--surface-hover);
			}
			.op-item.active {
				background: var(--surface-2);
				border-color: var(--border-strong);
			}
			.op-item .method {
				font-size: var(--text-xs);
				font-weight: 700;
				width: 40px;
				text-align: center;
				text-transform: uppercase;
			}
			.op-item .method.get { color: var(--ok); }
			.op-item .method.post { color: var(--accent); }
			.op-item .method.put,
			.op-item .method.patch { color: var(--warn); }
			.op-item .method.delete { color: var(--danger); }
			.op-item .path {
				font-size: var(--text-sm);
				color: var(--text);
				flex: 0 1 auto;
			}
			.op-item .summary {
				font-size: var(--text-xs);
				color: var(--text-muted);
				flex: 1 1 auto;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.op-title-row {
				display: flex;
				align-items: center;
				gap: 10px;
				margin-bottom: 10px;
			}
			.op-title-row .method {
				font-size: var(--text-sm);
				font-weight: 700;
				text-transform: uppercase;
			}
			.op-title-row .method.get { color: var(--ok); }
			.op-title-row .method.post { color: var(--accent); }
			.op-title-row .method.put,
			.op-title-row .method.patch { color: var(--warn); }
			.op-title-row .method.delete { color: var(--danger); }
			.path-input {
				flex: 1 1 auto;
				font-size: var(--text-base);
			}
			.op-field {
				display: flex;
				flex-direction: column;
				gap: 4px;
				margin-bottom: 10px;
			}
			.op-field.inline {
				flex-direction: row;
				align-items: center;
				gap: 8px;
			}
			.op-field label {
				font-size: var(--text-xs);
				color: var(--text-muted);
				text-transform: uppercase;
				letter-spacing: 0.06em;
			}
			.section {
				margin-bottom: 14px;
			}
			.section h4 {
				margin: 0 0 8px;
				font-size: var(--text-sm);
				color: var(--text-muted);
				text-transform: uppercase;
				letter-spacing: 0.06em;
			}
			.empty-row {
				color: var(--text-muted);
				font-size: var(--text-sm);
				padding: 6px 0;
			}
			.field-error {
				color: var(--danger);
				font-size: var(--text-xs);
			}
			.icon-btn {
				padding: 2px 6px;
				font-size: var(--text-base);
				line-height: 1;
			}
			.icon-btn.delete {
				opacity: 0.6;
			}
			.icon-btn.delete:hover {
				opacity: 1;
				color: var(--danger);
				border-color: var(--danger);
			}
			.status-input {
				width: 80px;
			}
			.response-row {
				border: 1px solid var(--border);
				border-radius: var(--swagger-radius);
				padding: 10px;
				margin-bottom: 10px;
			}
			.add-row {
				display: flex;
				align-items: center;
				gap: 8px;
				margin-top: 6px;
			}
			.schema-json {
				width: 100%;
				font-family: var(--font-mono);
				font-size: var(--text-xs);
			}
			.array-row {
				display: flex;
				align-items: center;
				gap: 8px;
				margin-bottom: 6px;
			}
			.array-row input {
				flex: 1 1 auto;
			}
			.lower {
				flex: 0 0 auto;
				max-height: 40%;
				overflow: auto;
				display: flex;
				flex-direction: column;
				gap: var(--swagger-gap);
			}
			.config h3,
			.components h3 {
				margin: 0 0 10px;
				font-size: var(--text-base);
			}
			.config-grid {
				display: grid;
				grid-template-columns: repeat(2, minmax(0, 1fr));
				gap: 12px;
			}
			.subsection {
				margin-top: 14px;
			}
			.subsection h4 {
				margin: 0 0 8px;
				font-size: var(--text-sm);
				color: var(--text-muted);
			}
			.component-row {
				border: 1px solid var(--border);
				border-radius: var(--swagger-radius);
				padding: 10px;
				margin-bottom: 10px;
			}
			.component-name-row {
				display: flex;
				align-items: center;
				gap: 8px;
				margin-bottom: 8px;
			}
			.component-name-row input {
				flex: 1 1 auto;
				font-weight: 600;
			}
			button.small {
				padding: 5px 10px;
				font-size: var(--text-xs);
			}
			button.secondary {
				background: transparent;
				border-color: var(--border-strong);
				color: var(--text);
			}
			button.secondary:hover {
				background: var(--surface-hover);
			}
			.empty {
				display: flex;
				align-items: center;
				justify-content: center;
				color: var(--text-muted);
			}
			@media (max-width: 1023px) {
				.double-bar {
					flex-direction: column;
				}
				.left {
					width: auto;
					min-width: auto;
					max-height: 40vh;
				}
				.right {
					min-height: 0;
				}
				.config-grid {
					grid-template-columns: 1fr;
				}
			}
		`,
	];
}

declare global {
	interface HTMLElementTagNameMap {
		"baize-api-swagger": BaizeApiSwagger;
	}
}

customElements.define("baize-api-swagger", BaizeApiSwagger);
