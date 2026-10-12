import type { Entry } from "./entry.ts";
import { idOf, parentIdOf } from "./entry.ts";
import { BaizeError } from "./errors.ts";
import { chainMembers } from "./chain.ts";
import { confirmationOf, type ConfirmationView } from "./confirm.ts";
import {
  gateRecordOf,
  STAGES,
  functionSkipOf,
  readChainState,
  skipRecordOf,
  type ChainState,
  type SkipRecord,
} from "./chainstate.ts";
import { computeCoverage, parseClueRef, unrealizedUsecases, type EntryCoverage } from "./coverage.ts";
import { fieldDefectsOf } from "./fieldcheck.ts";
import { isPlainObject } from "./guards.ts";
import { readEntries } from "./store.ts";
import { directStaleViews, staleFindings, type DirectStaleView } from "./stale.ts";

/** 门禁判据原文（#139/#141）：criterion 原样输出，签字人对照它签；改文案 = 改判据。 */
export const IR_ENTRY_CRITERION = "父 IR 的 statement 与 acceptance 已人工确认";
export const SR_AR_CRITERION = "每条 SR 已 allocates";
export const FUNCTION_SPLIT_CRITERION =
  "这套功能拆分足以支撑实现；未覆盖的用例与未复核的陈旧已处置。";

export interface ChainSummary {
  id: string;
  layer: string;
  title: string;
  path: string;
  /** 链内条目数（进度的一种量度；段的完成与否不看跳过记录之外的状态）。 */
  items: number;
  /** 链内全部 IR 的线索覆盖汇总（与 validate 的 coverage.missing-clue 同一份数据）。 */
  coverage: { covered: number; total: number };
  /** 陈旧两档计数：直接下游待复核 / 另有 N 条传递受影响。 */
  stale: { direct: number; transitive: number };
}
export interface ChainItem {
  id: string;
  layer: string;
  title: string;
  path: string;
  parent: string | null;
}
/**
 * 一段链路的现算视图：有 skipped 记录 = 已跳过，没有 = 未跳过。
 * 没有「未开始 / 进行中 / 已完成」状态枚举（进度归 status 现算，不落盘）。
 */
export interface StageView {
  stage: string;
  skipped: SkipRecord | null;
  /** 仅「功能拆分」段：两个子层级（items / points）各自的跳过记录。 */
  subStages?: { items: SkipRecord | null; points: SkipRecord | null };
}
/** 链的陈旧汇总（#155）：直接下游待复核 + 另有 N 条下游受传递影响。 */
export interface ChainStaleView {
  /** 直接下游陈旧的条目 id（升序）。 */
  direct: string[];
  /** 另有 N 条下游受传递影响（陈旧条目的严格后代，自身不重复计）。 */
  transitive: number;
}
/** 一处门禁的现算视图（#156）。两种形态靠 `kind` 区分：auto 由事实算出，signed 必须去找人。 */
export interface GateView {
  /** `ir-entry` IR 录入 / `sr-ar` SR→AR 分配 / `function-split` 功能拆分。 */
  gate: "ir-entry" | "sr-ar" | "function-split";
  kind: "auto" | "signed";
  /** 阻塞型门禁挡推进；sr-ar 是提醒（false），不阻止。 */
  blocking: boolean;
  state: "pending" | "passed";
  /** 判据原文——签字人要对着它签，必须能原样取出。 */
  criterion: string;
  /** signed 门禁的签字人 / 时间（auto 门禁恒为 null）；只读链状态文件的 gates，不落盘。 */
  by: string | null;
  at: string | null;
  /** 仅 function-split：三项自动挡结果（判据里可算的部分）。 */
  checks?: { check: string; passed: boolean }[];
  /** 仅 function-split：签字时要对着看的两张待处置清单（未覆盖的用例 / 未复核的陈旧）。 */
  pending?: {
    unrealizedUsecases: { id: string; path: string }[];
    unreviewedStale: { id: string; path: string; upstreams: string[] }[];
  };
  /** 仅 function-split：签字记录里存的判据（无有效签字为 null）。
   * 判据文案改了，旧签字不再算数——`criterion`（当前判据）与它都要能取到，供对照。 */
  signedCriterion?: string | null;
  /** 仅 function-split：state 为 pending 时缺的是哪几样（签字 / 判据一致 / 三项自动挡）。 */
  missing?: string[];
}
export interface ChainDetail {
  id: string;
  items: ChainItem[];
  stages: StageView[];
  /** 链内每条 IR 的线索覆盖率（与 validate 的 coverage.missing-clue 同一份数据）。 */
  coverage: EntryCoverage[];
  stale: ChainStaleView;
  /** 三处门禁（#156）：两处 auto、一处 signed，criterion 原样可取。 */
  gates: GateView[];
}
/** 一条 IR 线索的反向覆盖：被哪几条 SR 的 covers 指向（关系只存单向，反向现算）。 */
export interface ItemClueCoverage {
  clueId: string;
  text: string;
  covered: boolean;
  coveredBy: string[];
}
/** 用例沿 appearsIn 反向追到的一个场景目录来源（一条用例可属多个目录）。 */
export interface ItemCatalogSource {
  scenario: string;
  catalog: string;
}
export interface ItemView {
  id: string;
  layer: string;
  title: string;
  path: string;
  parent: string | null;
  statement: string;
  acceptance: Record<string, string>;
  /** 确认状态（#151）：失效靠现算指纹，IR 录入门禁由它推出（未确认 → pending）。 */
  confirmation: ConfirmationView;
  /** 所属链：沿 parent 边走到根的条目 id（反向信息，磁盘上不存在）。 */
  chain: string | null;
  /** 仅 IR：线索级反向覆盖（被哪几条 SR 覆盖）。 */
  clueCoverage?: ItemClueCoverage[];
  /** 仅用例：继承自哪些场景目录（沿 appearsIn 取场景的 catalog，可能多个）。 */
  catalogs?: ItemCatalogSource[];
  /** 仅用例：哪些功能项 realizes 了它。 */
  realizedBy?: string[];
}

function titleOf(entry: Entry): string {
  const value = entry.frontmatter["title"];
  return typeof value === "string" ? value : "";
}

function stringMapOf(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isPlainObject(value)) return result;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") result[key] = item;
  }
  return result;
}

function chainItemOf(entry: Entry): ChainItem {
  return {
    id: idOf(entry) ?? "",
    layer: entry.layer.key,
    title: titleOf(entry),
    path: entry.path,
    parent: parentIdOf(entry) ?? null,
  };
}

/** 全仓总览：每条链（无父的起始条目）一行，带进度（条目数 / 覆盖率）与陈旧两档计数。 */
export async function chainSummaries(cwd: string): Promise<ChainSummary[]> {
  const entries = await readEntries(cwd);
  const roots = entries.filter((entry) => parentIdOf(entry) === undefined);
  const summaries: ChainSummary[] = [];
  for (const root of roots) {
    const members = chainMembers(entries, idOf(root) ?? root.path);
    const coverage = computeCoverage(members);
    const { direct, transitive } = staleFindings(members);
    summaries.push({
      id: idOf(root) ?? "",
      layer: root.layer.key,
      title: titleOf(root),
      path: root.path,
      items: members.length,
      coverage: {
        covered: coverage.reduce((sum, item) => sum + item.covered, 0),
        total: coverage.reduce((sum, item) => sum + item.total, 0),
      },
      stale: { direct: direct.length, transitive: transitive.length },
    });
  }
  summaries.sort((a, b) => a.id.localeCompare(b.id));
  return summaries;
}

/**
 * 三处门禁（#139/#146）：两处 auto（IR 录入 / SR→AR，由事实现算）+ 一处 signed
 * （功能拆分，读链状态文件的 gates 记录）。门禁状态一概不落盘（能算的不写盘）；
 * 自动挡的三项与 validate 的 coverage.unrealized-usecase / field.* / stale.direct-downstream
 * 共用同一份数据（coverage.ts / fieldcheck.ts / stale.ts）。
 *
 * 功能拆分门禁 = **签字 + 三项自动挡 + 签字判据与当前判据一致**，三者不齐即 pending，
 * `missing` 逐样点名。unreviewedStale 由调用方算好传入（chainStatus 已算过陈旧分级，
 * 不重复遍历关系图）。
 */
function gatesOf(
  members: Entry[],
  all: Entry[],
  state: ChainState | undefined,
  unreviewedStale: DirectStaleView[],
): GateView[] {
  const irs = members.filter((entry) => entry.layer.key === "ir");
  const irEntryPassed = irs.every(
    (entry) => confirmationOf(entry).state === "confirmed",
  );

  const srs = members.filter((entry) => entry.layer.key === "sr");
  const srArPassed = srs.every((sr) => {
    const id = idOf(sr);
    if (id === undefined) return false; // 缺 id 由 id.*/field.* 报；此处无从判定，按未过
    return all.some(
      (candidate) => candidate.layer.key === "ar" && parentIdOf(candidate) === id,
    );
  });

  const signature = gateRecordOf(state?.gates["function-split"]);
  const unrealized = unrealizedUsecases(members, all);
  const incompletePoints = members.filter(
    (entry) =>
      entry.layer.key === "function-points" && fieldDefectsOf(entry).length > 0,
  );
  const checks: { check: string; passed: boolean }[] = [
    { check: "每条用例都有功能点 realizes 它", passed: unrealized.length === 0 },
    { check: "每个功能点五项字段齐备", passed: incompletePoints.length === 0 },
    { check: "无未复核的直接下游陈旧", passed: unreviewedStale.length === 0 },
  ];
  const autoPassed = checks.every((check) => check.passed);
  const criterionMatched = signature?.criterion === FUNCTION_SPLIT_CRITERION;
  const missing: string[] = [];
  if (signature === null) {
    missing.push("签字：gates.function-split 缺 by + at 的人工通过记录");
  } else if (!criterionMatched) {
    missing.push("签字判据与当前判据不一致（判据文案已改，需按当前判据重签）");
  }
  for (const check of checks) {
    if (!check.passed) missing.push(`自动挡未过：${check.check}`);
  }

  return [
    {
      gate: "ir-entry",
      kind: "auto",
      blocking: true,
      state: irEntryPassed ? "passed" : "pending",
      criterion: IR_ENTRY_CRITERION,
      by: null,
      at: null,
    },
    {
      gate: "sr-ar",
      kind: "auto",
      blocking: false,
      state: srArPassed ? "passed" : "pending",
      criterion: SR_AR_CRITERION,
      by: null,
      at: null,
    },
    {
      gate: "function-split",
      kind: "signed",
      blocking: true,
      state: signature !== null && criterionMatched && autoPassed ? "passed" : "pending",
      criterion: FUNCTION_SPLIT_CRITERION,
      by: signature?.by ?? null,
      at: signature?.at ?? null,
      checks,
      pending: { unrealizedUsecases: unrealized, unreviewedStale },
      signedCriterion: signature?.criterion ?? null,
      missing,
    },
  ];
}

/** 一条链的详情：起始条目 + 全部后代 + 六段链路的跳过视图。链不存在时抛 `chain.not-found`（exit 2）。 */
export async function chainStatus(cwd: string, id: string): Promise<ChainDetail> {
  const entries = await readEntries(cwd);
  if (!entries.some((entry) => idOf(entry) === id)) {
    throw new BaizeError("chain.not-found", `链不存在：${id}`);
  }
  const members = chainMembers(entries, id);
  const items = members.map(chainItemOf);
  items.sort((a, b) => a.id.localeCompare(b.id));
  const state = await readChainState(cwd, id);
  const stages: StageView[] = STAGES.map((stage) => {
    if (stage === "function") {
      const fn = functionSkipOf(state?.skipped["function"]);
      if (fn.whole !== null) return { stage, skipped: fn.whole };
      return { stage, skipped: null, subStages: { items: fn.items, points: fn.points } };
    }
    return { stage, skipped: skipRecordOf(state?.skipped[stage]) };
  });
  // #155 陈旧：上下游关系现算不落盘；WARNING 直接下游 / INFO 传递（见 stale.ts 注释）。
  // 分级只算一次：链视图的陈旧汇总与门禁的待签字清单共用同一份结果，不重复遍历。
  const findings = staleFindings(members);
  const unreviewedStale = directStaleViews(members, findings);
  return {
    id,
    items,
    stages,
    coverage: computeCoverage(members),
    stale: {
      direct: findings.direct.map((entry) => idOf(entry) ?? ""),
      transitive: findings.transitive.length,
    },
    gates: gatesOf(members, entries, state, unreviewedStale),
  };
}

/** 沿 parent 边走到根，返回链起始条目 id；父边断裂时停在可达的最高条目。 */
function chainRootIdOf(entry: Entry, byId: Record<string, Entry>): string | null {
  let current = entry;
  for (let depth = 0; depth < 10_000; depth++) {
    const parentId = parentIdOf(current);
    if (parentId === undefined) return idOf(current) ?? null;
    const parent = byId[parentId];
    if (parent === undefined) return idOf(current) ?? null;
    current = parent;
  }
  return idOf(current) ?? null;
}

/** IR 的线索级反向覆盖：每条 acceptance 线索被哪几条 SR 的 covers 指向（升序）。 */
function clueCoverageOf(entry: Entry, entries: Entry[]): ItemClueCoverage[] {
  const id = idOf(entry);
  const acceptance = entry.frontmatter["acceptance"];
  if (id === undefined || !isPlainObject(acceptance)) return [];
  const coveredBy = new Map<string, string[]>();
  for (const candidate of entries) {
    if (candidate.layer.key !== "sr") continue;
    const srId = idOf(candidate);
    if (srId === undefined) continue;
    const covers = candidate.frontmatter["covers"];
    if (!Array.isArray(covers)) continue;
    for (const item of covers) {
      const ref = parseClueRef(item);
      if (ref === null || ref.entryId !== id) continue;
      const list = coveredBy.get(ref.clueId);
      if (list) list.push(srId);
      else coveredBy.set(ref.clueId, [srId]);
    }
  }
  return Object.entries(acceptance).map(([clueId, value]) => {
    const by = (coveredBy.get(clueId) ?? []).sort();
    return {
      clueId,
      text: typeof value === "string" ? value : "",
      covered: by.length > 0,
      coveredBy: by,
    };
  });
}

/** 用例沿 appearsIn 反向取场景的 catalog（可能多个目录，按场景 id 升序）。 */
function catalogSourcesOf(
  entry: Entry,
  byId: Record<string, Entry>,
): ItemCatalogSource[] {
  const appearsIn = entry.frontmatter["appearsIn"];
  if (!Array.isArray(appearsIn)) return [];
  const sources: ItemCatalogSource[] = [];
  for (const item of appearsIn) {
    if (typeof item !== "string") continue;
    const scenario = byId[item];
    if (scenario === undefined || scenario.layer.key !== "scenarios") continue;
    const catalog = scenario.frontmatter["catalog"];
    sources.push({
      scenario: item,
      catalog: typeof catalog === "string" ? catalog : "",
    });
  }
  sources.sort((a, b) => a.scenario.localeCompare(b.scenario));
  return sources;
}

/** 单条目的正反向视图入口：条目本身 + 关系只存单向、磁盘上不存在的那一半反向信息。 */
export async function itemStatus(cwd: string, id: string): Promise<ItemView> {
  const entries = await readEntries(cwd);
  const entry = entries.find((candidate) => idOf(candidate) === id);
  if (!entry) throw new BaizeError("item.not-found", `条目不存在：${id}`);
  const byId: Record<string, Entry> = {};
  for (const candidate of entries) {
    const candidateId = idOf(candidate);
    if (candidateId !== undefined && !Object.hasOwn(byId, candidateId)) {
      byId[candidateId] = candidate;
    }
  }

  const view: ItemView = {
    id: idOf(entry) ?? "",
    layer: entry.layer.key,
    title: titleOf(entry),
    path: entry.path,
    parent: parentIdOf(entry) ?? null,
    statement: entry.body.trim(),
    acceptance: stringMapOf(entry.frontmatter["acceptance"]),
    confirmation: confirmationOf(entry),
    chain: chainRootIdOf(entry, byId),
  };
  if (entry.layer.key === "ir") {
    view.clueCoverage = clueCoverageOf(entry, entries);
  }
  if (entry.layer.key === "usecases") {
    view.catalogs = catalogSourcesOf(entry, byId);
    const realizedBy: string[] = [];
    for (const candidate of entries) {
      if (candidate.layer.key !== "function-items") continue;
      const realizes = candidate.frontmatter["realizes"];
      if (!Array.isArray(realizes) || !realizes.includes(id)) continue;
      const fnId = idOf(candidate);
      if (fnId !== undefined) realizedBy.push(fnId);
    }
    view.realizedBy = realizedBy.sort();
  }
  return view;
}
