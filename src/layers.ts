/**
 * 层级注册表：目录（位置）、id 前缀，以及该层必填字段的 schema。
 *
 * 只有 `ir` 的 schema 在本票（#148）落地——它是 tracer bullet 的唯一一条最窄路径。
 * 其余层的目录/前缀先登记（扫描与 id 校验要用），字段 schema 由后续工单逐层补上
 * （#149 引用类 rule 与父边 / #152 受控清单与 AR 分配 / #154 分析三层与关联边）。
 */
export type LayerKey =
  | "ir"
  | "sr"
  | "ar"
  | "scenarios"
  | "usecases"
  | "function-items"
  | "function-points";

export type FieldKind = "string" | "map" | "array" | "scalar";

export interface FieldSpec {
  name: string;
  /** frontmatter 里的字段，或条目的正文（`statement`）。 */
  source: "frontmatter" | "body";
  /** 允许为空集合（`[]` / `{}`）时为 false——空是「看过了确实没有」。 */
  nonEmpty: boolean;
  kind: FieldKind;
  /** `field.empty` 的消息。 */
  emptyMessage: string;
}

export interface LayerDef {
  key: LayerKey;
  /** `baize/` 下的目录名。 */
  dir: string;
  /** id 前缀，如 `IR` → `IR-001`。 */
  prefix: string;
  fields: FieldSpec[];
}

export const LAYERS: readonly LayerDef[] = [
  {
    key: "ir",
    dir: "ir",
    prefix: "IR",
    fields: [
      {
        name: "id",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：id（应为 IR-<三位数字> 形式的顺序编号）",
      },
      {
        name: "title",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：title（人类可读的短名）",
      },
      {
        name: "parent",
        source: "frontmatter",
        nonEmpty: false,
        kind: "scalar",
        emptyMessage: "字段为空：parent",
      },
      {
        name: "acceptance",
        source: "frontmatter",
        nonEmpty: true,
        kind: "map",
        emptyMessage: "字段为空：acceptance（至少要有一条验收线索）",
      },
      {
        name: "statement",
        source: "body",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：statement（正文不能为空）",
      },
    ],
  },
  { key: "sr", dir: "sr", prefix: "SR", fields: [] },
  { key: "ar", dir: "ar", prefix: "AR", fields: [] },
  { key: "scenarios", dir: "scenarios", prefix: "SC", fields: [] },
  { key: "usecases", dir: "usecases", prefix: "UC", fields: [] },
  { key: "function-items", dir: "function-items", prefix: "FN", fields: [] },
  { key: "function-points", dir: "function-points", prefix: "FP", fields: [] },
];
