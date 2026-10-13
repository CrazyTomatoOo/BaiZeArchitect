// 链的向上行走（#147「门禁」/「分解树」）。
//
// `status` 的三个入口与 `validate` 的 stage.upstream-unconfirmed 都要回答
// 「这一条属于哪条链、链根是谁」——放在这里一份，不各写一套。
import type { Entry } from "./entry.ts";
import { idOf, parentIdOf } from "./entry.ts";

/**
 * 沿 `parent` 边一路向上到链根。父缺失（`ref.parent-missing` 会报）或成环时，
 * 停在能走到的最远处——这里只回答「根是谁」，拓扑对不对由 `ref.*` 报。
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
    if (parent === undefined) return current;
    current = parent;
  }
}
