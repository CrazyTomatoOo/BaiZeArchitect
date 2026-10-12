import type { Entry } from "./entry.ts";
import { idOf, parentIdOf } from "./entry.ts";
import { BaizeError } from "./errors.ts";
import { chainMembers } from "./chain.ts";
import {
  chainIdsWithState,
  chainStateRelPath,
  flattenSkipped,
  missingSkipFields,
  readChainState,
} from "./chainstate.ts";
import { computeCoverage, parseClueRef } from "./coverage.ts";
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

function refIssues(entry: Entry, byId: Record<string, Entry>): Issue[] {
  const issues: Issue[] = [];
  const parentId = parentIdOf(entry);

  // ref.orphan：除 IR（链顶端，parent 恒为 null）外，各层必须有父。null / 缺失 / 空都算。
  if (entry.layer.key !== "ir" && parentId === undefined) {
    issues.push({
      level: "ERROR",
      rule: "ref.orphan",
      path: entry.path,
      message: `${entry.layer.prefix} 缺少父条目：parent 为空或缺失（各层必由上层条目分解而来）`,
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

  // ref.unknown-target：多对多关联边（用例 appearsIn → 场景、功能项 realizes → 用例）
  // 指向的条目必须存在。
  const edgeFields: Array<{ name: string; target: string }> = [];
  if (entry.layer.key === "usecases") {
    edgeFields.push({ name: "appearsIn", target: "场景" });
  }
  if (entry.layer.key === "function-items") {
    edgeFields.push({ name: "realizes", target: "用例" });
  }
  for (const edge of edgeFields) {
    const items = entry.frontmatter[edge.name];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (typeof item === "string" && Object.hasOwn(byId, item)) continue;
      const shown = typeof item === "string" ? item : (JSON.stringify(item) ?? String(item));
      issues.push({
        level: "ERROR",
        rule: "ref.unknown-target",
        path: entry.path,
        message: `${edge.name} 指向不存在的${edge.target}条目：${shown}`,
        fix: `核对 ${edge.name} 里的条目 id（或先建出 ${shown}）`,
      });
    }
  }

  return issues;
}

function issuesFor(entry: Entry, byId: Record<string, Entry>): Issue[] {
  return [...idIssue(entry), ...fieldIssues(entry), ...refIssues(entry, byId)];
}

/**
 * 阶段状态文件的规则：跳段是全模型里代价最高的决定之一，
 * skipped 的任一段缺 by / at / why 都报 stage.skip-missing-reason（ERROR）。
 * 状态文件缺失不是错误（等价于无跳过）。
 */
async function stageIssues(cwd: string, chain: string | undefined): Promise<Issue[]> {
  const ids = chain !== undefined ? [chain] : await chainIdsWithState(cwd);
  const issues: Issue[] = [];
  for (const id of ids) {
    const state = await readChainState(cwd, id);
    if (state === undefined) continue;
    for (const { stagePath, value } of flattenSkipped(state.skipped)) {
      const missing = missingSkipFields(value);
      if (missing.length === 0) continue;
      issues.push({
        level: "ERROR",
        rule: "stage.skip-missing-reason",
        path: chainStateRelPath(id),
        message: `跳过记录不完整：${stagePath} 缺 ${missing.join(" / ")}（跳段必须留下 by + at + why）`,
        fix: `补齐 ${stagePath} 的 ${missing.join(" / ")}`,
      });
    }
  }
  return issues;
}

/** coverage.missing-clue：IR 的每条验收线索都要至少一个 SR 的 covers 指向它。
 * 覆盖率数据与 status 共用 src/coverage.ts（不各算一套）。 */
function coverageIssues(scoped: Entry[]): Issue[] {
  return computeCoverage(scoped).flatMap((coverage) =>
    coverage.missing.map((clue) => ({
      level: "ERROR" as const,
      rule: "coverage.missing-clue",
      path: coverage.path,
      message: `验收线索未覆盖：${coverage.id}#${clue.clueId}「${clue.text}」没有任何 SR 的 covers 指向它`,
      fix: `新建或修改 SR，把 ${coverage.id}#${clue.clueId} 写进其 covers；若线索已废弃，从 ${coverage.path} 的 acceptance 删掉它`,
    })),
  );
}

/** 全仓（或限定一条链）跑 field / id / ref / coverage / stage 规则，返回按 path、rule 排序的问题。 */
export async function validate(
  cwd: string,
  options: { chain?: string } = {},
): Promise<Issue[]> {
  const entries = await readEntries(cwd);
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

  const issues = [
    ...scoped.flatMap((entry) => issuesFor(entry, byId)),
    ...(await stageIssues(cwd, options.chain)),
    ...coverageIssues(scoped),
    ...unrealizedUsecaseIssues(scoped, entries),
  ];
  issues.sort((a, b) =>
    a.path === b.path
      ? a.rule.localeCompare(b.rule)
      : a.path.localeCompare(b.path),
  );
  return issues;
}

/**
 * coverage.unrealized-usecase：每条用例至少要被一个功能项的 realizes 指向
 * （功能侧必须有人承载这条用例）。realizes 集合取全仓（跨链引用也合法），
 * 报告范围按 --chain 作用域限定。
 */
function unrealizedUsecaseIssues(scoped: Entry[], all: Entry[]): Issue[] {
  const realized = new Set<string>();
  for (const entry of all) {
    if (entry.layer.key !== "function-items") continue;
    const items = entry.frontmatter["realizes"];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (typeof item === "string") realized.add(item);
    }
  }

  const issues: Issue[] = [];
  for (const entry of scoped) {
    if (entry.layer.key !== "usecases") continue;
    const id = idOf(entry);
    if (id === undefined || realized.has(id)) continue;
    issues.push({
      level: "ERROR",
      rule: "coverage.unrealized-usecase",
      path: entry.path,
      message: `用例 ${id} 未被任何功能项 realizes（功能侧没有承载它的实现）`,
      fix: `在某条 function-item 的 realizes 里加上 ${id}，或确认该用例应废弃`,
    });
  }
  return issues;
}
