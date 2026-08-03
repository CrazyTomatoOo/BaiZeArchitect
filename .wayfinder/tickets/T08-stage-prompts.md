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
- 真根因(非模型能力):模型把 assets 当 **JSON 字符串**提交(双重编码),writeStageAssets 拿到 string→a.scenarios undefined→refs 空。
- 修复:tool execute 里 typeof a==="string" 则 JSON.parse;阶段 run 用 qwen-max(BAIZE_STAGE_MODEL)+ 仅 submit_stage_assets 工具(强制调用)。
- 验证:scenario 阶段 run 抓到 4 条场景入 store(场景=待审+refs)。模型问题解决。
- 保留 extractJson/lastAssistantText/转换 pass 作兜底。
