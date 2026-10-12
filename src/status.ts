import type { Entry } from "./entry.ts";
import { idOf, parentIdOf } from "./entry.ts";
import { BaizeError } from "./errors.ts";
import { chainMembers } from "./chain.ts";
import { confirmationOf, type ConfirmationView } from "./confirm.ts";
import { isPlainObject } from "./guards.ts";
import { readEntries } from "./store.ts";
import { staleFindings } from "./stale.ts";

export interface ChainSummary {
  id: string;
  layer: string;
  title: string;
  path: string;
}
export interface ChainItem {
  id: string;
  layer: string;
  title: string;
  path: string;
  parent: string | null;
}
/** 链的陈旧汇总（#155）：直接下游待复核 + 另有 N 条下游受传递影响。 */
export interface ChainStaleView {
  /** 直接下游陈旧的条目 id（升序）。 */
  direct: string[];
  /** 另有 N 条下游受传递影响（陈旧条目的严格后代，自身不重复计）。 */
  transitive: number;
}
export interface ChainDetail {
  id: string;
  items: ChainItem[];
  stale: ChainStaleView;
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

/** 全仓总览：每条链（无父的起始条目）一行。 */
export async function chainSummaries(cwd: string): Promise<ChainSummary[]> {
  const entries = await readEntries(cwd);
  return entries
    .filter((entry) => parentIdOf(entry) === undefined)
    .map((entry) => ({
      id: idOf(entry) ?? "",
      layer: entry.layer.key,
      title: titleOf(entry),
      path: entry.path,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** 一条链的详情：起始条目 + 全部后代。链不存在时抛 `chain.not-found`（exit 2）。 */
export async function chainStatus(cwd: string, id: string): Promise<ChainDetail> {
  const entries = await readEntries(cwd);
  if (!entries.some((entry) => idOf(entry) === id)) {
    throw new BaizeError("chain.not-found", `链不存在：${id}`);
  }
  const members = chainMembers(entries, id);
  const items = members.map(chainItemOf);
  items.sort((a, b) => a.id.localeCompare(b.id));
  const { direct, transitive } = staleFindings(members);
  return {
    id,
    items,
    stale: {
      direct: direct.map((entry) => idOf(entry) ?? ""),
      transitive: transitive.length,
    },
  };
}

/** 单条目的正反向视图入口（#148 只做条目本身；反向关系与覆盖率归后续工单）。 */
export async function itemStatus(cwd: string, id: string): Promise<ItemView> {
  const entries = await readEntries(cwd);
  const entry = entries.find((candidate) => idOf(candidate) === id);
  if (!entry) throw new BaizeError("item.not-found", `条目不存在：${id}`);
  return {
    id: idOf(entry) ?? "",
    layer: entry.layer.key,
    title: titleOf(entry),
    path: entry.path,
    parent: parentIdOf(entry) ?? null,
    statement: entry.body.trim(),
    acceptance: stringMapOf(entry.frontmatter["acceptance"]),
    confirmation: confirmationOf(entry),
  };
}
