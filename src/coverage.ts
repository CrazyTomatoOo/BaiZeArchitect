import type { Entry } from "./entry.ts";
import { idOf } from "./entry.ts";
import { isPlainObject } from "./guards.ts";

/**
 * 线索级覆盖率：每条 IR 的验收线索（acceptance 的键）有没有 SR 的 covers 指向它。
 * validate（coverage.missing-clue）与 status（链视图的覆盖进度）共用本模块，
 * 保证两路对同一事实说法一致。能算的不写盘：覆盖率不落盘，每次从条目现算。
 */

/** 解析 covers 项 `<条目id>#<线索id>`；不是这个形状返回 null。 */
export function parseClueRef(item: unknown): { entryId: string; clueId: string } | null {
  if (typeof item !== "string") return null;
  const hash = item.indexOf("#");
  if (hash <= 0 || hash === item.length - 1) return null;
  return { entryId: item.slice(0, hash), clueId: item.slice(hash + 1) };
}

export interface MissingClue {
  clueId: string;
  text: string;
}

export interface EntryCoverage {
  /** IR 条目 id。 */
  id: string;
  path: string;
  covered: number;
  total: number;
  missing: MissingClue[];
}

/** 线索文本：acceptance 的值，非字符串（类型问题归 field 规则）展示为空串。 */
function clueTextOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 对给定条目集合（全仓，或一条链的成员）算每条 IR 的线索覆盖率。
 * 只数集合内 SR 的 covers；指向不存在线索的 covers 项不可能是任何线索的覆盖
 * （覆盖率只按 IR acceptance 里真实存在的键核对），悬空引用由 ref.unknown-clue 另报。
 */
export function computeCoverage(entries: Entry[]): EntryCoverage[] {
  const coveredRefs = new Set<string>();
  for (const entry of entries) {
    if (entry.layer.key !== "sr") continue;
    const covers = entry.frontmatter["covers"];
    if (!Array.isArray(covers)) continue;
    for (const item of covers) {
      const ref = parseClueRef(item);
      if (ref !== null) coveredRefs.add(`${ref.entryId}#${ref.clueId}`);
    }
  }

  const result: EntryCoverage[] = [];
  for (const entry of entries) {
    if (entry.layer.key !== "ir") continue;
    const id = idOf(entry);
    const acceptance = entry.frontmatter["acceptance"];
    if (id === undefined || !isPlainObject(acceptance)) continue;
    const missing: MissingClue[] = [];
    let covered = 0;
    for (const [clueId, value] of Object.entries(acceptance)) {
      if (coveredRefs.has(`${id}#${clueId}`)) covered += 1;
      else missing.push({ clueId, text: clueTextOf(value) });
    }
    result.push({
      id,
      path: entry.path,
      covered,
      total: Object.keys(acceptance).length,
      missing,
    });
  }
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

export interface UnrealizedUsecase {
  id: string;
  path: string;
}

/**
 * 未被任何功能项 realizes 的用例（`coverage.unrealized-usecase` 那份数据）。
 * realizes 集合取全仓（跨链引用也合法），报告范围按传入的 scoped 限定。
 * validate（报成 issue）与 status（功能拆分门禁的待签字清单）共用本函数，不各算一套。
 */
export function unrealizedUsecases(
  scoped: Entry[],
  all: Entry[],
): UnrealizedUsecase[] {
  const realized = new Set<string>();
  for (const entry of all) {
    if (entry.layer.key !== "function-items") continue;
    const items = entry.frontmatter["realizes"];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (typeof item === "string") realized.add(item);
    }
  }

  const result: UnrealizedUsecase[] = [];
  for (const entry of scoped) {
    if (entry.layer.key !== "usecases") continue;
    const id = idOf(entry);
    if (id === undefined || realized.has(id)) continue;
    result.push({ id, path: entry.path });
  }
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}
