import type { Entry } from "./entry.ts";
import { claimIdsOf, idOf, parentIdOf } from "./entry.ts";

/**
 * 一条链 = 起始条目 + 沿 `parent` 边可达的后代 ∪ 认领了链内 SR 的方案层条目
 * （#190：链成员 = 沿 parent 可达 ∪「它认领的 SR 所属的链」，一条条目认领多条 SR
 * 时同属多条链）。按 id 去重、防环。链视图的共享标注在 status.ts（#182），这里只定成员。
 */
export function chainMembers(entries: Entry[], chainId: string): Entry[] {
  const byParent = new Map<string, Entry[]>();
  const byClaimed = new Map<string, Entry[]>();
  for (const entry of entries) {
    const parent = parentIdOf(entry);
    if (parent !== undefined) {
      const siblings = byParent.get(parent);
      if (siblings) siblings.push(entry);
      else byParent.set(parent, [entry]);
    }
    for (const claimed of claimIdsOf(entry)) {
      const claimers = byClaimed.get(claimed);
      if (claimers) claimers.push(entry);
      else byClaimed.set(claimed, [entry]);
    }
  }

  const root = entries.find((entry) => idOf(entry) === chainId);
  if (!root) return [];

  const members: Entry[] = [];
  const seen = new Set<string>();
  const queue: Entry[] = [root];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) break;
    const currentId = idOf(current);
    if (currentId !== undefined) {
      if (seen.has(currentId)) continue;
      seen.add(currentId);
    }
    members.push(current);
    if (currentId !== undefined) {
      queue.push(...(byParent.get(currentId) ?? []));
      queue.push(...(byClaimed.get(currentId) ?? []));
    }
  }
  return members;
}

/** 链根（#182）：无父且无任何认领边的条目。方案层条目靠认领边挂链，不是链根；
 * 链视图的共享标注（status.ts）按链根枚举「还有哪些链」。 */
export function chainRoots(entries: Entry[]): Entry[] {
  return entries.filter(
    (entry) => parentIdOf(entry) === undefined && claimIdsOf(entry).length === 0,
  );
}
