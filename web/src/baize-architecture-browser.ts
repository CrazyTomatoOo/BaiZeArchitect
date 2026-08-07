import { LitElement, html, css, type TemplateResult } from "lit";
import "./baize-markdown.js";

type TreeNode = {
	name: string;
	path: string;
	kind: "directory" | "file";
	children?: TreeNode[];
};

type C4Data = {
	repositoryId: string;
	head_sha?: string;
	generatedAt?: string;
	generation?: string;
	context?: {
		name?: string;
		description?: string;
		externalSystems?: Array<{ name?: string; kind?: string }>;
	};
	containers?: Array<Record<string, unknown>>;
	components?: Array<Record<string, unknown>>;
	code?: {
		totalNodes?: number;
		totalEdges?: number;
		hotspots?: Array<{ qualified_name?: string; fan_in?: number }>;
		boundaries?: Array<{ from?: string; to?: string; call_count?: number }>;
		clusters?: Array<{
			label?: string;
			members?: number;
			cohesion?: number;
			top_nodes?: string[];
		}>;
	};
};

type Level = "context" | "container" | "component" | "code";

/**
 * baize-architecture-browser — 架构浏览能力(B):目录树 + C4 四层。
 * C4 数据由 gateway 按仓库 head_sha 缓存;当前 draft 的 Context/Component
 * 使用可解释的仓库配置与代码聚类,Code 层保留真实热点/边界/聚类证据。
 */
class BaizeArchitectureBrowser extends LitElement {
	static properties = {
		repo: {},
		tree: { state: true },
		c4: { state: true },
		level: { state: true },
		loading: { state: true },
		generating: { state: true },
		error: { state: true },
	};

	declare repo: string;
	declare tree: TreeNode[];
	declare c4: C4Data | null;
	declare level: Level;
	declare loading: boolean;
	declare generating: boolean;
	declare error: string;

	static styles = css`
		:host { display: block; min-height: 100%; }
		:host([hidden]) { display: none; }
		.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
		.page-head h1 { margin: 0; font: 650 1.4rem var(--font-display); }
		.sub { margin: 4px 0 0; color: var(--text-muted); font-size: .86rem; line-height: 1.5; }
		.actions { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
		button { font: inherit; cursor: pointer; }
		.primary { border: 1px solid var(--accent); background: var(--accent); color: var(--accent-fg); border-radius: var(--radius-sm); padding: .5rem .8rem; font-weight: 650; }
		.secondary { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: var(--radius-sm); padding: .5rem .8rem; }
		.primary:disabled, .secondary:disabled { opacity: .55; cursor: wait; }
		.layout { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 12px; min-height: 620px; }
		.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; min-width: 0; }
		.tree-card { overflow: auto; }
		.card-title { margin: 0 0 .7rem; color: var(--text-muted); font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; }
		details { margin-left: .2rem; }
		details details { margin-left: .85rem; }
		summary { padding: .26rem .2rem; color: var(--text); cursor: pointer; font-size: .78rem; list-style: none; }
		summary::before { content: "▸"; display: inline-block; width: 1rem; color: var(--text-subtle); }
		details[open] > summary::before { content: "▾"; }
		.file { display: block; padding: .26rem .2rem  .26rem 1.2rem; color: var(--text-muted); font: .73rem var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.levels { display: flex; gap: .4rem; flex-wrap: wrap; margin-bottom: 12px; }
		.level { border: 1px solid var(--border); border-radius: 99px; background: transparent; color: var(--text-muted); padding: .4rem .65rem; font-size: .76rem; }
		.level.active { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
		.level small { opacity: .75; margin-left: .25rem; }
		.panel { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(230px, .8fr); gap: 12px; }
		.diagram { min-height: 390px; overflow: auto; }
		.diagram baize-markdown { display: block; min-height: 340px; }
		.explain h2 { margin: 0 0 .35rem; font-size: 1rem; }
		.explain p { margin: 0 0 .8rem; color: var(--text-muted); font-size: .82rem; line-height: 1.55; }
		.draft { display: inline-block; border: 1px solid var(--warn); color: var(--warn); border-radius: 99px; padding: .18rem .45rem; font-size: .68rem; }
		.stats { display: flex; gap: .4rem; flex-wrap: wrap; margin: .7rem 0; }
		.stat { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .38rem .55rem; color: var(--text-muted); font-size: .72rem; }
		.stat strong { color: var(--text); font-family: var(--font-mono); }
		.list { margin: .7rem 0 0; padding: 0; list-style: none; max-height: 260px; overflow: auto; }
		.list li { border-top: 1px solid var(--border); padding: .46rem 0; font: .72rem var(--font-mono); color: var(--text-muted); overflow-wrap: anywhere; }
		.list .num { float: right; color: var(--accent); }
		.error, .empty { color: var(--text-muted); font-size: .8rem; }
		.error { color: var(--danger); }
		@media (max-width: 900px) { .layout, .panel { grid-template-columns: 1fr; } .tree-card { min-height: 220px; } }
	`;

	constructor() {
		super();
		this.repo = "";
		this.tree = [];
		this.c4 = null;
		this.level = "context";
		this.loading = false;
		this.generating = false;
		this.error = "";
	}


	updated(changed: Map<string, unknown>): void {
		if (changed.has("repo") && this.repo) void this.load();
	}

	private async load(): Promise<void> {
		if (!this.repo) return;
		this.loading = true;
		this.error = "";
		const id = encodeURIComponent(this.repo);
		try {
			const [treeResponse, c4Response] = await Promise.all([
				fetch(`/api/architecture/${id}/tree`),
				fetch(`/api/architecture/${id}/c4`),
			]);
			if (!treeResponse.ok)
				throw new Error(`目录读取失败(${treeResponse.status})`);
			const treeBody = (await treeResponse.json()) as { tree?: TreeNode[] };
			this.tree = treeBody.tree ?? [];
			this.c4 = c4Response.ok ? ((await c4Response.json()) as C4Data) : null;
		} catch (error) {
			this.error = error instanceof Error ? error.message : "架构数据读取失败";
		} finally {
			this.loading = false;
		}
	}

	private async generate(): Promise<void> {
		if (!this.repo) return;
		this.generating = true;
		this.error = "";
		try {
			const response = await fetch(
				`/api/architecture/${encodeURIComponent(this.repo)}/c4/generate`,
				{ method: "POST" },
			);
			if (!response.ok) throw new Error(`C4 生成失败(${response.status})`);
			this.c4 = (await response.json()) as C4Data;
		} catch (error) {
			this.error = error instanceof Error ? error.message : "C4 生成失败";
		} finally {
			this.generating = false;
		}
	}

	private safeId(value: unknown, fallback: string): string {
		const text = String(value ?? fallback).replace(/[^a-zA-Z0-9_]/g, "_");
		return /^[a-zA-Z]/.test(text)
			? text.slice(0, 28)
			: `n_${text.slice(0, 27)}`;
	}

	private quote(value: unknown): string {
		return String(value ?? "")
			.replace(/["\n\r]/g, " ")
			.slice(0, 80);
	}

	private diagramFor(level: Level): string {
		const c4 = this.c4;
		if (!c4) return "";
		const systemId = this.safeId(c4.context?.name, "system");
		if (level === "context") {
			const external = (c4.context?.externalSystems ?? []).slice(0, 6);
			return [
				"C4Context",
				`title ${this.quote(c4.context?.name ?? c4.repositoryId)} — System Context`,
				`Person(user, "使用者", "设计与审核需求")`,
				`System(${systemId}, "${this.quote(c4.context?.name ?? c4.repositoryId)}", "${this.quote(c4.context?.description)}")`,
				...external.map(
					(x, i) =>
						`System_Ext(ext${i}, "${this.quote(x.name)}", "${this.quote(x.kind ?? "dependency")}")`,
				),
				`Rel(user, ${systemId}, "设计与审核")`,
				...external.map((_, i) => `Rel(${systemId}, ext${i}, "依赖")`),
			].join("\n");
		}
		if (level === "container") {
			const containers = (c4.containers ?? []).slice(0, 10);
			if (!containers.length)
				containers.push({
					id: "app",
					name: "Application",
					technology: "unknown",
					description: "未发现 package.json 或 compose 服务配置",
				});
			return [
				"C4Container",
				`title ${this.quote(c4.context?.name ?? c4.repositoryId)} — Containers`,
				`System_Boundary(${systemId}, "${this.quote(c4.context?.name ?? c4.repositoryId)}") {`,
				...containers.map(
					(x, i) =>
						`Container(${this.safeId(x.id, `container_${i}`)}, "${this.quote(x.name)}", "${this.quote(x.technology)}", "${this.quote(x.description)}")`,
				),
				"}",
			].join("\n");
		}
		if (level === "component") {
			const components = (c4.components ?? []).slice(0, 16);
			if (!components.length)
				components.push({
					id: "component-0",
					name: "待识别职责块",
					description: "暂无可用代码聚类",
				});
			const containerId = this.safeId(c4.containers?.[0]?.id, "app");
			return [
				"C4Component",
				`title ${this.quote(c4.context?.name ?? c4.repositoryId)} — Components (draft)`,
				`Container_Boundary(${containerId}, "${this.quote(c4.containers?.[0]?.name ?? "application")}") {`,
				...components.map(
					(x, i) =>
						`Component(${this.safeId(x.id, `component_${i}`)}, "${this.quote(x.name)}", "code", "${this.quote(x.description)}")`,
				),
				"}",
			].join("\n");
		}
		const hotspots = (c4.code?.hotspots ?? []).slice(0, 8);
		const boundaries = (c4.code?.boundaries ?? []).slice(0, 8);
		const lines = [
			"flowchart LR",
			`system["${this.quote(c4.context?.name ?? c4.repositoryId)}"]`,
		];
		for (const [i, hot] of hotspots.entries())
			lines.push(
				`h${i}["${this.quote(hot.qualified_name)} · ${Number(hot.fan_in ?? 0)} callers"]`,
				`system --> h${i}`,
			);
		for (const [i, boundary] of boundaries.entries())
			lines.push(
				`b${i}["${this.quote(boundary.from)} → ${this.quote(boundary.to)} · ${Number(boundary.call_count ?? 0)} calls"]`,
				`system -.-> b${i}`,
			);
		return lines.join("\n");
	}

	private renderTree(nodes: TreeNode[], depth = 0): TemplateResult[] {
		return nodes.map((node) =>
			node.kind === "directory"
				? html`<details ?open=${depth === 0}><summary>${node.name}</summary>${this.renderTree(node.children ?? [], depth + 1)}</details>`
				: html`<span class="file" title=${node.path}>${node.name}</span>`,
		);
	}

	private renderCodeSupport() {
		const code = this.c4?.code;
		return html`
			<div class="stats">
				<span class="stat">真实节点 <strong>${code?.totalNodes ?? "—"}</strong></span>
				<span class="stat">真实边 <strong>${code?.totalEdges ?? "—"}</strong></span>
				<span class="stat">热点 <strong>${code?.hotspots?.length ?? 0}</strong></span>
				<span class="stat">边界 <strong>${code?.boundaries?.length ?? 0}</strong></span>
			</div>
			<h3 class="card-title">热点与边界支撑</h3>
			<ul class="list">
				${(code?.hotspots ?? []).slice(0, 8).map((x) => html`<li>${x.qualified_name}<span class="num">${x.fan_in ?? 0}</span></li>`)}
				${(code?.boundaries ?? []).slice(0, 8).map((x) => html`<li>${x.from} → ${x.to}<span class="num">${x.call_count ?? 0}</span></li>`)}
			</ul>
		`;
	}

	private renderDiagram(diagram: string): TemplateResult {
		if (!this.c4)
			return html`<div class="empty">还没有 C4 草稿。点击「生成/更新 C4」从当前仓库结构创建。</div>`;
		const label =
			this.c4.generation === "heuristic-draft"
				? `可解释草稿 · head ${String(this.c4.head_sha ?? "").slice(0, 8)}`
				: "已生成";
		return html`<span class="draft">${label}</span><baize-markdown .text=${this.markdownForDiagram(diagram)}></baize-markdown>`;
	}

	private renderLevelExplain(): TemplateResult {
		const text =
			this.level === "context"
				? "看系统与使用者、外部依赖的关系。"
				: this.level === "container"
					? "看可独立运行或部署的单元,不是 Kubernetes 节点。"
					: this.level === "component"
						? "看接口背后的职责块;当前从代码聚类生成可解释草稿。"
						: "看真实代码证据:热点、跨目录边界和聚类。";
		return html`<div class="card explain"><h2>${{ context: "Context", container: "Container", component: "Component", code: "Code" }[this.level]} 层</h2><p>${text}</p>${this.level === "code" ? this.renderCodeSupport() : html`<p class="empty">${this.c4 ? "图中节点来自当前仓库快照。切换层级可继续下钻。" : "生成草稿后可查看这一层。"}</p>`}</div>`;
	}

	private markdownForDiagram(diagram: string): string {
		return ["```mermaid", diagram, "```"].join("\n");
	}

	render() {
		const diagram = this.diagramFor(this.level);
		const levelNames: Record<Level, string> = {
			context: "Context",
			container: "Container",
			component: "Component",
			code: "Code",
		};
		return html`
			<div class="page-head">
				<div><h1>架构浏览</h1><p class="sub">从目录、运行单元到代码职责块,逐层理解仓库结构。当前仓库: <strong>${this.repo || "—"}</strong></p></div>
				<div class="actions"><button class="secondary" @click=${() => this.load()} ?disabled=${this.loading}>刷新</button><button class="primary" @click=${() => this.generate()} ?disabled=${this.generating}>${this.generating ? "生成中…" : "生成/更新 C4"}</button></div>
			</div>
			${this.error ? html`<p class="error">${this.error}</p>` : null}
			<div class="layout">
				<section class="card tree-card"><h2 class="card-title">目录树</h2>${this.loading ? html`<p class="empty">读取中…</p>` : this.tree.length ? this.renderTree(this.tree) : html`<p class="empty">暂无目录数据</p>`}</section>
				<section>
					<div class="levels">${(
						["context", "container", "component", "code"] as Level[]
					).map(
						(item) =>
							html`<button class="level ${item === this.level ? "active" : ""}" @click=${() => {
								this.level = item;
							}}>${levelNames[item]}<small>${item === "context" ? "系统" : item === "container" ? "运行单元" : item === "component" ? "职责块" : "代码证据"}</small></button>`,
					)}</div>
					<div class="panel">
						<div class="card diagram">${this.renderDiagram(diagram)}</div>
						${this.renderLevelExplain()}
					</div>
				</section>
			</div>
		`;
	}
}

customElements.define("baize-architecture-browser", BaizeArchitectureBrowser);
