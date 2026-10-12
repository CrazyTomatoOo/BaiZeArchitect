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
import { computeCoverage, parseClueRef, unrealizedUsecases } from "./coverage.ts";
import { fieldDefectsOf } from "./fieldcheck.ts";
import type { Catalogs } from "./catalogs.ts";
import { readCatalogs } from "./catalogs.ts";
import { isPlainObject } from "./guards.ts";
import { readEntries } from "./store.ts";
import { staleIssues } from "./stale.ts";
import type { Issue } from "./types.ts";

function fieldIssues(entry: Entry): Issue[] {
  const issues: Issue[] = [];
  for (const defect of fieldDefectsOf(entry)) {
    if (defect.problem === "absent") {
      issues.push({
        level: "ERROR",
        rule: "field.absent",
        path: entry.path,
        message: `缺少必填字段：${defect.name}`,
        fix: `在 ${entry.path} 的 frontmatter 中补上 ${defect.name}`,
      });
      continue;
    }
    const field = entry.layer.fields.find((spec) => spec.name === defect.name);
    issues.push({
      level: "ERROR",
      rule: "field.empty",
      path: entry.path,
      message: field?.emptyMessage ?? `字段为空：${defect.name}`,
      fix: `补上 ${defect.name} 的内容（空数组/空对象只用于「看过了确实没有」）`,
    });
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

function refIssues(entry: Entry, byId: Record<string, Entry>, catalogs: Catalogs): Issue[] {
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

  const issues = [
    ...scoped.flatMap((entry) => issuesFor(entry, byId, catalogs)),
    ...(await stageIssues(cwd, options.chain)),
    ...coverageIssues(scoped),
    ...unrealizedUsecaseIssues(scoped, entries),
    // #155 陈旧：上下游关系现算不落盘；WARNING 直接下游 / INFO 传递（见 stale.ts 注释）。
    ...staleIssues(scoped),
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
 * （功能侧必须有人承载这条用例）。未覆盖清单与 status 的功能拆分门禁共用
 * coverage.ts 的 unrealizedUsecases（同一份数据，不各算一套）。
 */
function unrealizedUsecaseIssues(scoped: Entry[], all: Entry[]): Issue[] {
  return unrealizedUsecases(scoped, all).map((usecase) => ({
    level: "ERROR" as const,
    rule: "coverage.unrealized-usecase",
    path: usecase.path,
    message: `用例 ${usecase.id} 未被任何功能项 realizes（功能侧没有承载它的实现）`,
    fix: `在某条 function-item 的 realizes 里加上 ${usecase.id}，或确认该用例应废弃`,
  }));
}
