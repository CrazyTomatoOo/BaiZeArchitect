import type { Entry } from "./entry.ts";
import { idOf, parentIdOf } from "./entry.ts";
import { BaizeError } from "./errors.ts";
import { chainMembers } from "./chain.ts";
import type { Catalogs } from "./catalogs.ts";
import { readCatalogs } from "./catalogs.ts";
import { isPlainObject } from "./guards.ts";
import type { FieldKind } from "./layers.ts";
import { readEntries } from "./store.ts";
import type { Issue } from "./types.ts";

/**
 * 空判定按字段种类走。
 * - `string`：空/纯空白
 * - `array` / `map`：**任何空容器**（`[]` 与 `{}` 都可能是「没写」）
 * - `scalar`：`null`
 * 其它类型不符（例：集合字段给了非空标量）视为「已填」，本票不引入类型类 rule。
 */
function isEmptyValue(kind: FieldKind, value: unknown): boolean {
  if (kind === "string") return typeof value === "string" && value.trim() === "";
  if (kind === "scalar") return value === null;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

function fieldIssues(entry: Entry): Issue[] {
  const issues: Issue[] = [];
  for (const field of entry.layer.fields) {
    const present =
      field.source === "body" || Object.hasOwn(entry.frontmatter, field.name);
    if (!present) {
      issues.push({
        level: "ERROR",
        rule: "field.absent",
        path: entry.path,
        message: `缺少必填字段：${field.name}`,
        fix: `在 ${entry.path} 的 frontmatter 中补上 ${field.name}`,
      });
      continue;
    }
    if (!field.nonEmpty) continue;
    const value =
      field.source === "body" ? entry.body : entry.frontmatter[field.name];
    if (isEmptyValue(field.kind, value)) {
      issues.push({
        level: "ERROR",
        rule: "field.empty",
        path: entry.path,
        message: field.emptyMessage,
        fix: `补上 ${field.name} 的内容（空数组/空对象只用于「看过了确实没有」）`,
      });
    }
  }
  return issues;
}

function idIssue(entry: Entry): Issue[] {
  if (!Object.hasOwn(entry.frontmatter, "id")) return []; // 缺交由 field.absent 报
  const raw = entry.frontmatter["id"];
  if (typeof raw === "string" && raw.trim() === "") return []; // 空交由 field.empty 报

  const expected = `${entry.layer.prefix}-<三位数字>`;
  const pattern = new RegExp(`^${entry.layer.prefix}-\\d{3}$`);
  if (typeof raw === "string" && pattern.test(raw)) return [];

  // 类型不符（如 `id: 42`）也在此报——否则它会绕过 field.empty（非字符串不判空）静默通过。
  const shown = typeof raw === "string" ? raw : (JSON.stringify(raw) ?? String(raw));
  return [
    {
      level: "ERROR",
      rule: "id.invalid",
      path: entry.path,
      message: `id 不合法：「${shown}」应为 ${expected}（如 ${entry.layer.prefix}-001）`,
      fix: `把 id 改为 ${expected} 形式的顺序编号`,
    },
  ];
}

/** 解析 covers 项 `<条目id>#<线索id>`；不是这个形状返回 null。 */
function parseClueRef(item: unknown): { entryId: string; clueId: string } | null {
  if (typeof item !== "string") return null;
  const hash = item.indexOf("#");
  if (hash <= 0 || hash === item.length - 1) return null;
  return { entryId: item.slice(0, hash), clueId: item.slice(hash + 1) };
}

function refIssues(entry: Entry, byId: Record<string, Entry>, catalogs: Catalogs): Issue[] {
  const issues: Issue[] = [];
  const parentId = parentIdOf(entry);

  // ref.orphan：SR / AR / 场景必须有父（null / 缺失 / 空都算）。IR 的 parent: null 是链顶端，合法。
  if (
    (entry.layer.key === "sr" || entry.layer.key === "ar" || entry.layer.key === "scenarios") &&
    parentId === undefined
  ) {
    issues.push({
      level: "ERROR",
      rule: "ref.orphan",
      path: entry.path,
      message: `${entry.layer.prefix} 缺少父条目：parent 为空或缺失（必由上层条目分解而来）`,
      fix: `给 ${entry.path} 的 frontmatter 补上 parent（上层条目 id）`,
    });
  }

  // ref.parent-missing：parent 指向的条目必须存在。
  if (parentId !== undefined && !Object.hasOwn(byId, parentId)) {
    issues.push({
      level: "ERROR",
      rule: "ref.parent-missing",
      path: entry.path,
      message: `parent 指向不存在的条目：${parentId}`,
      fix: `把 ${entry.path} 的 parent 改成存在的条目 id（或先建出 ${parentId}）`,
    });
  }

  // ref.unknown-clue：covers 指向的验收线索必须存在（父条目存在，且其 acceptance 里有该线索）。
  const covers = entry.frontmatter["covers"];
  if (Array.isArray(covers)) {
    for (const item of covers) {
      const ref = parseClueRef(item);
      const parent = ref === null ? undefined : byId[ref.entryId];
      const known =
        ref !== null &&
        parent !== undefined &&
        isPlainObject(parent.frontmatter["acceptance"]) &&
        Object.hasOwn(parent.frontmatter["acceptance"] as object, ref.clueId);
      if (known) continue;
      const shown = typeof item === "string" ? item : (JSON.stringify(item) ?? String(item));
      const why =
        ref === null
          ? "不是 <条目id>#<线索id> 形式"
          : parent === undefined
            ? `条目 ${ref.entryId} 不存在`
            : `条目 ${ref.entryId} 的 acceptance 里没有线索 ${ref.clueId}`;
      issues.push({
        level: "ERROR",
        rule: "ref.unknown-clue",
        path: entry.path,
        message: `covers 引用了不存在的验收线索：${shown}（${why}）`,
        fix: "核对线索 id（父条目的 acceptance 键），或先在父条目补上该线索",
      });
    }
  }

  // ref.unknown-element：AR 的 allocates 指向受控清单 baize/architecture.yaml 里的组件 slug；
  // 清单缺失 = 空清单，引用任何 slug 都报本条。空/缺失的 allocates 由 field.* 报，这里不重复。
  if (entry.layer.key === "ar") {
    const allocates = entry.frontmatter["allocates"];
    if (typeof allocates === "string" && allocates.trim() !== "" && !catalogs.components.has(allocates)) {
      issues.push({
        level: "ERROR",
        rule: "ref.unknown-element",
        path: entry.path,
        message: `allocates 指向清单里不存在的组件：${allocates}（受控清单 baize/architecture.yaml）`,
        fix: "核对组件 slug，或先在受控清单里登记该组件",
      });
    }
  }

  // ref.unknown-catalog：场景的 catalog 必须是受控清单 baize/scenario-catalogs.yaml 里的目录 slug。
  if (entry.layer.key === "scenarios") {
    const catalog = entry.frontmatter["catalog"];
    if (typeof catalog === "string" && catalog.trim() !== "" && !catalogs.scenarioCatalogs.has(catalog)) {
      issues.push({
        level: "ERROR",
        rule: "ref.unknown-catalog",
        path: entry.path,
        message: `catalog 不在场景目录词表里：${catalog}（受控清单 baize/scenario-catalogs.yaml）`,
        fix: "核对目录 slug，或先在受控清单里登记该目录",
      });
    }
  }

  return issues;
}

// sr.unallocated：SR 没有 AR 挂上（没有 AR 以它为 parent）→ WARNING。
// 反向关系现算，不落盘。
function allocationIssues(entry: Entry, byId: Record<string, Entry>): Issue[] {
  if (entry.layer.key !== "sr") return [];
  const id = idOf(entry);
  if (id === undefined) return []; // 缺 id 由 id.* / field.* 报
  const hasAr = Object.values(byId).some(
    (candidate) => candidate.layer.key === "ar" && parentIdOf(candidate) === id,
  );
  if (hasAr) return [];
  return [
    {
      level: "WARNING",
      rule: "sr.unallocated",
      path: entry.path,
      message: `SR 没有任何 AR 承接：${id}（需求拆到 AR 才算落到了架构组件上）`,
      fix: `为 ${id} 建一条 parent 指向它的 AR，或在 AR 的 allocates 里挂好组件`,
    },
  ];
}

function issuesFor(entry: Entry, byId: Record<string, Entry>, catalogs: Catalogs): Issue[] {
  return [
    ...idIssue(entry),
    ...fieldIssues(entry),
    ...refIssues(entry, byId, catalogs),
    ...allocationIssues(entry, byId),
  ];
}

/** 全仓（或限定一条链）跑 field / id / ref 规则，返回按 path、rule 排序的问题。 */
export async function validate(
  cwd: string,
  options: { chain?: string } = {},
): Promise<Issue[]> {
  const entries = await readEntries(cwd);
  const catalogs = await readCatalogs(cwd);
  const byId: Record<string, Entry> = {};
  for (const entry of entries) {
    const id = idOf(entry);
    if (id !== undefined && !Object.hasOwn(byId, id)) byId[id] = entry;
  }

  let scoped = entries;
  if (options.chain !== undefined) {
    if (!Object.hasOwn(byId, options.chain)) {
      throw new BaizeError("chain.not-found", `链不存在：${options.chain}`);
    }
    scoped = chainMembers(entries, options.chain);
  }

  const issues = scoped.flatMap((entry) => issuesFor(entry, byId, catalogs));
  issues.sort((a, b) =>
    a.path === b.path
      ? a.rule.localeCompare(b.rule)
      : a.path.localeCompare(b.path),
  );
  return issues;
}
