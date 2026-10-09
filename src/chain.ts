import type { Entry } from "./entry.ts";
import { idOf, parentIdOf } from "./entry.ts";

/** 一条链 = 起始条目 + 沿 `parent` 边可达的全部后代（按 id 去重、防环）。 */
export function chainMembers(entries: Entry[], chainId: string): Entry[] {
  const byParent = new Map<string, Entry[]>();
  for (const entry of entries) {
    const parent = parentIdOf(entry);
    if (parent === undefined) continue;
    const siblings = byParent.get(parent);
    if (siblings) siblings.push(entry);
    else byParent.set(parent, [entry]);
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
    if (currentId !== undefined) queue.push(...(byParent.get(currentId) ?? []));
  }
  return members;
}
