import { createHash } from "node:crypto";
import type { Entry } from "./entry.ts";
import { isPlainObject } from "./guards.ts";

/**
 * 实质字段（Substantive Fields）：决定「这条目现在说的还是不是那一版」的内容。
 * `statement` + `acceptance` + 出边（`parent` / `covers` / `allocates` / `appearsIn` / `realizes`）。
 *
 * 一份清单，两处消费者共用：
 * - 确认（#151）比对**自己**的实质字段——`baize accept` 记指纹，改动后重算不符即失效；
 * - 陈旧（#155）比对**上游**的实质字段——复核指纹对不上即待复核。
 * 关系边必须算进去：上游把 `covers` 从 a1 改成 a2，下游的覆盖率就变了。
 */
const EDGE_FIELDS = ["parent", "covers", "allocates", "appearsIn", "realizes"] as const;

/** 该条目的实质字段清单（缺失的边取 null，键序固定，可直接比较）。 */
export function substantiveFields(entry: Entry): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    statement: entry.body,
    acceptance: entry.frontmatter["acceptance"] ?? null,
  };
  for (const edge of EDGE_FIELDS) {
    fields[edge] = entry.frontmatter[edge] ?? null;
  }
  return fields;
}

/** 键序无关的稳定序列化：对象按键排序递归展开，数组保序。 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const parts = keys.map(
      (key) => `${JSON.stringify(key)}:${canonical(value[key])}`,
    );
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** 实质字段指纹：稳定序列化后 SHA-256。不比时间——「我看过哪一版」不是 mtime 能回答的。 */
export function fingerprintOf(entry: Entry): string {
  return createHash("sha256")
    .update(canonical(substantiveFields(entry)))
    .digest("hex");
}
