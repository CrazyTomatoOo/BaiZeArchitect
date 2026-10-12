import type { ChainDetail, ChainSummary, ItemView } from "./status.ts";
import type { Issue } from "./types.ts";

/** 输出契约版本。只增不改：删字段或改语义必须升版本。 */
export const SCHEMA_VERSION = 1;

export interface Created {
  id: string;
  path: string;
}
export interface ErrorPayload {
  rule: string;
  message: string;
}

/** 机器可读输出：JSON.stringify，顶层由调用方带 schemaVersion。 */
export function toJson(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** 人读输出 = 同一份数据的渲染（与 --json 同源，不可能漂移）。 */
export function renderIssues(issues: Issue[]): string {
  if (issues.length === 0) return "校验通过：0 个问题\n";
  const count = (level: Issue["level"]) =>
    issues.filter((issue) => issue.level === level).length;
  const lines = [
    `校验：${issues.length} 个问题（ERROR ${count("ERROR")} / WARNING ${count("WARNING")} / INFO ${count("INFO")}）`,
  ];
  for (const issue of issues) {
    lines.push(`  ${issue.level} ${issue.rule} ${issue.path} — ${issue.message}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderCreated(created: Created): string {
  return `已创建 ${created.path}（${created.id}）\n`;
}

export function renderChains(chains: ChainSummary[]): string {
  if (chains.length === 0) return "没有链。\n";
  const lines = [`链：${chains.length} 条`];
  for (const chain of chains) {
    lines.push(`  ${chain.id}  ${chain.title}  ${chain.path}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderChain(chain: ChainDetail): string {
  const lines = [`链 ${chain.id}：${chain.items.length} 个条目`];
  for (const item of chain.items) {
    lines.push(`  ${item.id} [${item.layer}] ${item.title}`);
  }
  for (const coverage of chain.coverage) {
    lines.push(`  ${coverage.id} ${coverage.covered}/${coverage.total} 已覆盖`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderItem(item: ItemView): string {
  const lines = [
    `条目 ${item.id}（${item.layer}）`,
    `  title: ${item.title}`,
    `  path: ${item.path}`,
    `  parent: ${item.parent ?? "—"}`,
    `  statement: ${item.statement}`,
  ];
  const clues = Object.keys(item.acceptance);
  if (clues.length > 0) {
    lines.push("  acceptance:");
    for (const clue of clues) {
      lines.push(`    ${clue}: ${item.acceptance[clue] ?? ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderError(error: ErrorPayload): string {
  return `错误 [${error.rule}]：${error.message}\n`;
}
