# 最小健康检查能力设计:内嵌轻量 HTTP 健端点 + 单元测试

> 审批状态: accepted
> 无既有 HTTP/health 基线,新增 HealthService 需与 UploadService 同包解耦

## 上下文
仓库 test-repo-2 为 Go 示例仓库(commit 40c7a18 "init"),包名 `src`,仅两个源文件:src/UploadService.go(定义 UploadService 及 Retention() 方法)与 src/caller.go(Handler.Process 调用 UploadService.Retention)。仓库索引规模 20 节点/21 边。无现成 HTTP server、无健康检查端点、无测试文件。AGENTS.md 要求改动前做影响分析并运行 detect_changes。需求:为该仓库设计一个最小健康检查能力,需引用真实代码证据并说明测试策略。

## 需求
- 变更请求: 为 test-repo-2(Go 包 src)设计最小健康检查能力:暴露一个 HTTP /healthz 端点,返回 200 + JSON {"status":"ok"};实现须复用现有包结构,不破坏 UploadService/Handler 调用链;并提供单元测试覆盖健康端点 200 路径与 UploadService.Retention 回归。
- 仓库: test-repo-2 @ 40c7a18
### 验收条件
- 新增 /healthz 端点对 GET 请求返回 HTTP 200 且 Body 为 {"status":"ok"}
- 健康检查实现位于 src 包内,与 UploadService 解耦,不修改 UploadService.Retention 既有行为(仍返回 7)
- 提供 *_test.go 单元测试:验证 /healthz 返回 200 与 JSON 体;验证 UploadService.Retention() == 7 回归
- go build ./... 与 go test ./... 全部通过
- 改动前已对 UploadService.Retention、Handler.Process 做影响分析(本仓库调用链仅 caller.go,无上游扩散)

## 架构
- 组件: src/health.go(新增):HealthService struct + HealthHandler(w http.ResponseWriter, r *http.Request),使用 net/http 标准库,无需第三方依赖;返回 200 与 application/json {"status":"ok"}, src/health_test.go(新增):httptest.NewServer + httptest.NewRecorder 驱动 /healthz 200 断言, src/UploadService.go(保持不变):UploadService.Retention 仍返回 7,作为健康检查外的回归基线, src/caller.go(保持不变):Handler.Process 维持对 UploadService 的调用,验证未引入回归
- 质量属性: 最小依赖:仅用标准库 net/http、encoding/json、net/http/httptest,无外部包, 可测试性:HealthHandler 为纯函数,httptest 驱动无网络副作用, 低耦合:HealthService 与 UploadService 同包但无调用依赖,影响面仅限新增文件, 兼容性:不修改既有符号,调用图(Handler.Process -> UploadService.Retention)保持原样

## REST API
- GET /healthz -> 200 {"status":"ok"}  (Content-Type: application/json)

## 数据设计
- 数据库: 无(纯内存 HTTP,不涉及持久化)
- 表: 无表:健康响应为固定 JSON {"status":"ok"},无数据库交互

## 证据
- `src/UploadService.go` L4-6 (UploadService.go.UploadService)
- `src/UploadService.go` L6-6 (UploadService.go.Retention)
- `src/caller.go` L6-9 (caller.go.Handler.Process)

## 评审发现 (critic 独立 challenge)
- [low/high] 证据候选 1 (UploadService.go.UploadService, lineStart=4, lineEnd=6) 行号区间越界:UploadService struct 仅在第 4 行,第 5 行为空行,第 6 行是 Retention 方法。该区间实际跨入了 Retention 符号范围,与候选 2(Retention, line 6)重叠。证据未精确对齐到 struct 声明(应为 4-4),降低可追溯性。 → 将候选 1 的 lineEnd 收敛为 4,使证据区间精确覆盖 type UploadService struct{} 声明;或显式说明 4-6 用于呈现 struct+方法上下文,避免与候选 2 重叠歧义。
- [high/high] 仓库根目录无 go.mod(GO 模块文件缺失),而验收标准明确要求 `go build ./...` 与 `go test ./...` 全部通过。在模块模式(GO111MODULE 默认 on,Go 1.16+)下,无 go.mod 时上述命令在模块外路径会报 `no go.mod` 或 `directory outside main module` 错误。架构方案未列入新建 go.mod 的组件,存在遗漏。 → 在架构 components 中补一项 `go.mod(新增):module 声明,go 版本对齐当前工具链`,并在影响分析中说明这是新增文件、不触及既有符号;或显式确认仓库预期以 GOPATH/旧模式构建(若如此,需在验收中改写为 `go build src/` 而非 `./...`)。
- [medium/high] 验收标准要求“暴露一个 HTTP /healthz 端点”,但架构方案仅新增 HealthHandler(net/http.HandlerFunc)与单元测试,未提供任何 server 入口(main 包 / http.ListenAndServe / mux 注册)。当前仓库包名为 `src` 且无 main 包,无运行时可访问端点;`/healthz` 仅在 httptest 上下文内被驱动。方案对“端点暴露”的语义(可运行服务 vs. 可测试 handler)存在模糊。 → 明确二选一并记录决策:(a) 最小范围=仅 handler + httptest 验证,不提供运行时 server,需在验收中改写“暴露端点”为“提供可挂载的 HealthHandler”;或 (b) 新增 cmd/health/main.go 调用 http.HandleFunc("/healthz", ...) + ListenAndServe 以真正暴露端点。当前方案与验收用语不一致。
- [medium/high] AGENTS.md 强制要求改动后 `detect_changes()` 验证受影响范围(且对比 base_ref main)。验收标准第 5 条仅提到改动前对 UploadService.Retention、Handler.Process 做影响分析(impact),但未纳入 detect_changes 作为提交前 gate。架构方案 qualityAttributes 也未提及 detect_changes 步骤,与 AGENTS.md 流程契约不符。 → 在验收标准追加一条:提交前运行 `detect_changes({scope:"compare", base_ref:"main"})` 并确认受影响符号集合 ⊆ {新增 HealthService/HealthHandler},无对 UploadService/Handler.Process 的意外波及。
- [low/medium] health_test.go 的组件描述同时列出 `httptest.NewServer` 与 `httptest.NewRecorder` 两种驱动方式,二者为不同测试模式(NewServer 起真实监听,NewRecorder 直驱 Handler)。方案未明确采用哪种,可能造成测试实现风格漂移与重复断言。 → 统一为 `httptest.NewRecorder` 直驱 HealthHandler(最小、无网络副作用,与“纯函数、可测试性”质量属性更一致);若需 NewServer,则单列一条用例并说明动机。
> 证据候选总体真实可复核:UploadService.go 第 4 行 struct、第 6 行 Retention,caller.go 第 6-9 行 Handler.Process 均与仓库实际一致(commit 40c7a18)。架构方案对“不破坏既有调用链、同包解耦、仅标准库”的约束把握得当,质量属性合理。但存在三项需修正:(1)无 go.mod 与 `go build/test ./...` 验收冲突(高);(2)“暴露端点”语义与仅 handler+httptest 的实现不一致,缺少 server 入口或验收改写(中);(3)AGENTS.md 的 detect_changes gate 缺失(中)。另有证据区间越界、测试驱动方式未收敛两项低风险。建议补全 go.mod、明确端点暴露决策、补 detect_changes gate 后再审。
