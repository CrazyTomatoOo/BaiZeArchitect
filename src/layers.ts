/**
 * 层级注册表：目录（位置）、id 前缀，以及该层必填字段的 schema。
 *
 * `ir` 的 schema 在 #148 落地（tracer bullet 的唯一一条最窄路径）；`sr` / `ar`
 * 的 schema 由 #149 补上（含必填的 `parent` 与 SR 的 `covers`）。
 * 其余层的目录/前缀先登记（扫描与 id 校验要用），字段 schema 由后续工单逐层补上
 * （#152 受控清单与 AR 分配 / #154 分析三层与关联边）。
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
  {
    key: "sr",
    dir: "sr",
    prefix: "SR",
    fields: [
      {
        name: "id",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：id（应为 SR-<三位数字> 形式的顺序编号）",
      },
      {
        name: "title",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：title（人类可读的短名）",
      },
      {
        // SR 必有父（单亲）。「为空/缺失」这一事实由 ref.orphan 专门报，
        // 故此处 nonEmpty: false，避免与 ref.orphan 双重报错。
        name: "parent",
        source: "frontmatter",
        nonEmpty: false,
        kind: "scalar",
        emptyMessage: "字段为空：parent",
      },
      {
        // 覆盖 IR 的验收线索（IR-001#a1）。允许空数组（明确声明一条都不覆盖）。
        name: "covers",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：covers",
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
  {
    key: "ar",
    dir: "ar",
    prefix: "AR",
    fields: [
      {
        name: "id",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：id（应为 AR-<三位数字> 形式的顺序编号）",
      },
      {
        name: "title",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：title（人类可读的短名）",
      },
      {
        // 同 SR：为空/缺失由 ref.orphan 报。
        name: "parent",
        source: "frontmatter",
        nonEmpty: false,
        kind: "scalar",
        emptyMessage: "字段为空：parent",
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
  { key: "scenarios", dir: "scenarios", prefix: "SC", fields: [] },
  { key: "usecases", dir: "usecases", prefix: "UC", fields: [] },
  { key: "function-items", dir: "function-items", prefix: "FN", fields: [] },
  { key: "function-points", dir: "function-points", prefix: "FP", fields: [] },
];
