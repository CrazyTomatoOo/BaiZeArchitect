// 链的向上行走（#147「门禁」/「分解树」；#190 起方案层无父边，沿认领边上溯）。
//
// `status` 的三个入口与 `validate` 的 stage.upstream-unconfirmed 都要回答
// 「这一条属于哪条链、链根是谁」——放在这里一份，不各写一套。
import type { Entry } from "./entry.ts";
import { claimIdsOf, idOf, parentIdOf } from "./entry.ts";

/**
 * 沿 `parent` 边一路向上到链根；方案层条目（场景 / 用例 / 功能项 / 功能点）没有父边，
 * 沿它的**全部**认领边（refines / satisfies）各自走到被认领的 SR 再继续向上（#190）。
 * 认领多条 SR 时同属多条链（#165 Q9 / #182），所以返回**所有可达链根**（去重、按 id 升序）。
 * 父缺失（`ref.parent-missing` 会报）或成环时，停在能走到的最远处——
 * 这里只回答「根是谁」，拓扑对不对由 `ref.*` 报。
 */
export function chainRootsOf(byId: Record<string, Entry>, entry: Entry): Entry[] {
  const roots = new Map<string, Entry>();
  const seen = new Set<string>();
  const walk = (current: Entry): void => {
    const id = idOf(current);
    if (id !== undefined) {
      if (seen.has(id)) return;
      seen.add(id);
    }
    const parentId = parentIdOf(current);
    const parent = parentId === undefined ? undefined : byId[parentId];
    if (parent !== undefined) {
      walk(parent);
      return;
    }
    const claims = claimIdsOf(current);
    if (claims.length === 0) {
      if (id !== undefined) roots.set(id, current);
      return;
    }
    let advanced = false;
    for (const claim of claims) {
      const claimed = byId[claim];
      if (claimed !== undefined) {
        advanced = true;
        walk(claimed);
      }
    }
    // 认领边全断（`ref.orphan` 会报）时，这里自己是可达的最高点
    if (!advanced && id !== undefined) roots.set(id, current);
  };
  walk(entry);
  return [...roots.values()].sort((a, b) => (idOf(a) ?? "").localeCompare(idOf(b) ?? ""));
}
