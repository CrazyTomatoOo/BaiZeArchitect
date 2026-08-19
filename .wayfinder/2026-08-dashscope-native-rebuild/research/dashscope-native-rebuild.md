# DashScope 原生重建可行性核查（pi-ai 0.83）

## 结论 gist

- 完全用 pi-ai 0.83 **内置** provider 替代 `bailian` 是**部分可行**：`glm-5.2` 已存在于 `qwen-token-plan(-cn)` 原生静态目录；但 `qwen-max` 不在任何内置目录，必须保留 overlay。
- 推荐重建路径：
  - 方案 A（内置 provider）：`qwen-token-plan-cn`（或 `qwen-token-plan`），对应 Aliyun MaaS token-plan 端点；把 `qwen-max` 作为 overlay model 补进去。
  - 方案 B（自定义 provider）：继续用 `createProvider({ id: "bailian", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", api: openAICompletionsApi(), models: [...] })`，这是 pi-ai 原生能力，不是内置 catalog。
- 关键差异：环境变量从 `DASHSCOPE_API_KEY` 变为 `QWEN_TOKEN_PLAN_API_KEY` / `QWEN_TOKEN_PLAN_CN_API_KEY`；`glm-5.2` 原生参数（contextWindow/maxTokens/thinkingLevelMap）与当前 `bailianModels` 不一致；`qwen-max` 无原生条目。
- 回归风险：auth 切换、端点域名变化、模型能力元数据变化、reasoning 参数格式差异、`response_format` 未在 bridge 中实现。

---

## Q1. `qwen-token-plan(-cn)` 的 baseUrl 与现役 `dashscope.aliyuncs.com/compatible-mode/v1` 是否同一协议族/等价端点？

**结论：协议相同（OpenAI-compatible `/compatible-mode/v1`），但端点不等价。**

1. `qwen-token-plan` 与 `qwen-token-plan-cn` 均使用 `openai-completions` 通用桥，baseUrl 分别为：
   - `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`
   - `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
   - 来源：`agent-runtime/node_modules/@earendil-works/pi-ai/dist/providers/qwen-token-plan.js:8-15` 与 `qwen-token-plan-cn.js:8-15`。
2. 现役 `bailian` baseUrl 是 `https://dashscope.aliyuncs.com/compatible-mode/v1`（`agent-runtime/model-config.ts:18`）。路径都是 `/compatible-mode/v1`，`openai-completions` 桥也都把 `model.baseUrl` 直接传给 OpenAI SDK（`agent-runtime/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:506`），所以**协议层等价**。
3. 但 provider id、认证环境变量、静态 catalog 均不同：
   - `qwen-token-plan` 系列走 `QWEN_TOKEN_PLAN_API_KEY` / `QWEN_TOKEN_PLAN_CN_API_KEY`（`agent-runtime/node_modules/@earendil-works/pi-ai/dist/env-api-keys.js:74-75`）。
   - 原生 catalog 只包含特定模型（见 Q2），而当前 `bailian` 的 `qwen-max` 不在其中（见 Q2）。
4. 因此 pi-ai 视角下二者不是“等价端点”：切换会改变 provider id、认证变量和可用模型集。

---

## Q2. `glm-5.2` 是否存在于原生静态 catalog？若否，minted overlay 能否无损承载？

**结论：`glm-5.2` 已存在于 `qwen-token-plan` 与 `qwen-token-plan-cn` 原生静态目录；`qwen-max` 不存在，需要 overlay。**

1. `glm-5.2` 原生条目（`qwen-token-plan-cn` 示例）：
   - `id`: `glm-5.2`，`api`: `openai-completions`，`provider`: `qwen-token-plan-cn`
   - `baseUrl`: `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
   - `compat`: `{ thinkingFormat: "qwen", supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: true }`
   - `thinkingLevelMap`: `{ minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" }`
   - `contextWindow`: `1000000`，`maxTokens`: `131072`
   - 来源：`agent-runtime/node_modules/@earendil-works/pi-ai/dist/providers/data/qwen-token-plan-cn.json`（`glm-5.2` 键）。
2. `qwen-max` 未出现在任何内置 catalog：在 `agent-runtime/node_modules/@earendil-works/pi-ai/dist/providers/data` 下搜索无匹配（`grep -r qwen-max` 无结果）。
3. `createProvider` 支持通过 `models` 数组传入完整 model 定义：
   - `CreateProviderOptions.models: readonly Model<TApi>[]`（`agent-runtime/node_modules/@earendil-works/pi-ai/dist/models.d.ts:151`）。
   - `Model` 接口允许设置 `compat`、contextWindow、maxTokens、thinkingLevelMap 等字段（`agent-runtime/node_modules/@earendil-works/pi-ai/dist/types.d.ts:649-666`）。
4. 因此：
   - `glm-5.2` 可以直接用内置 provider，无需 overlay。
   - 如果要**精确保持当前 `bailianModels` 的元数据**（contextWindow 1048576、maxTokens 16384、自定义 thinkingLevelMap），可以通过 overlay 覆盖原生条目；`openai-completions` 桥会按 model 级 `compat` 覆盖自动探测结果（`openai-completions.js:1199-1226`）。
   - `qwen-max` 必须 mint overlay，形状与当前 `bailianModels[1]` 一致即可。

---

## Q3. `openai-completions` 对 DashScope 风格端点的 compat 自动探测行为

**结论：默认按“泛 OpenAI 兼容”处理；不识别 `dashscope`/`maas` 特殊语义，需要靠 model 级 `compat` 覆盖。**

1. 自动探测入口 `detectCompat(model)`：先读 `model.provider` 和 `model.baseUrl`，按 provider / URL 子串匹配（`openai-completions.js:1118-1168`）。
2. 对于 `provider === "bailian"` 或 `baseUrl.includes("dashscope.aliyuncs.com")` 的情况，源码中**没有任何特殊分支**，因此全部走默认分支：
   - `supportsStore: true`
   - `supportsDeveloperRole: true`
   - `supportsReasoningEffort: true`
   - `maxTokensField: "max_completion_tokens"`
   - `thinkingFormat: "openai"`
   - `supportsUsageInStreaming: true`
   - `supportsStrictMode: true`
   - `supportsOpenAIGrammarTools: false`
   - 来源：`agent-runtime/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:1118-1168`。
3. **developer role**：在 `convertMessages` 中，若 `compat.supportsDeveloperRole` 为 true 且 `model.reasoning` 为 true，system prompt 会转成 `role: "developer"`；否则用 `role: "system"`（`openai-completions.js:793-795`）。默认 DashScope 风格端点会被探测为 `supportsDeveloperRole: true`，可能发送 `developer` 角色。
4. **reasoning-effort 参数映射**：默认 `thinkingFormat === "openai"`，因此当 `model.reasoning === true` 且 `options.reasoningEffort` 存在时，bridge 会直接发送顶层 `reasoning_effort`（`openai-completions.js:638-641`）。如果 model 级 `compat` 设为 `thinkingFormat: "qwen"`，则会改为发送 `enable_thinking` + `reasoning_effort`（`openai-completions.js:571-578`）。
5. **response_format**：在 `openai-completions.js` 全文中搜索 `response_format` **无匹配**。该 bridge 不实现 OpenAI `response_format`/`json_schema` 输出约束；结构化输出当前通过 grammar 工具约束实现（`agent-runtime/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:10-11`）。

---

## Q4. 重建路径可行性、provider id/baseUrl/models overlay 清单、残余点与回归风险

### 推荐重建方案

| 项目 | 取值 |
|---|---|
| provider id | `qwen-token-plan-cn`（国内）或 `qwen-token-plan`（海外） |
| baseUrl | `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` 或 `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` |
| api | `openai-completions`（已内置绑定） |
| auth env | `QWEN_TOKEN_PLAN_CN_API_KEY` / `QWEN_TOKEN_PLAN_API_KEY` |
| 已有模型 | `glm-5.2`（原生目录已有） |
| 必须 overlay | `qwen-max`（任何内置目录均无此 id） |
| 可选覆盖 | 若要保持当前 `bailianModels` 的 contextWindow=1048576 / maxTokens=16384 / thinkingLevelMap，则覆盖原生 `glm-5.2` |

### 备选方案 B：保留 `bailian` 自定义 provider

若不想切换域名/认证变量，可直接用 pi-ai 的 `createProvider`：

```ts
import { createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

const bailian = createProvider({
  id: "bailian",
  name: "BaiLan / DashScope",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  auth: { apiKey: envApiKeyAuth("DashScope API key", ["DASHSCOPE_API_KEY"]) },
  models: bailianModels, // 当前 overlay
  api: openAICompletionsApi(),
});
```

这在技术上完全可行（`createProvider` 是 pi-ai 原生公开 API，`agent-runtime/node_modules/@earendil-works/pi-ai/dist/models.d.ts:158`），只是未使用内置 provider catalog。

### 必须保留自定义注册的残余点

1. **认证变量**：切换到内置 provider 时必须把 `DASHSCOPE_API_KEY` 迁移到 `QWEN_TOKEN_PLAN_CN_API_KEY` / `QWEN_TOKEN_PLAN_API_KEY`。
2. **`qwen-max` overlay**：无论走内置还是自定义 provider，`qwen-max` 都要显式提供 model 定义。
3. **`glm-5.2` 能力元数据对齐**：原生 `glm-5.2` 的 contextWindow、maxTokens、thinkingLevelMap 与当前 `bailianModels` 不同；若要求行为一致，需要覆盖。
4. **`response_format` 缺失**：如果当前或未来依赖 OpenAI `response_format`，`openai-completions` bridge 不实现，需要另外处理。

### 回归风险面

1. **Auth/部署风险**：环境变量名称改变，部署脚本/密钥管理需要同步更新；遗漏会导致 provider unconfigured。
2. **端点/可用性风险**：`token-plan.*.maas.aliyuncs.com` 与 `dashscope.aliyuncs.com` 的模型可用性、计费、地域策略可能不同，pi-ai 源码无法保证等价。
3. **模型元数据漂移**：原生 `glm-5.2` 的 `maxTokens` 为 131072（当前为 16384），thinkingLevelMap 只支持 `high`/`max`（当前映射 `low/medium/high→high`，`xhigh/max→max`）。切换后会改变 token 预算和 reasoning 档位行为。
4. **reasoning 参数格式差异**：内置 `qwen-token-plan-cn` 对 `glm-5.2` 使用 `thinkingFormat: "qwen"`（发送 `enable_thinking`），而当前 `bailian` overlay 未指定 `thinkingFormat`，默认走 `openai` 风格（仅顶层 `reasoning_effort`）。DashScope 后端对两种格式的接受度需要运行时验证。
5. **provider/modelId 记录变化**：usage / telemetry 中的 `provider` 字段从 `bailian` 变为 `qwen-token-plan-cn`，下游按 provider 聚合/过滤的逻辑需要同步。
6. **`response_format` 未实现**：如果未来需要 JSON schema / 结构化输出约束，当前 bridge 不支持，可能需要工具侧 fallback。
