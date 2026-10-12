import type { Entry } from "./entry.ts";
import { idOf, parentIdOf } from "./entry.ts";
import { fingerprintOf } from "./fingerprint.ts";
import { isPlainObject } from "./guards.ts";
import type { Issue } from "./types.ts";

/**
 * 陈旧（Stale）：上游改了、下游没复核。
 *
 * 判定只靠复核指纹：下游条目上的 `reviewed: { <上游 id>: <实质字段摘要> }` 是「我复核过的
 * 上游版本」，与上游**当前**指纹（`fingerprintOf`，#151 的实质字段清单）比对，不符即陈旧。
 *
 * 两条硬规矩写在这里，不让它们变成隐含假设：
 * 1. **未复核过不算陈旧**——没有 `reviewed` 记录就没有「又变了」：陈旧的定义是「复核过、
 *    之后上游又改了」。从未复核的下游永远不报陈旧，否则全仓永远红。
 * 2. **不用时间**：不读 `mtime`、不读 git 提交时间。前者在 clone / checkout 后全部重置；
 *    后者把「有没有复核」偷换成「有没有提交」，会让「改了下游但没复核就提交」静默吞掉
 *    陈旧。一个会自己消失的警告比没有警告更危险。
 *
 * 上下游关系从磁盘现算、不落盘（能算的不写盘）：重复跑 validate 结果一致，陈旧不会自己消失。
 */

/** 下游条目上的复核记录：上游 id → 当时记下的实质字段摘要。形状不符的项忽略。 */
export function reviewedRecordOf(entry: Entry): Record<string, string> {
  const raw = entry.frontmatter["reviewed"];
  if (!isPlainObject(raw)) return {};
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") record[key] = value;
  }
  return record;
}

function byIdOf(entries: Entry[]): Record<string, Entry> {
  const byId: Record<string, Entry> = {};
  for (const entry of entries) {
    const id = idOf(entry);
    if (id !== undefined && !Object.hasOwn(byId, id)) byId[id] = entry;
  }
  return byId;
}

/** 该条目记过的上游中，指纹与上游当前实质字段不符的那些（升序）。 */
function staleUpstreamIdsOf(entry: Entry, byId: Record<string, Entry>): string[] {
  const record = reviewedRecordOf(entry);
  const mismatched: string[] = [];
  for (const upstreamId of Object.keys(record).sort()) {
    const upstream = byId[upstreamId];
    if (upstream === undefined) continue; // 上游不存在无法比对；断边由 ref.parent-missing 报
    if (fingerprintOf(upstream) !== record[upstreamId]) {
      mismatched.push(upstreamId);
    }
  }
  return mismatched;
}

export interface StaleFinding {
  /** 直接下游陈旧：有 reviewed 记录、且某个上游当前指纹不符（未复核过的不算）。 */
  direct: Entry[];
  /**
   * 传递受影响：陈旧条目的**严格后代**中，自己不是直接陈旧的。
   * 已直接陈旧的条目不重复计入传递（门禁处：直接下游阻塞，闭包内只提醒）。
   */
  transitive: Entry[];
}

/** 在 scoped 集合内现算陈旧分级；上游不存在 / 未复核的条目不参与。 */
export function staleFindings(scoped: Entry[]): StaleFinding {
  const byId = byIdOf(scoped);
  const direct = scoped.filter((entry) => staleUpstreamIdsOf(entry, byId).length > 0);
  const directIds = new Set(direct.map((entry) => idOf(entry) ?? entry.path));

  // parent 边的子节点索引；从每条陈旧条目出发做 BFS，跳过自己（严格后代）。
  const childrenByParent = new Map<string, Entry[]>();
  for (const entry of scoped) {
    const parent = parentIdOf(entry);
    if (parent === undefined) continue;
    const siblings = childrenByParent.get(parent);
    if (siblings) siblings.push(entry);
    else childrenByParent.set(parent, [entry]);
  }

  const seen = new Set<string>();
  const transitive: Entry[] = [];
  const queue: Entry[] = [...direct];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) break;
    const currentId = idOf(current);
    if (currentId === undefined) continue;
    for (const child of childrenByParent.get(currentId) ?? []) {
      const childId = idOf(child) ?? child.path;
      if (seen.has(childId)) continue;
      seen.add(childId);
      if (!directIds.has(childId)) transitive.push(child);
      queue.push(child); // 继续下探；直接陈旧的子节点自己不报传递，但其后代仍算
    }
  }

  const byKey = (entry: Entry) => idOf(entry) ?? entry.path;
  direct.sort((a, b) => byKey(a).localeCompare(byKey(b)));
  transitive.sort((a, b) => byKey(a).localeCompare(byKey(b)));
  return { direct, transitive };
}

export interface DirectStaleView {
  id: string;
  path: string;
  /** 指纹与当前实质字段不符、待复核的上游 id（升序）。 */
  upstreams: string[];
}

/**
 * 直接下游陈旧的结构化清单（`stale.direct-downstream` 那份数据）。
 * validate（报成 issue）与 status（功能拆分门禁的待签字清单）共用本函数，不各算一套。
 */
export function directStaleViews(scoped: Entry[]): DirectStaleView[] {
  const byId = byIdOf(scoped);
  const { direct } = staleFindings(scoped);
  return direct.map((entry) => ({
    id: idOf(entry) ?? entry.path,
    path: entry.path,
    upstreams: staleUpstreamIdsOf(entry, byId),
  }));
}

/** 传递条目的消息里点出直接陈旧的祖先（沿 parent 链在作用域内回溯，升序去重）。 */
function staleAncestorsOf(
  entry: Entry,
  byId: Record<string, Entry>,
  directIds: Set<string>,
): string[] {
  const ancestors = new Set<string>();
  let cursor = parentIdOf(entry);
  while (cursor !== undefined) {
    if (directIds.has(cursor)) ancestors.add(cursor);
    const parent = byId[cursor];
    cursor = parent === undefined ? undefined : parentIdOf(parent);
  }
  return [...ancestors].sort();
}

/**
 * 陈旧规则输出：
 * - `stale.direct-downstream` = **WARNING**（`--strict` 升级为失败）；
 * - `stale.transitive` = **INFO**，永不升级。
 */
export function staleIssues(scoped: Entry[]): Issue[] {
  const byId = byIdOf(scoped);
  const { direct, transitive } = staleFindings(scoped);
  const directIds = new Set(direct.map((entry) => idOf(entry) ?? entry.path));

  const issues: Issue[] = [];
  for (const entry of direct) {
    const id = idOf(entry) ?? entry.path;
    const upstreams = staleUpstreamIdsOf(entry, byId);
    issues.push({
      level: "WARNING",
      rule: "stale.direct-downstream",
      path: entry.path,
      message: `直接下游待复核：${id} 复核过的上游 ${upstreams.join("、")} 已改（reviewed 指纹与当前实质字段不符）`,
      fix: `baize accept ${id} 按现版上游复核`,
    });
  }
  for (const entry of transitive) {
    const id = idOf(entry) ?? entry.path;
    const ancestors = staleAncestorsOf(entry, byId, directIds);
    issues.push({
      level: "INFO",
      rule: "stale.transitive",
      path: entry.path,
      message: `传递影响：${id} 的陈旧祖先 ${ancestors.join("、")} 上游已改未复核，本条目可能需连带调整`,
      fix: `复核祖先后按现版重新 accept 本条目`,
    });
  }
  return issues;
}
