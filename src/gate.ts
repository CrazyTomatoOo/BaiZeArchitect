// 链的向上行走（#147「门禁」/「分解树」；#190 起方案层无父边，沿认领边上溯）。
//
// `status` 的三个入口与 `validate` 的 stage.upstream-unconfirmed 都要回答
// 「这一条属于哪条链、链根是谁」——放在这里一份，不各写一套。
import type { Entry } from "./entry.ts";
import { claimIdsOf, idOf, parentIdOf } from "./entry.ts";

/**
 * 沿 `parent` 边一路向上到链根；方案层条目（场景 / 用例 / 功能项 / 功能点）没有父边，
 * 沿它的认领边（refines / satisfies）走到被认领的 SR，再继续向上（#190）。
 * 父缺失（`ref.parent-missing` 会报）或成环时，停在能走到的最远处——
 * 这里只回答「根是谁」，拓扑对不对由 `ref.*` 报。
 */
export function chainRootOf(byId: Record<string, Entry>, entry: Entry): Entry {
  let current = entry;
  const seen = new Set<string>();
  for (;;) {
    const id = idOf(current);
    if (id !== undefined) {
      if (seen.has(id)) return current;
      seen.add(id);
    }
    const parentId = parentIdOf(current);
    const parent = parentId === undefined ? undefined : byId[parentId];
    if (parent !== undefined) {
      current = parent;
      continue;
    }
    const claims = claimIdsOf(current);
    const claimed = claims.length > 0 ? byId[claims[0]!] : undefined;
    if (claimed === undefined) return current;
    current = claimed;
  }
}
