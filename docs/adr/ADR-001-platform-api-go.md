# ADR-001：M1 Platform API 采用 Go

## 状态

ACCEPTED

## 日期

2026-07-18

## 背景

M1 的目标是先交付平台骨架与契约承载能力，范围包括项目、需求版本、仓库绑定、DesignRun 状态机、Artifact 版本、DecisionRecord、Finding、Design Package manifest 和事件日志。

当前尚未接入真实企业仓库，也不做完整 Agent 智能生成。因此 Platform API 的首要诉求是：工程轻量、状态机清晰、契约测试简单、部署成本低，并且后续可以与独立 Python Agent Runtime 解耦。

## 决策

M1 Platform API 采用 Go 实现。

技术基线：

- Go 1.23+。
- HTTP：gin，除非后续团队明确要求 chi。
- 数据访问：sqlc + pgx/v5。
- 数据库迁移：goose。
- 日志：标准库 `log/slog`。
- 配置：caarlos0/env/v11。
- 测试：标准库 testing + testify/require，后续集成 testcontainers。
- 质量门禁：gofumpt、golangci-lint v2、nilaway、go test -race -shuffle=on -count=1。

## 理由

- M1 是平台骨架和状态治理，Go 单二进制部署和工程约束适合快速落地。
- DesignRun 状态机、Artifact Store、Decision Store、Evidence Adapter 都可以用小接口和明确数据结构表达。
- Go 与 PostgreSQL、sqlc、pgx 的组合能形成强约束数据访问层，避免手写 SQL 映射漂移。
- Go 服务可以通过稳定 HTTP API 与后续 Python Agent Runtime 解耦。
- 当前无真实企业试点仓，Go 能降低平台骨架试错成本。

## 后果

正向后果：

- M1 骨架可以快速启动。
- API-first 与契约测试成本低。
- 部署和运维简单。
- Agent Runtime 可作为独立 Python 服务后接入。

负向后果：

- 如果企业已有强 Spring Boot 平台能力，Go 会增加一条技术栈。
- Go 的类型系统不提供原生 sum type 和 exhaustiveness，需要依赖严格 lint 与代码模式。
- 复杂企业权限、审计、SSO 可能需要额外平台集成工作。

## 约束

- M1 不把 Agent Runtime 写进 Platform API。
- M1 不手写复杂 SQL 映射，数据库访问使用 sqlc。
- M1 所有状态变化必须写入 `design_event`。
- M1 只接入 M0 Evidence Adapter，不直接绑定未来 Code Knowledge Service 的实现细节。

## 复审触发条件

- 企业平台强制要求 Java/Spring Boot 技术栈。
- M1 进入多租户、SSO、企业审计深度集成阶段。
- Go 版本的团队维护能力不足。
- Agent Runtime 与 Platform API 之间出现大量同步调用和事务耦合，导致服务边界失效。
