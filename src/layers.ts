/**
 * 层级注册表：目录（位置）、id 前缀，以及该层必填字段的 schema。
 *
 * `ir` 的 schema 在 #148 落地（tracer bullet 的唯一一条最窄路径）；`sr` / `ar`
 * 的 schema 由 #149 补上（含必填的 `parent` 与 SR 的 `covers`）。
 * 分析四层（场景 / 用例 / 功能项 / 功能点）的 schema 由 #154 补上，
 * 含关联边（用例 `appearsIn` → 场景、功能项 `realizes` → 用例）。
 * 场景的 `catalog` 字段与 AR 的 `allocates` 由 #152 补（受控清单）。
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
        // AR 必须恰好分配一个架构组件（受控清单 baize/architecture.yaml 的 slug）。
        // 标量；引用的 slug 是否存在由 ref.unknown-element 报。
        name: "allocates",
        source: "frontmatter",
        nonEmpty: true,
        kind: "scalar",
        emptyMessage: "字段为空：allocates（AR 必须恰好分配一个架构组件）",
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
    // 场景层完整 schema：#152 的 catalog（受控清单）+ #154 的分析字段。
    key: "scenarios",
    dir: "scenarios",
    prefix: "SC",
    fields: [
      {
        name: "id",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：id（应为 SC-<三位数字> 形式的顺序编号）",
      },
      {
        name: "title",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：title（人类可读的短名）",
      },
      {
        // 同 SR/AR：为空/缺失由 ref.orphan 报。
        name: "parent",
        source: "frontmatter",
        nonEmpty: false,
        kind: "scalar",
        emptyMessage: "字段为空：parent",
      },
      {
        // 场景挂受控清单 baize/scenario-catalogs.yaml 的一个目录 slug。
        // 引用的 slug 是否存在由 ref.unknown-catalog 报。
        name: "catalog",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：catalog（场景必须挂一个场景目录）",
      },
      {
        name: "preconditions",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：preconditions",
      },
      {
        name: "trigger",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：trigger（场景的触发条件）",
      },
      {
        name: "mainFlow",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：mainFlow",
      },
      {
        // 空数组合法：看过了确实没有备选流。
        name: "alternateFlows",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：alternateFlows",
      },
      {
        name: "expectedOutcome",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：expectedOutcome（场景的预期结果）",
      },
      {
        name: "stakeholders",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：stakeholders",
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
    key: "usecases",
    dir: "usecases",
    prefix: "UC",
    fields: [
      {
        name: "id",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：id（应为 UC-<三位数字> 形式的顺序编号）",
      },
      {
        name: "title",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：title（人类可读的短名）",
      },
      {
        // 用例的父边指向 SR。为空/缺失由 ref.orphan 报。
        name: "parent",
        source: "frontmatter",
        nonEmpty: false,
        kind: "scalar",
        emptyMessage: "字段为空：parent",
      },
      {
        // 多对多关联边：一条用例可同时出现在多个场景（不必复制用例）。
        // 允许空数组（声明暂不属于任何场景）；引用是否存在由 ref.unknown-target 报。
        name: "appearsIn",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：appearsIn",
      },
      {
        name: "goal",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：goal（用例的目标）",
      },
      {
        name: "preconditions",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：preconditions",
      },
      {
        name: "mainFlow",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：mainFlow",
      },
      {
        // 空数组合法：看过了确实没有备选流。
        name: "alternativeFlows",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：alternativeFlows",
      },
      {
        name: "postconditions",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：postconditions",
      },
      {
        name: "stakeholders",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：stakeholders",
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
    // 功能项是薄层：title + description，内容由子功能点承载。无 statement（#139 明确否掉）。
    key: "function-items",
    dir: "function-items",
    prefix: "FN",
    fields: [
      {
        name: "id",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：id（应为 FN-<三位数字> 形式的顺序编号）",
      },
      {
        name: "title",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：title（人类可读的短名）",
      },
      {
        // 功能项的父边指向 SR。为空/缺失由 ref.orphan 报。
        name: "parent",
        source: "frontmatter",
        nonEmpty: false,
        kind: "scalar",
        emptyMessage: "字段为空：parent",
      },
      {
        // 功能域只是功能项上的一个字段，不是一层。
        name: "domain",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：domain（功能域）",
      },
      {
        // 多对多关联边：一个功能项可服务多条用例。
        // 允许空数组；引用是否存在由 ref.unknown-target 报。
        name: "realizes",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：realizes",
      },
      {
        name: "description",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：description（功能项的一句话说明）",
      },
    ],
  },
  {
    // 功能点五项必填：职责 / 输入 / 输出 / 业务规则 / 验收条件。无 statement。
    key: "function-points",
    dir: "function-points",
    prefix: "FP",
    fields: [
      {
        name: "id",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：id（应为 FP-<三位数字> 形式的顺序编号）",
      },
      {
        // 功能点的父边指向功能项。为空/缺失由 ref.orphan 报。
        name: "parent",
        source: "frontmatter",
        nonEmpty: false,
        kind: "scalar",
        emptyMessage: "字段为空：parent",
      },
      {
        name: "responsibility",
        source: "frontmatter",
        nonEmpty: true,
        kind: "string",
        emptyMessage: "字段为空：responsibility（功能点的职责）",
      },
      {
        name: "inputs",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：inputs",
      },
      {
        name: "outputs",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：outputs",
      },
      {
        name: "businessRules",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：businessRules",
      },
      {
        name: "acceptanceCriteria",
        source: "frontmatter",
        nonEmpty: false,
        kind: "array",
        emptyMessage: "字段为空：acceptanceCriteria",
      },
    ],
  },
];
