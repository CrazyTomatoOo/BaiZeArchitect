export type Level = "ERROR" | "WARNING" | "INFO";

/**
 * 规则域白名单（#190）：issue.rule 的点分前缀必须属于这里。集中成一处——
 * validate 的全部 rule 域（含既有 `sr.*`）与清单校验预留的 `catalog` 域，
 * 测试与（将来的）文档检查共用这一份，不再各处写正则。
 */
export const RULE_DOMAINS = [
  "field",
  "id",
  "ref",
  "coverage",
  "stage",
  "stale",
  "sr",
  "catalog",
] as const;

/** 校验问题。rule 是稳定的点分 id（域限定见 RULE_DOMAINS）。 */
export interface Issue {
  level: Level;
  rule: string;
  path: string;
  message: string;
  fix?: string;
}
