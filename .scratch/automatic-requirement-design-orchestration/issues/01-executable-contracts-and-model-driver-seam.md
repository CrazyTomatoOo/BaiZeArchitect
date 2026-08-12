# 01 — 让 Workflow 契约可执行并建立确定性 ModelDriver 接缝

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 建立自动 Workflow 的可执行契约入口和唯一模型驱动接缝，使生产装配只能使用 Pi Model Driver，而无网络、无 API Key 的测试装配可以用严格的 Scripted Model Driver 重现角色、上下文、工具和结果交互。

**Blocked by:** None — can start immediately

**Status:** completed

- [x] 所有 Wayfinder 机器契约都可由同一契约加载器解析、按版本识别并完成交叉引用校验；未知版本和不一致引用明确失败。
- [x] 生产装配只能构造 Pi Model Driver；环境变量、HTTP 请求或生产配置均不能选择 Scripted Model Driver。
- [x] Scripted Model Driver fixture 精确声明角色、Context digest、工具调用顺序与参数、结构化结果及可选 Crash Point。
- [x] 角色错误、digest 错误、工具少调/多调/错序/错参或额外调用都会使测试立即失败。
- [x] 测试可注入固定 Clock、ID、Digest、Repository Snapshot、Actor、模型用量、Outbox transport 和 Crash injector。
- [x] 相同 seed 与输入产生字节稳定的 fixture 输出，且全部测试在断网、无模型凭据环境通过。
