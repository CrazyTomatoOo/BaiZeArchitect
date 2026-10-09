export type Level = "ERROR" | "WARNING" | "INFO";

/** 校验问题。rule 是稳定的点分 id（域限定为 ref/coverage/field/stale/id/stage）。 */
export interface Issue {
  level: Level;
  rule: string;
  path: string;
  message: string;
  fix?: string;
}
