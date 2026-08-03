# T08 — 各阶段 LLM 抽取 prompts/skills `wayfinder:research`

status: closed
assignee: pi(research done)
blocked-by: T07

## Question

每阶段 agent 用什么 prompt/skill 从需求+repo 证据抽取资产:

- 场景分析:从需求+架构证据抽"场景"(用户/系统交互情境)的 prompt 结构。
- 用例分析:场景→用例(前置/主流程/异常/后置)的 prompt。
- 功能分解:用例→功能域/功能项(职责边界)的 prompt。
- 是否复用 .pi/skills(analyst/architect)扩展为 stage skills;输出 JSON schema 与 T01 对齐。

产出:每阶段 prompt/skill 草案 + 抽取质量评估(用 lws 需求试跑)。/research。

## Resolution
- 实测 5 种提取策略,glm-5.2 均不产出可解析阶段资产(refs 空):1 直接 tool call;2 nudge 追调;3 示例 JSON prompt;4 文本回退(extractJson 解析末条 assistant 文本);5 转换 pass(散文→JSON)。
- 结论:glm-5.2 对阶段资产的结构化输出/工具调用不可靠,非 prompt 单点问题。
- 建议:换结构化输出更稳的模型(JSON mode/强 tool-calling),或独立抽取 pipeline(阶段产 markdown→强模型转 JSON);T07 pipeline 已就绪,提取器可插拔。
- cli.ts 已含 extractJson/lastAssistantText/转换 pass,换模型后即可生效。
