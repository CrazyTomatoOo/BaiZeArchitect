# Agent execution layer on real pi-agent capabilities

Status: accepted（决议来源 wayfinder 图 #28「重构 agent 执行层真正用 pi-agent」,T2 grilling 票闭环）

The production model executor (`main.ts:createPiExecutor`) used pi-agent as a zero-tool thin wrapper: `createAgentSession({ tools: [] })`, `void _tools`, then manually `JSON.parse` the last assistant message text (fallback `{raw: text}`). pi-agent's tool system, structured output, streaming, and events were all idle; the no-bash constraint was enforced by system-prompt self-discipline, and token usage was read from a non-existent `session.state.usage` field (pi-agent 0.83 has none) — a latent bug returning 0. Decision: **升级执行层为真正使用 pi-agent SDK 能力** —— 角色会话用受限只读探查工具获取真实仓库事实,以**终止型工具**(`terminate:true` 的 `submit_role_result`)结构化产出 RoleResult,工具执行/轮次事件透到前端双 SSE 流。

Decision details (T2 grilling 五决议):

- **Q2.1/A 域抽象 + 装配层适配**:`ModelDriver` 接口保持 `ModelTool[]` 域薄抽象(`{ name, execute(args): Promise<unknown> }`),不耦合 pi-coding-agent SDK 类型;`pi-model-driver.ts` 装配层负责 `ModelTool → ToolDefinition` 适配(加 TypeBox 参数 schema、包装 `AgentToolResult` 返回)。理由:域抽象不泄漏 SDK;`ScriptedModelDriver` 已有 `ModelTool[]` 形参,接口契约最小动;`production-model-boundary.test` 仅禁生产 import `ScriptedModelDriver`,不限 `ModelTool`。
- **Q2.2/A 终止优先 + 文本回退**:`ModelDriverResult.structuredResult` = 终止工具 `details` 载荷优先;无终止工具调用时回退末条文本 `JSON.parse`(保留 `{raw}` 兜底)。加 `terminationTool?: string` 标记来源。理由:强制结构化破坏过渡期所有角色;保留回退让增量迁移。`buildTaskInstruction` 末尾"输出纯 JSON"段改为"调用 submit_role_result 工具提交结果"。
- **Q2.3/B 全量 pi-ai Usage 字段**:`ModelUsage` 扩展 `reasoningTokens?`/`cacheReadTokens?`/`cacheCreationTokens?`/`cost?` 等 pi-ai Usage(types.d.ts:283-304)全集,取法改走 `session.getSessionStats()`(修复 `state.usage` 恒返 0 的 latent bug)。新字段可选、向后兼容。理由:`getSessionStats()` 已提供这些,不取是浪费;可选字段不破坏旧事件消费。
- **Q2.4/C input 加 toolNames**:`ModelDriverInput` 加 `toolNames?: string[]`(角色 Skill 声明可调工具白名单,属 Role Contract 的工具权限具体化),装配层按名解析成 `ToolDefinition[]` 传 pi-agent;`headless-runtime.executeTask` 当前硬编码 `[]`(line 362)改为按角色契约填 `toolNames`。理由:工具集归属是角色契约,不是 headless-runtime 域;headless-runtime 只传声明、装配层解析——解耦。
- **Q2.5/B 不动 ScriptedModelStep**:`ScriptedModelDriver` 已支持 `ScriptedToolCall { name, arguments }` + `orderedToolCalls` + `tool_mismatch`/`tool_arguments_mismatch` 校验;终止工具调用计入 `orderedToolCalls` 即可,不扩 `ScriptedModelStep`。理由:测试基设最小动;`tool_mismatch` 已覆盖"该调没调"。

Considered Options:

- **直接耦合 SDK 类型**(ModelDriver.execute 收 ToolDefinition[])——类型最直接但域抽象泄漏 pi-coding-agent,ScriptedModelDriver 依赖 SDK 类型。否决。
- **仅终止工具 details**(无终止工具 = 错误)——强制结构化,破坏过渡期所有角色现有产出。否决;保留文本回退。
- **保持四字段 ModelUsage**——不取 getSessionStats() 的 cost/cache 维度,计费精度丢失。否决;全量扩展。
- **装配层闭包持有工具集**——不可按角色配置工具白名单。否决;toolNames 进 Role Contract。
- **headless-runtime 注册表**——工具集进域层,与装配层职责混淆。否决。
- **ScriptedModelStep 加 terminationTool 字段**——与 orderedToolCalls 重复。否决。

Consequences:

- `ModelDriver` 接口签名扩展(`ModelDriverInput.toolNames?`、`ModelDriverResult.terminationTool?`、`ModelUsage` 新可选字段);`production-model-boundary.test` 不破(不涉及 ModelTool/ScriptedModelDriver)。
- 装配升级改动面(graduate 为 task 票):inMemory SessionManager 接入(修默认持久化盘写泄漏)、usage 取法 `getSessionStats()`、customTools 接线、`submit_role_result` 终止工具、`buildTaskInstruction` 末段改写。
- usage 事件 schema 加可选字段(cost/cache/reasoning),向后兼容;#1/#16 usage 事件消费面零回归。
- 工具壳 = 进程内 `@ladybugdb/core` 绝对路径 import + readOnly Kuzu open(T0 决,扩 `extract-architecture.cjs` 模式),无 spawn、无新原生依赖、无写副作用。
- CONTEXT.md 加两新域词(Restricted Domain Tool / Terminating Tool)并修订 Model Usage 描述。
