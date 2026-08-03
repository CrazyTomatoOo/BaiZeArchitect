# T08 — 各阶段 LLM 抽取 prompts/skills `wayfinder:research`

status: open
assignee: (unclaimed)
blocked-by: T07

## Question

每阶段 agent 用什么 prompt/skill 从需求+repo 证据抽取资产:

- 场景分析:从需求+架构证据抽"场景"(用户/系统交互情境)的 prompt 结构。
- 用例分析:场景→用例(前置/主流程/异常/后置)的 prompt。
- 功能分解:用例→功能域/功能项(职责边界)的 prompt。
- 是否复用 .pi/skills(analyst/architect)扩展为 stage skills;输出 JSON schema 与 T01 对齐。

产出:每阶段 prompt/skill 草案 + 抽取质量评估(用 lws 需求试跑)。/research。
