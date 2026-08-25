# Artifact View 标签真相源与原始 JSON 折叠移除

产物页（Artifact View）的可读性缺陷：kind 切换按钮渲染原始英文 kind、impactProfile status 值原样输出 `yes/no`、嵌套对象 22 个 schema key 缺中文标题、底部原始 JSON 折叠与上方卡片重叠且全英文。

决定：kind/字段/状态标签的单一真相源放在前端 `web/src/artifact-labels.ts`（TS 模块），而非后端 `contracts/` JSON；后端 contract 测试通过 tsx 相对路径 import 该前端模块，断言 `FIELD_TITLES` 覆盖 `artifact-content-v1.schema.json` 的全部 property key；删除原始 JSON 折叠区（结构化卡片已遍历全部非 SKIP key，折叠区冗余且正是可读性抱怨来源）。

选前端 TS 而非后端 JSON contract 的理由：标签只被前端渲染消费，放消费侧避免双份；后端测试只读不写，不引入跨包写入耦合。删原始 JSON 的理由：调试价值低于可读性成本，结构化卡片已是完整呈现。
