import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { ref, createRef } from "lit/directives/ref.js";
import { sharedStyles } from "./baize-styles.js";
import { updateAsset, AssetMutationError, type AssetValidationError } from "./workflow-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogicalType = "string" | "text" | "integer" | "decimal" | "boolean" | "date" | "datetime" | "time" | "uuid" | "binary" | "json" | "enum";
type Cardinality = "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
type OnDelete = "CASCADE" | "SET_NULL" | "RESTRICT" | "NO_ACTION";
type DataView = "structure" | "graph";

interface Field {
	fieldId: string;
	name: string;
	description?: string;
	logicalType: LogicalType;
	dialectType?: string;
	nullable: boolean;
	defaultValue?: unknown;
	unique: boolean;
	enumValues?: unknown[];
}

interface Index {
	name: string;
	fieldIds: string[];
	unique: boolean;
}

interface Entity {
	entityId: string;
	name: string;
	description?: string;
	fields: Field[];
	primaryKey: string[];
	uniqueKeys?: string[][];
	indexes?: Index[];
}

interface Relation {
	name: string;
	fromEntityId: string;
	fromFieldIds: string[];
	toEntityId: string;
	toFieldIds: string[];
	cardinality: Cardinality;
	optional?: boolean;
	onDelete?: OnDelete;
	onUpdate?: string;
	description?: string;
}

interface Catalog {
	entities: Entity[];
	relations: Relation[];
	notes?: string;
}

interface DataCatalogContent {
	schemaVersion: "asset/data/v1";
	artifactKind: "data";
	summary: string;
	sourceRefs: unknown[];
	catalog: Catalog;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOGICAL_TYPES: readonly LogicalType[] = ["string", "text", "integer", "decimal", "boolean", "date", "datetime", "time", "uuid", "binary", "json", "enum"];
const CARDINALITIES: readonly Cardinality[] = ["one-to-one", "one-to-many", "many-to-one", "many-to-many"];
const ON_DELETE_VALUES: readonly OnDelete[] = ["CASCADE", "SET_NULL", "RESTRICT", "NO_ACTION"];

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function newId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
	return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function emptyCatalog(): Catalog {
	return { entities: [], relations: [], notes: "" };
}

function fieldOptions(entity: Entity): { fieldId: string; name: string }[] {
	return entity.fields.map((f) => ({ fieldId: f.fieldId, name: f.name || "(未命名)" }));
}

function fieldNameMap(entity: Entity): Map<string, string> {
	const map = new Map<string, string>();
	for (const f of entity.fields) map.set(f.fieldId, f.name || "(未命名)");
	return map;
}

function readCatalog(draft: Record<string, unknown>): Catalog {
	const catalog = asRecord(draft.catalog);
	if (!catalog) return emptyCatalog();
	return {
		entities: Array.isArray(catalog.entities) ? (catalog.entities as Entity[]) : [],
		relations: Array.isArray(catalog.relations) ? (catalog.relations as Relation[]) : [],
		notes: typeof catalog.notes === "string" ? catalog.notes : "",
	};
}

function entityOptions(catalog: Catalog): { entityId: string; name: string }[] {
	return catalog.entities.map((e) => ({ entityId: e.entityId, name: e.name || "(未命名)" }));
}
function getEntityById(catalog: Catalog, entityId: string): Entity | undefined {
	return catalog.entities.find((e) => e.entityId === entityId);
}

function relationsForEntity(catalog: Catalog, entityId: string): Relation[] {
	return catalog.relations.filter((r) => r.fromEntityId === entityId || r.toEntityId === entityId);
}

function parseDefaultValue(raw: string): unknown {
	const trimmed = raw.trim();
	if (trimmed === "") return undefined;
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
	try {
		return JSON.parse(trimmed);
	} catch {
		return trimmed;
	}
}

function formatDefaultValue(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	return JSON.stringify(value);
}

function parseEnumValues(raw: string): unknown[] | undefined {
	const trimmed = raw.trim();
	if (trimmed === "") return undefined;
	try {
		const parsed = JSON.parse(trimmed);
		if (Array.isArray(parsed)) return parsed;
		return trimmed.split(",").map((s) => s.trim());
	} catch {
		return trimmed.split(",").map((s) => s.trim());
	}
}

function formatEnumValues(values: unknown[] | undefined): string {
	if (!values || values.length === 0) return "";
	return JSON.stringify(values);
}

function errorsForPath(errors: Record<string, string>, prefix: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [path, message] of Object.entries(errors)) {
		if (path.startsWith(prefix)) result[path.slice(prefix.length) || "/"] = message;
	}
	return result;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class BaizeDataCatalog extends LitElement {
	static properties = {
		apiBase: { type: String },
		assetId: { type: Number },
		expectedRevisionId: { type: Number },
		content: { type: Object },
		title: { type: String },
		draft: { state: true },
		modified: { state: true },
		fieldErrors: { state: true },
		conflict: { state: true },
		saving: { state: true },
		activeView: { state: true },
		selectedEntityId: { state: true },
		entitySearch: { state: true },
		graphZoom: { state: true },
		graphOffset: { state: true },
		graphDragging: { state: true },
		graphDragStart: { state: true },
		graphDragLast: { state: true },
		graphSize: { state: true },
	};

	declare apiBase: string;
	declare assetId: number;
	declare expectedRevisionId: number;
	declare content: unknown;
	declare title: string;

	// Internal reactive state
	declare draft: Record<string, unknown>;
	declare modified: boolean;
	declare fieldErrors: Record<string, string>;
	declare conflict: boolean;
	declare saving: boolean;
	declare activeView: DataView;
	declare selectedEntityId: string | null;
	declare entitySearch: string;
	declare graphZoom: number;
	declare graphOffset: { x: number; y: number };
	declare graphDragging: boolean;
	declare graphDragStart: { x: number; y: number } | null;
	declare graphDragLast: { x: number; y: number } | null;
	declare graphSize: { width: number; height: number };
	private graphHostRef = createRef<HTMLDivElement>();

	private originalDigest = "";
	private resizeObserver: ResizeObserver | null = null;
	private boundKeydown = this.handleKeydown.bind(this);
	private boundSaveError = this.handleSaveError.bind(this);

	constructor() {
		super();
		this.draft = {};
		this.modified = false;
		this.fieldErrors = {};
		this.conflict = false;
		this.saving = false;
		this.activeView = "structure";
		this.selectedEntityId = null;
		this.entitySearch = "";
		this.graphZoom = 1;
		this.graphOffset = { x: 40, y: 40 };
		this.graphDragging = false;
		this.graphDragStart = null;
		this.graphDragLast = null;
		this.graphSize = { width: 0, height: 0 };
	}

	connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener("keydown", this.boundKeydown);
		window.addEventListener("baize-asset-save-error", this.boundSaveError);
		this.resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				this.graphSize = { width: entry.contentRect.width, height: entry.contentRect.height };
			}
		});
	}

	disconnectedCallback(): void {
		window.removeEventListener("keydown", this.boundKeydown);
		window.removeEventListener("baize-asset-save-error", this.boundSaveError);
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		super.disconnectedCallback();
	}

	protected willUpdate(changed: PropertyValues<this>): void {
		if (changed.has("content")) {
			this.draft = clone(asRecord(this.content) ?? {});
			this.originalDigest = JSON.stringify(this.draft);
			this.modified = false;
			this.fieldErrors = {};
			this.conflict = false;
			const catalog = readCatalog(this.draft);
			this.selectedEntityId = catalog.entities[0]?.entityId ?? null;
			this.activeView = "structure";
		}
	}

	private digest(value: Record<string, unknown>): string {
		return JSON.stringify(value);
	}

	private markModified(): void {
		this.modified = this.digest(this.draft) !== this.originalDigest;
	}

	protected updated(changed: PropertyValues<this>): void {
		if (changed.has("activeView") && this.activeView === "graph") {
			const el = this.graphHostRef.value;
			if (el && this.resizeObserver) this.resizeObserver.observe(el);
		}
	}

	private mutateCatalog(mutator: (catalog: Catalog) => Catalog): void {
		const catalog = readCatalog(this.draft);
		this.draft = { ...this.draft, catalog: mutator(catalog) };
		this.markModified();
	}

	private setSelectedEntity(entityId: string): void {
		this.selectedEntityId = entityId;
		this.activeView = "structure";
	}

	private addEntity(): void {
		const catalog = readCatalog(this.draft);
		const entity: Entity = {
			entityId: newId(),
			name: `新表 ${catalog.entities.length + 1}`,
			description: "",
			fields: [],
			primaryKey: [],
			uniqueKeys: [],
			indexes: [],
		};
		this.draft = { ...this.draft, catalog: { ...catalog, entities: [...catalog.entities, entity] } };
		this.selectedEntityId = entity.entityId;
		this.activeView = "structure";
		this.markModified();
	}

	private updateEntity(entityId: string, patch: Partial<Entity>): void {
		this.mutateCatalog((catalog) => ({
			...catalog,
			entities: catalog.entities.map((e) => (e.entityId === entityId ? { ...e, ...patch } : e)),
		}));
	}

	private deleteEntity(entityId: string): void {
		const catalog = readCatalog(this.draft);
		this.draft = {
			...this.draft,
			catalog: {
				...catalog,
				entities: catalog.entities.filter((e) => e.entityId !== entityId),
				relations: catalog.relations.filter((r) => r.fromEntityId !== entityId && r.toEntityId !== entityId),
			},
		};
		if (this.selectedEntityId === entityId) {
			const next = readCatalog(this.draft).entities[0]?.entityId ?? null;
			this.selectedEntityId = next;
		}
		this.markModified();
	}

	private addField(entityId: string): void {
		const catalog = readCatalog(this.draft);
		const entity = getEntityById(catalog, entityId);
		if (!entity) return;
		const field: Field = {
			fieldId: newId(),
			name: `field_${entity.fields.length + 1}`,
			description: "",
			logicalType: "string",
			dialectType: "",
			nullable: true,
			defaultValue: undefined,
			unique: false,
			enumValues: undefined,
		};
		this.draft = {
			...this.draft,
			catalog: {
				...catalog,
				entities: catalog.entities.map((e) => (e.entityId === entityId ? { ...e, fields: [...e.fields, field] } : e)),
			},
		};
		this.markModified();
	}

	private updateField(entityId: string, fieldId: string, patch: Partial<Field>): void {
		this.mutateCatalog((catalog) => ({
			...catalog,
			entities: catalog.entities.map((e) =>
				e.entityId === entityId
					? { ...e, fields: e.fields.map((f) => (f.fieldId === fieldId ? { ...f, ...patch } : f)) }
					: e,
			),
		}));
	}

	private deleteField(entityId: string, fieldId: string): void {
		this.mutateCatalog((catalog) => ({
			...catalog,
			entities: catalog.entities.map((e) => {
				if (e.entityId !== entityId) return e;
				return {
					...e,
					fields: e.fields.filter((f) => f.fieldId !== fieldId),
					primaryKey: e.primaryKey.filter((id) => id !== fieldId),
					uniqueKeys: (e.uniqueKeys ?? []).map((group) => group.filter((id) => id !== fieldId)).filter((group) => group.length > 0),
					indexes: (e.indexes ?? []).map((idx) => ({ ...idx, fieldIds: idx.fieldIds.filter((id) => id !== fieldId) })).filter((idx) => idx.fieldIds.length > 0),
				};
			}),
		}));
	}

	private setPrimaryKey(entityId: string, fieldIds: string[]): void {
		this.updateEntity(entityId, { primaryKey: fieldIds });
	}

	private addUniqueKey(entityId: string): void {
		this.mutateCatalog((catalog) => ({
			...catalog,
			entities: catalog.entities.map((e) =>
				e.entityId === entityId ? { ...e, uniqueKeys: [...(e.uniqueKeys ?? []), []] } : e,
			),
		}));
	}

	private updateUniqueKey(entityId: string, index: number, fieldIds: string[]): void {
		this.mutateCatalog((catalog) => ({
			...catalog,
			entities: catalog.entities.map((e) =>
				e.entityId === entityId
					? { ...e, uniqueKeys: e.uniqueKeys?.map((group, i) => (i === index ? fieldIds : group)) ?? [] }
					: e,
			),
		}));
	}

	private deleteUniqueKey(entityId: string, index: number): void {
		this.mutateCatalog((catalog) => ({
			...catalog,
			entities: catalog.entities.map((e) =>
				e.entityId === entityId
					? { ...e, uniqueKeys: e.uniqueKeys?.filter((_, i) => i !== index) ?? [] }
					: e,
			),
		}));
	}

	private addIndex(entityId: string): void {
		this.mutateCatalog((catalog) => ({
			...catalog,
			entities: catalog.entities.map((e) =>
				e.entityId === entityId
					? { ...e, indexes: [...(e.indexes ?? []), { name: `idx_${(e.indexes?.length ?? 0) + 1}`, fieldIds: [], unique: false }] }
					: e,
			),
		}));
	}

	private updateIndex(entityId: string, index: number, patch: Partial<Index>): void {
		this.mutateCatalog((catalog) => ({
			...catalog,
			entities: catalog.entities.map((e) =>
				e.entityId === entityId
					? { ...e, indexes: e.indexes?.map((idx, i) => (i === index ? { ...idx, ...patch } : idx)) ?? [] }
					: e,
			),
		}));
	}

	private deleteIndex(entityId: string, index: number): void {
		this.mutateCatalog((catalog) => ({
			...catalog,
			entities: catalog.entities.map((e) =>
				e.entityId === entityId ? { ...e, indexes: e.indexes?.filter((_, i) => i !== index) ?? [] } : e,
			),
		}));
	}

	private addRelation(): void {
		const catalog = readCatalog(this.draft);
		const fromEntityId = catalog.entities[0]?.entityId ?? "";
		const toEntityId = catalog.entities[1]?.entityId ?? fromEntityId;
		const relation: Relation = {
			name: `fk_${catalog.relations.length + 1}`,
			fromEntityId,
			fromFieldIds: [],
			toEntityId,
			toFieldIds: [],
			cardinality: "many-to-one",
			optional: false,
			onDelete: "NO_ACTION",
			onUpdate: "NO_ACTION",
			description: "",
		};
		this.draft = { ...this.draft, catalog: { ...catalog, relations: [...catalog.relations, relation] } };
		this.markModified();
	}

	private updateRelation(index: number, patch: Partial<Relation>): void {
		this.mutateCatalog((catalog) => ({
			...catalog,
			relations: catalog.relations.map((r, i) => (i === index ? { ...r, ...patch } : r)),
		}));
	}

	private deleteRelation(index: number): void {
		this.mutateCatalog((catalog) => ({
			...catalog,
			relations: catalog.relations.filter((_, i) => i !== index),
		}));
	}

	private setNotes(notes: string): void {
		this.mutateCatalog((catalog) => ({ ...catalog, notes }));
	}

	private async save(): Promise<void> {
		if (!this.modified || this.saving || this.conflict) return;
		this.saving = true;
		this.fieldErrors = {};
		try {
			const result = await updateAsset(this.apiBase, this.assetId, {
				expectedRevisionId: this.expectedRevisionId,
				title: this.title,
				content: this.draft,
				relations: [],
			});
			this.expectedRevisionId = result.revisionId;
			this.originalDigest = this.digest(this.draft);
			this.modified = false;
			this.dispatchEvent(new CustomEvent("save", { detail: { content: this.draft, title: this.title } }));
		} catch (error) {
			if (error instanceof AssetMutationError) {
				this.applyValidationErrors(error.validationErrors);
			} else if (error instanceof Error && error.message.includes("409")) {
				this.handleVersionConflict();
			} else {
				this.fieldErrors = { "": error instanceof Error ? error.message : String(error) };
			}
		} finally {
			this.saving = false;
		}
	}

	private applyValidationErrors(errors: AssetValidationError[]): void {
		const map: Record<string, string> = {};
		for (const err of errors) {
			map[err.path] = err.message;
		}
		this.fieldErrors = map;
	}

	private handleSaveError(event: Event): void {
		if (this.conflict) return;
		const detail = (event as CustomEvent<{ errors: AssetValidationError[]; message?: string }>).detail;
		if (detail.errors?.length) this.applyValidationErrors(detail.errors);
		else if (detail.message) this.fieldErrors = { "": detail.message };
	}

	private handleVersionConflict(): void {
		this.conflict = true;
		this.modified = false;
		this.draft = clone(asRecord(this.content) ?? {});
		this.originalDigest = this.digest(this.draft);
		const catalog = readCatalog(this.draft);
		this.selectedEntityId = catalog.entities[0]?.entityId ?? null;
		if (window.confirm("版本冲突：当前资产已被他人修改。是否重新加载最新内容？")) {
			window.location.reload();
		}
	}

	private handleKeydown(event: KeyboardEvent): void {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
			event.preventDefault();
			void this.save();
		}
	}

	// ---------------------------------------------------------------------------
	// Rendering
	// ---------------------------------------------------------------------------

	static styles = [
		sharedStyles,
		css`
			:host {
				display: flex;
				flex-direction: column;
				height: 100%;
				min-height: 0;
				background: var(--bg);
				color: var(--text);
				font-family: var(--font-body);
				font-size: var(--text-base);
			}
			.toolbar {
				display: flex;
				align-items: center;
				gap: var(--gap, 12px);
				padding: var(--pad, 14px);
				border-bottom: 1px solid var(--border);
				background: var(--surface);
				flex: 0 0 auto;
			}
			.toolbar h1 {
				margin: 0;
				font-family: var(--font-display);
				font-size: var(--text-lg);
				font-weight: 600;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.toolbar .spacer { flex: 1; }
			.view-toggle {
				display: flex;
				gap: 0;
				border: 1px solid var(--border-strong);
				border-radius: var(--radius, 6px);
				overflow: hidden;
			}
			.view-toggle button {
				border: none;
				border-radius: 0;
				background: transparent;
			}
			.view-toggle button.active {
				background: var(--accent);
				color: var(--accent-fg);
				font-weight: 600;
			}
			.body {
				display: flex;
				flex: 1;
				min-height: 0;
				overflow: hidden;
			}
			.left {
				width: 280px;
				flex: 0 0 280px;
				border-right: 1px solid var(--border);
				background: var(--surface);
				overflow-y: auto;
				display: flex;
				flex-direction: column;
			}
			.right {
				flex: 1;
				min-width: 0;
				overflow-y: auto;
				padding: var(--pad, 14px);
			}
			.section {
				margin-bottom: var(--space-md, 1.5rem);
			}
			.section h3 {
				margin: 0 0 8px;
				font-size: var(--text-sm);
				color: var(--text-muted);
				text-transform: uppercase;
				letter-spacing: 0.06em;
			}
			.panel-head {
				display: flex;
				align-items: center;
				justify-content: space-between;
				padding: 10px 12px;
				border-bottom: 1px solid var(--border);
			}
			.panel-head input {
				flex: 1;
				min-width: 0;
				margin-right: 8px;
			}
			.entity-list {
				list-style: none;
				margin: 0;
				padding: 0;
			}
			.entity-list li {
				display: flex;
				align-items: center;
				justify-content: space-between;
				padding: 8px 12px;
				border-bottom: 1px solid var(--border);
				cursor: pointer;
				gap: 8px;
			}
			.entity-list li:hover { background: var(--surface-hover); }
			.entity-list li.selected { background: var(--accent-glow); color: var(--accent); }
			.entity-list li .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.entity-list li button { padding: 4px 8px; font-size: var(--text-xs); }
			.empty-state {
				padding: var(--pad, 14px);
				color: var(--text-muted);
				text-align: center;
			}
			table.fields { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
			table.fields th, table.fields td { padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
			table.fields th { color: var(--text-muted); font-weight: 600; text-align: left; }
			table.fields td input, table.fields td select { width: 100%; min-width: 0; padding: 4px 6px; font-size: var(--text-sm); }
			table.fields td input[type="checkbox"] { width: auto; }
			.compact { display: flex; flex-direction: column; gap: 8px; }
			.compact .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
			.compact .row label { color: var(--text-muted); font-size: var(--text-sm); min-width: 80px; }
			.compact .row input, .compact .row select { flex: 1; min-width: 120px; }
			.compact .row button { flex: 0 0 auto; }
			.tag-list { display: flex; flex-wrap: wrap; gap: 6px; }
			.tag { display: inline-flex; align-items: center; gap: 4px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius, 6px); padding: 2px 6px; font-size: var(--text-xs); }
			.tag button { padding: 0 4px; border: none; background: transparent; color: var(--text-muted); }
			.relation-row { display: grid; grid-template-columns: 1fr 1fr 120px 120px 120px 120px 80px; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); }
			.relation-row.header { color: var(--text-muted); font-weight: 600; font-size: var(--text-sm); }
			.relation-row select, .relation-row input { width: 100%; padding: 4px 6px; font-size: var(--text-sm); }
			.error-banner {
				background: var(--warn-soft);
				color: var(--danger);
				border: 1px solid var(--danger);
				border-radius: var(--radius, 6px);
				padding: 10px 12px;
				margin-bottom: var(--space-sm, 1rem);
				font-size: var(--text-sm);
			}
			.error-banner ul { margin: 6px 0 0; padding-left: 18px; }
			.conflict-banner {
				background: var(--warn-soft);
				color: var(--warn);
				border: 1px solid var(--warn);
				border-radius: var(--radius, 6px);
				padding: 10px 12px;
				margin-bottom: var(--space-sm, 1rem);
				font-size: var(--text-sm);
			}
			.notes { width: 100%; min-height: 80px; }
			.graph-host {
				flex: 1;
				min-height: 0;
				background: var(--surface);
				position: relative;
				overflow: hidden;
			}
			svg.graph {
				width: 100%;
				height: 100%;
				display: block;
				cursor: grab;
			}
			svg.graph:active { cursor: grabbing; }
			.node rect { fill: var(--surface-2); stroke: var(--border-strong); stroke-width: 1; }
			.node:hover rect { stroke: var(--accent); }
			.node text { fill: var(--text); font-size: 12px; pointer-events: none; }
			.node .entity-title { font-weight: 600; fill: var(--accent); font-size: 13px; }
			.edge { stroke: var(--text-muted); stroke-width: 1.5; fill: none; marker-end: url(#arrow); }
			.edge.highlight { stroke: var(--accent); }
			@media (max-width: 1023px) {
				.body { flex-direction: column; }
				.left { width: 100%; flex: 0 0 auto; max-height: 40vh; border-right: none; border-bottom: 1px solid var(--border); }
			}
		`,
	];

	protected render() {
		const catalog = readCatalog(this.draft);
		return html`
			<div class="toolbar">
				<h1>${this.title || "数据目录"}</h1>
				<div class="spacer"></div>
				<div class="view-toggle">
					<button class=${this.activeView === "structure" ? "active" : ""} @click=${() => { this.activeView = "structure"; }}>表结构</button>
					<button class=${this.activeView === "graph" ? "active" : ""} @click=${() => { this.activeView = "graph"; }}>关系图</button>
				</div>
				<button class="primary" ?disabled=${!this.modified || this.saving || this.conflict} @click=${() => void this.save()}>
					${this.saving ? "保存中…" : "保存"}
				</button>
			</div>
			${this.conflict ? html`<div class="conflict-banner">版本冲突：资产已被他人修改，本地修改已丢弃。请刷新页面重新加载最新内容。</div>` : nothing}
			${Object.keys(this.fieldErrors).length ? html`
				<div class="error-banner">
					<div>保存失败，请修正以下校验错误：</div>
					<ul>${Object.entries(this.fieldErrors).map(([path, msg]) => html`<li><code>${path || "(root)"}</code>：${msg}</li>`)}</ul>
				</div>
			` : nothing}
			<div class="body">
				${this.activeView === "structure" ? this.renderStructure(catalog) : this.renderGraph(catalog)}
			</div>
		`;
	}

	private renderStructure(catalog: Catalog) {
		const entities = catalog.entities.filter((e) => (e.name || "").toLowerCase().includes(this.entitySearch.toLowerCase()));
		return html`
			<aside class="left">
				<div class="panel-head">
					<input type="text" placeholder="搜索表…" .value=${this.entitySearch} @input=${(e: Event) => { this.entitySearch = (e.target as HTMLInputElement).value; }} />
					<button class="primary" @click=${() => this.addEntity()}>＋ 新建表</button>
				</div>
				<ul class="entity-list">
					${entities.length === 0 ? html`<li class="empty-state">暂无表</li>` : entities.map((entity) => html`
						<li class=${entity.entityId === this.selectedEntityId ? "selected" : ""} @click=${() => this.setSelectedEntity(entity.entityId)}>
							<span class="name">${entity.name || "(未命名)"}</span>
							<button class="danger" @click=${(e: Event) => { e.stopPropagation(); this.deleteEntity(entity.entityId); }}>删除</button>
						</li>
					`)}
				</ul>
			</aside>
			<main class="right">
				${this.renderEntityDetail(catalog)}
			</main>
		`;
	}

	private renderEntityDetail(catalog: Catalog) {
		const entity = this.selectedEntityId ? getEntityById(catalog, this.selectedEntityId) : undefined;
		if (!entity) {
			return html`<div class="empty-state">请从左侧选择一个表，或新建一个表。</div>`;
		}
		const fks = relationsForEntity(catalog, entity.entityId);
		const entityErrors = errorsForPath(this.fieldErrors, `/catalog/entities/${catalog.entities.indexOf(entity)}/`);
		return html`
			<div class="section">
				<h3>表信息</h3>
				<div class="compact">
					<div class="row">
						<label>表名</label>
						<input type="text" .value=${entity.name} @change=${(e: Event) => this.updateEntity(entity.entityId, { name: (e.target as HTMLInputElement).value })} />
					</div>
					<div class="row">
						<label>描述</label>
						<input type="text" .value=${entity.description ?? ""} @change=${(e: Event) => this.updateEntity(entity.entityId, { description: (e.target as HTMLInputElement).value })} />
					</div>
				</div>
			</div>
			${entityErrors["name"] ? html`<div class="error-banner">${entityErrors["name"]}</div>` : nothing}
			${this.renderFieldsSection(entity, catalog)}
			${this.renderPrimaryKeySection(entity)}
			${this.renderUniqueKeysSection(entity)}
			${this.renderIndexesSection(entity)}
			${this.renderForeignKeysSection(entity, catalog, fks)}
			${this.renderRelationsSection(catalog)}
			${this.renderNotesSection(catalog)}
		`;
	}

	private renderFieldsSection(entity: Entity, catalog: Catalog) {
		return html`
			<div class="section">
				<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
					<h3>字段</h3>
					<button @click=${() => this.addField(entity.entityId)}>＋ 添加字段</button>
				</div>
				<table class="fields">
					<thead>
						<tr>
							<th>名称</th>
							<th>逻辑类型</th>
							<th>方言类型</th>
							<th>可空</th>
							<th>默认值</th>
							<th>唯一</th>
							<th>枚举值</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						${entity.fields.map((field, idx) => html`
							<tr>
								<td><input type="text" .value=${field.name} @change=${(e: Event) => this.updateField(entity.entityId, field.fieldId, { name: (e.target as HTMLInputElement).value })} /></td>
								<td>
									<select .value=${field.logicalType} @change=${(e: Event) => this.updateField(entity.entityId, field.fieldId, { logicalType: (e.target as HTMLSelectElement).value as LogicalType })}>
										${LOGICAL_TYPES.map((t) => html`<option value=${t}>${t}</option>`)}
									</select>
								</td>
								<td><input type="text" .value=${field.dialectType ?? ""} @change=${(e: Event) => this.updateField(entity.entityId, field.fieldId, { dialectType: (e.target as HTMLInputElement).value })} /></td>
								<td style="text-align:center;"><input type="checkbox" ?checked=${field.nullable} @change=${(e: Event) => this.updateField(entity.entityId, field.fieldId, { nullable: (e.target as HTMLInputElement).checked })} /></td>
								<td><input type="text" .value=${formatDefaultValue(field.defaultValue)} @change=${(e: Event) => this.updateField(entity.entityId, field.fieldId, { defaultValue: parseDefaultValue((e.target as HTMLInputElement).value) })} /></td>
								<td style="text-align:center;"><input type="checkbox" ?checked=${field.unique} @change=${(e: Event) => this.updateField(entity.entityId, field.fieldId, { unique: (e.target as HTMLInputElement).checked })} /></td>
								<td><input type="text" placeholder="[\"a\",\"b\"]" .value=${formatEnumValues(field.enumValues)} @change=${(e: Event) => this.updateField(entity.entityId, field.fieldId, { enumValues: parseEnumValues((e.target as HTMLInputElement).value) })} /></td>
								<td><button class="danger" @click=${() => this.deleteField(entity.entityId, field.fieldId)}>删除</button></td>
							</tr>
							${Object.keys(errorsForPath(this.fieldErrors, `/catalog/entities/${catalog.entities.indexOf(entity)}/fields/${idx}/`)).length ? html`
								<tr><td colspan="8" style="border:none;padding-top:0;">
									<div class="error-banner">
										<ul>${Object.entries(errorsForPath(this.fieldErrors, `/catalog/entities/${catalog.entities.indexOf(entity)}/fields/${idx}/`)).map(([p, m]) => html`<li>${p}：${m}</li>`)}</ul>
									</div>
								</td></tr>
							` : nothing}
						`)}
					</tbody>
				</table>
			</div>
		`;
	}

	private renderPrimaryKeySection(entity: Entity) {
		const options = fieldOptions(entity);
		return html`
			<div class="section">
				<h3>主键</h3>
				<div class="tag-list">
					${options.length === 0 ? html`<span class="tag">无字段</span>` : options.map((opt) => html`
						<label class="tag">
							<input type="checkbox" ?checked=${entity.primaryKey.includes(opt.fieldId)} @change=${(e: Event) => {
								const checked = (e.target as HTMLInputElement).checked;
								const next = checked ? [...entity.primaryKey, opt.fieldId] : entity.primaryKey.filter((id) => id !== opt.fieldId);
								this.setPrimaryKey(entity.entityId, next);
							}} />
							${opt.name}
						</label>
					`)}
				</div>
			</div>
		`;
	}

	private renderUniqueKeysSection(entity: Entity) {
		const options = fieldOptions(entity);
		return html`
			<div class="section">
				<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
					<h3>唯一键</h3>
					<button @click=${() => this.addUniqueKey(entity.entityId)}>＋ 添加</button>
				</div>
				${(entity.uniqueKeys ?? []).length === 0 ? html`<div class="empty-state">暂无唯一键</div>` : (entity.uniqueKeys ?? []).map((group, idx) => html`
					<div class="row" style="margin-bottom:6px;">
						<select multiple .value=${group} @change=${(e: Event) => {
							const selected = Array.from((e.target as HTMLSelectElement).selectedOptions).map((o) => o.value);
							this.updateUniqueKey(entity.entityId, idx, selected);
						}} style="min-width:200px;min-height:80px;">
							${options.map((opt) => html`<option value=${opt.fieldId} ?selected=${group.includes(opt.fieldId)}>${opt.name}</option>`)}
						</select>
						<button class="danger" @click=${() => this.deleteUniqueKey(entity.entityId, idx)}>删除</button>
					</div>
				`)}
			</div>
		`;
	}

	private renderIndexesSection(entity: Entity) {
		const options = fieldOptions(entity);
		return html`
			<div class="section">
				<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
					<h3>索引</h3>
					<button @click=${() => this.addIndex(entity.entityId)}>＋ 添加</button>
				</div>
				${(entity.indexes ?? []).length === 0 ? html`<div class="empty-state">暂无索引</div>` : (entity.indexes ?? []).map((idx, i) => html`
					<div class="compact" style="border:1px solid var(--border);border-radius:var(--radius);padding:8px;margin-bottom:8px;">
						<div class="row">
							<label>索引名</label>
							<input type="text" .value=${idx.name} @change=${(e: Event) => this.updateIndex(entity.entityId, i, { name: (e.target as HTMLInputElement).value })} />
						</div>
						<div class="row">
							<label>字段</label>
							<select multiple .value=${idx.fieldIds} @change=${(e: Event) => {
								const selected = Array.from((e.target as HTMLSelectElement).selectedOptions).map((o) => o.value);
								this.updateIndex(entity.entityId, i, { fieldIds: selected });
							}} style="min-height:80px;">
								${options.map((opt) => html`<option value=${opt.fieldId} ?selected=${idx.fieldIds.includes(opt.fieldId)}>${opt.name}</option>`)}
							</select>
						</div>
						<div class="row">
							<label>唯一</label>
							<input type="checkbox" ?checked=${idx.unique} @change=${(e: Event) => this.updateIndex(entity.entityId, i, { unique: (e.target as HTMLInputElement).checked })} />
							<button class="danger" @click=${() => this.deleteIndex(entity.entityId, i)}>删除</button>
						</div>
					</div>
				`)}
			</div>
		`;
	}

	private renderForeignKeysSection(entity: Entity, catalog: Catalog, fks: Relation[]) {
		return html`
			<div class="section">
				<h3>外键关联</h3>
				${fks.length === 0 ? html`<div class="empty-state">暂无外键关联</div>` : html`
					<table class="fields">
						<thead><tr><th>名称</th><th>来源字段</th><th>目标表</th><th>目标字段</th><th>基数</th></tr></thead>
						<tbody>
							${fks.map((rel) => {
								const fromEntity = getEntityById(catalog, rel.fromEntityId);
								const toEntity = getEntityById(catalog, rel.toEntityId);
								const fromNames = rel.fromFieldIds.map((id) => fieldNameMap(fromEntity!).get(id) || id).join(", ");
								const toNames = rel.toFieldIds.map((id) => fieldNameMap(toEntity!).get(id) || id).join(", ");
								return html`
									<tr>
										<td>${rel.name}</td>
										<td>${rel.fromEntityId === entity.entityId ? fromNames : html`<a href="#" @click=${(e: Event) => { e.preventDefault(); fromEntity && this.setSelectedEntity(fromEntity.entityId); }}>${fromNames}</a>`}</td>
										<td><a href="#" @click=${(e: Event) => { e.preventDefault(); toEntity && this.setSelectedEntity(toEntity.entityId); }}>${toEntity?.name ?? "(缺失)"}</a></td>
										<td>${toNames}</td>
										<td>${rel.cardinality}</td>
									</tr>
								`;
								})}
							</tbody>
						</table>
					`}
				</div>
			`;
	}

	private renderRelationsSection(catalog: Catalog) {
		const options = entityOptions(catalog);
		return html`
			<div class="section">
				<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
					<h3>关系定义</h3>
					<button @click=${() => this.addRelation()}>＋ 添加关系</button>
				</div>
				${catalog.relations.length === 0 ? html`<div class="empty-state">暂无关系</div>` : html`
					<div class="relation-row header">
						<span>名称</span>
						<span>来源表 / 字段</span>
						<span>目标表 / 字段</span>
						<span>基数</span>
						<span>删除</span>
						<span>更新</span>
						<span></span>
					</div>
					${catalog.relations.map((rel, idx) => {
						const fromEntity = getEntityById(catalog, rel.fromEntityId);
						const toEntity = getEntityById(catalog, rel.toEntityId);
						const fromOptions = fromEntity ? fieldOptions(fromEntity) : [];
						const toOptions = toEntity ? fieldOptions(toEntity) : [];
						return html`
							<div class="relation-row">
								<input type="text" .value=${rel.name} @change=${(e: Event) => this.updateRelation(idx, { name: (e.target as HTMLInputElement).value })} />
								<div style="display:flex;flex-direction:column;gap:4px;">
									<select .value=${rel.fromEntityId} @change=${(e: Event) => {
										const entityId = (e.target as HTMLSelectElement).value;
										this.updateRelation(idx, { fromEntityId: entityId, fromFieldIds: [] });
									}}>
										${options.map((opt) => html`<option value=${opt.entityId} ?selected=${opt.entityId === rel.fromEntityId}>${opt.name}</option>`)}
									</select>
									<select multiple .value=${rel.fromFieldIds} @change=${(e: Event) => {
										const selected = Array.from((e.target as HTMLSelectElement).selectedOptions).map((o) => o.value);
										this.updateRelation(idx, { fromFieldIds: selected });
									}} style="min-height:60px;">
										${fromOptions.map((opt) => html`<option value=${opt.fieldId} ?selected=${rel.fromFieldIds.includes(opt.fieldId)}>${opt.name}</option>`)}
									</select>
								</div>
								<div style="display:flex;flex-direction:column;gap:4px;">
									<select .value=${rel.toEntityId} @change=${(e: Event) => {
										const entityId = (e.target as HTMLSelectElement).value;
										this.updateRelation(idx, { toEntityId: entityId, toFieldIds: [] });
									}}>
										${options.map((opt) => html`<option value=${opt.entityId} ?selected=${opt.entityId === rel.toEntityId}>${opt.name}</option>`)}
									</select>
									<select multiple .value=${rel.toFieldIds} @change=${(e: Event) => {
										const selected = Array.from((e.target as HTMLSelectElement).selectedOptions).map((o) => o.value);
										this.updateRelation(idx, { toFieldIds: selected });
									}} style="min-height:60px;">
										${toOptions.map((opt) => html`<option value=${opt.fieldId} ?selected=${rel.toFieldIds.includes(opt.fieldId)}>${opt.name}</option>`)}
									</select>
								</div>
								<select .value=${rel.cardinality} @change=${(e: Event) => this.updateRelation(idx, { cardinality: (e.target as HTMLSelectElement).value as Cardinality })}>
									${CARDINALITIES.map((c) => html`<option value=${c}>${c}</option>`)}
								</select>
								<select .value=${rel.onDelete ?? ""} @change=${(e: Event) => this.updateRelation(idx, { onDelete: (e.target as HTMLSelectElement).value as OnDelete })}>
									${ON_DELETE_VALUES.map((v) => html`<option value=${v}>${v}</option>`)}
								</select>
								<select .value=${rel.onUpdate ?? ""} @change=${(e: Event) => this.updateRelation(idx, { onUpdate: (e.target as HTMLSelectElement).value })}>
									${ON_DELETE_VALUES.map((v) => html`<option value=${v}>${v}</option>`)}
								</select>
								<button class="danger" @click=${() => this.deleteRelation(idx)}>删除</button>
							</div>
						`;
					})}
				`}
			</div>
		`;
	}

	private renderNotesSection(catalog: Catalog) {
		return html`
			<div class="section">
				<h3>备注</h3>
				<textarea class="notes" .value=${catalog.notes ?? ""} @change=${(e: Event) => this.setNotes((e.target as HTMLTextAreaElement).value)}></textarea>
			</div>
		`;
	}

	private renderGraph(catalog: Catalog) {
		const nodeWidth = 180;
		const nodeHeight = 80;
		const colCount = Math.max(1, Math.ceil(Math.sqrt(catalog.entities.length)));
		const nodes = catalog.entities.map((entity, i) => ({
			entity,
			x: (i % colCount) * (nodeWidth + 60) + 40,
			y: Math.floor(i / colCount) * (nodeHeight + 80) + 40,
			w: nodeWidth,
			h: nodeHeight,
		}));
		const nodeMap = new Map(nodes.map((n) => [n.entity.entityId, n]));
		const transform = `translate(${this.graphOffset.x}, ${this.graphOffset.y}) scale(${this.graphZoom})`;
		return html`
			<div class="graph-host" ${ref(this.graphHostRef)}>
				<svg class="graph" @wheel=${this.handleGraphWheel} @mousedown=${this.handleGraphMouseDown} @mousemove=${this.handleGraphMouseMove} @mouseup=${this.handleGraphMouseUp} @mouseleave=${this.handleGraphMouseUp}>
					<defs>
						<marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
							<path d="M0,0 L0,6 L9,3 z" fill="var(--text-muted)" />
						</marker>
					</defs>
					<g transform=${transform}>
						${catalog.relations.map((rel) => {
							const from = nodeMap.get(rel.fromEntityId);
							const to = nodeMap.get(rel.toEntityId);
							if (!from || !to) return nothing;
							const x1 = from.x + from.w / 2;
							const y1 = from.y + from.h / 2;
							const x2 = to.x + to.w / 2;
							const y2 = to.y + to.h / 2;
							const cx1 = x1 + (x2 - x1) * 0.5;
							const cy1 = y1;
							const cx2 = x1 + (x2 - x1) * 0.5;
							const cy2 = y2;
							return html`<path class="edge" d="M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}" />`;
						})}
						${nodes.map((n) => html`
							<g class="node" transform="translate(${n.x}, ${n.y})" @click=${(e: Event) => { e.stopPropagation(); this.setSelectedEntity(n.entity.entityId); }} style="cursor:pointer;">
								<rect width=${n.w} height=${n.h} rx="6" />
								<text x="10" y="22" class="entity-title">${n.entity.name || "(未命名)"}</text>
								<text x="10" y="44">${n.entity.fields.length} 字段</text>
								<text x="10" y="62" fill="var(--text-muted)">${relationsForEntity(catalog, n.entity.entityId).length} 关系</text>
							</g>
						`)}
					</g>
				</svg>
			</div>
		`;
	}

	private handleGraphWheel = (event: WheelEvent): void => {
		event.preventDefault();
		const delta = event.deltaY > 0 ? 0.9 : 1.1;
		this.graphZoom = Math.min(Math.max(0.2, this.graphZoom * delta), 3);
	};

	private handleGraphMouseDown = (event: MouseEvent): void => {
		if ((event.target as HTMLElement).tagName === "svg") {
			this.graphDragging = true;
			this.graphDragStart = { x: event.clientX, y: event.clientY };
			this.graphDragLast = { x: event.clientX, y: event.clientY };
		}
	};

	private handleGraphMouseMove = (event: MouseEvent): void => {
		if (!this.graphDragging || !this.graphDragLast) return;
		const dx = event.clientX - this.graphDragLast.x;
		const dy = event.clientY - this.graphDragLast.y;
		this.graphOffset = { x: this.graphOffset.x + dx, y: this.graphOffset.y + dy };
		this.graphDragLast = { x: event.clientX, y: event.clientY };
	};

	private handleGraphMouseUp = (): void => {
		this.graphDragging = false;
		this.graphDragStart = null;
		this.graphDragLast = null;
	};
}

customElements.define("baize-data-catalog", BaizeDataCatalog);
