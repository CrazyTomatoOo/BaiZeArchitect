# Model layer on pi-ai native multi-provider

Status: accepted（决议来源 wayfinder 2026-08「pi-ai 多提供方模型层」，7 张票闭环：research ×1 / grilling ×3 / prototype ×1 / task ×2；实现即「执行管线与 usage 身份落地」落地）

The model layer was a single hardcoded provider (bailian = DashScope openai-completions, two models) while pi-ai 0.83 already ships 38 native chat providers; every roll-out beyond DashScope would have meant hand-maintained provider glue. Decision: **模型层全面走 pi-ai 原生能力** —— 配置声明的精选模型目录（配置即真相），部署级默认模型档（按角色 → (provider, modelId)，仅启动时生效、执行期零回退）与需求级模型档（创建时携带、创建后不可改）并存；密钥只走每 provider 环境变量；现役 bailian 自定义注册重建到原生（qwen-token-plan-cn，glm-5.2 元数据 overlay + qwen-max overlay）。

Decision details:

- **Catalog as config.** `model-config-v1` 契约资产声明 `providers[]`（id / baseUrl? / authEnv? / models[] 全量 Model 声明）+ `defaultRoles`（四角色）。支持的 provider = pi-ai 运行时注册表（原生 38 + 配置覆盖注册）；可选的模型 = 配置声明目录，目录之外即非法。boot 结构校验 fail-fast（provider 注册、模型在目录、四角色全覆盖）；密钥缺失不阻塞启动（无 key 冒烟路径保留），首次执行报明确错误。
- **Profile semantics.** 部署默认档固化在 ModelConfig；create-requirement 可选携带需求级档（API 字段 modelRoles，与术语 Model Profile 对齐），提供即须全量四角色、缺项拒绝（400 invalid_model_roles + detail），创建后不可改（换档 = 新建需求）。执行期解析 = 需求档 ?? 默认档，零回退（解析失败即抛错，无静默降级）。
- **Identity in usage.** token run 事件携带 provider + modelId（原 model_tokens 事件归一为 token，历史流不重写），workflow_created 事件记档需求级档；usage 可跨提供方对账。
- **Auth.** 密钥只走每 provider 环境变量（QWEN_TOKEN_PLAN_CN_API_KEY / ANTHROPIC_API_KEY / …），配置文件与 DB 不落 key；authEnv 覆盖可保留 dashscope 域名 + DASHSCOPE_API_KEY 的备份路径。

Considered Options:

- **保留 bailian 自定义注册**（createProvider + dashscope 域名 / DASHSCOPE_API_KEY）——技术上完全可行且零迁移，但放弃 pi-ai 原生目录与多提供方杠杆；作为 baseUrl/authEnv 覆盖的备份路径保留，不作为默认。否决。
- **全量注册表面**（38 provider × 各目录全可选）——选择器/校验/定价均不可控。否决；目录面收敛为配置声明。
- **热重载 / 运行时切换**（运行期重应用配置）——状态可变 + 并发窗口，且与「生产不可经 env/HTTP 选测试驱动」的既有契约精神冲突。否决；仅启动时读取。
- **每 operator / 每租户默认档**——在需求级档之上再加维度，v1 未达，留作未来 effort。否决入 v1。
- **创建后可改档**——需新命令/事件/审批面，范围膨胀。否决；换模型 = 新建需求。
- **结构化输出依赖 response_format**——openai-completions bridge 未实现 response_format；结构化输出经 grammar 工具约束，模型可选面须与之兼容（per-model compat 覆盖 thinkingFormat 等）。

Consequences:

- 认证环境变量从 DASHSCOPE_API_KEY 迁移到 QWEN_TOKEN_PLAN_CN_API_KEY 等每 provider 绑定；部署脚本需同步。
- 创建面 breaking（body `{baseline, modelRoles?}`）；SPA 创建表单获 B 紧凑表模型档选择器与 GET /api/model-config 目录端点。
- 模型元数据（contextWindow / maxTokens / thinkingLevelMap）以配置声明为准，原生目录漂移由 overlay 吸收；结构化输出约束 = grammar 工具面。
- network-none 冒烟保持无 key 启动；执行期密钥缺失为明确错误，零回退。
- 验证：后端 292 测试 + test:contracts 33 + typecheck 绿；web vitest 52 + e2e 66（三视口）+ build 绿；契约双胞胎字节一致。