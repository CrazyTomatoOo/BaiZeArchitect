import type { Entry } from "./entry.ts";
import { isPlainObject } from "./guards.ts";
import type { FieldKind } from "./layers.ts";

/**
 * 必填字段检查：validate（field.absent / field.empty）与 status（功能拆分门禁的
 * 「功能点五项字段齐备」自动挡）共用本模块，保证两路对同一事实说法一致。
 * 缺字段与空字段是两种缺陷（#139）：`alternateFlows: []` = 看过了确实没有；
 * 没写该字段 = 没想。空判定按字段种类走：
 * - `string`：空/纯空白
 * - `array` / `map`：**任何空容器**（`[]` 与 `{}` 都可能是「没写」）
 * - `scalar`：`null`
 * 其它类型不符（例：集合字段给了非空标量）视为「已填」，不引入类型类 rule。
 */

export interface FieldDefect {
  name: string;
  /** `absent` 缺字段 / `empty` 字段为空。 */
  problem: "absent" | "empty";
}

export function isEmptyValue(kind: FieldKind, value: unknown): boolean {
  if (kind === "string") return typeof value === "string" && value.trim() === "";
  if (kind === "scalar") return value === null;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

/** 该条目必填字段的缺陷清单（按 layer schema 的顺序；只收录 absent/empty 两种）。 */
export function fieldDefectsOf(entry: Entry): FieldDefect[] {
  const defects: FieldDefect[] = [];
  for (const field of entry.layer.fields) {
    const present =
      field.source === "body" || Object.hasOwn(entry.frontmatter, field.name);
    if (!present) {
      defects.push({ name: field.name, problem: "absent" });
      continue;
    }
    if (!field.nonEmpty) continue;
    const value =
      field.source === "body" ? entry.body : entry.frontmatter[field.name];
    if (isEmptyValue(field.kind, value)) {
      defects.push({ name: field.name, problem: "empty" });
    }
  }
  return defects;
}
