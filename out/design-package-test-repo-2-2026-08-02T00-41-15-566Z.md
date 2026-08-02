# 订单查询接口采用"领域服务 + Repository 接口 + 稳定二元组游标"的分层方案

> 审批状态: accepted
> 仓库当前为空白订单领域：需新建 Order 模型、仓储接口、游标编码器与查询服务，并保持与 UploadService/Handler 一致的包内风格

## 上下文
仓库 test-repo-2 是一个极简 Go 项目（commit 40c7a18），当前仅包含两个源文件：src/UploadService.go 定义了 `UploadService` 结构体及其 `Retention() int` 方法（返回固定值 7，体现"租户感知的上传保留策略"）；src/caller.go 定义了 `Handler` 结构体，其 `Process()` 方法通过 `UploadService{}` 调用 `Retention()`，作为影响分析的调用方示例。仓库尚未建立订单（Order）领域模型、仓储层（Repository）、数据访问或任何 HTTP/gRPC 接口层，也没有分页/过滤相关的基础设施。需求要求"为订单服务新增一个支持条件过滤与游标分页的查询接口"，属于在空白领域上的全新功能搭建，需要从领域模型到接口暴露的完整链路设计。

## 需求
- 变更请求: 为订单服务新增一个支持条件过滤与游标分页的查询接口
- 仓库: test-repo-2 @ 40c7a188e6c9b11da308f191cd44f947a7640669
### 验收条件
- 提供订单查询接口，支持按订单状态(status)、租户ID(tenant_id)、下单时间范围(created_at 区间)等条件进行过滤
- 采用游标分页(cursor-based pagination)，而非偏移分页(offset pagination)；响应需返回下一页游标(next_cursor)，当无更多数据时游标为空
- 游标需为不透明、可还原的编码字符串(如 base64(JSON))，且排序字段稳定(默认按 created_at DESC, id DESC)，避免分页出现重复或遗漏数据
- 接口返回结构包含 items 列表、next_cursor、has_more 字段；每页条数可由调用方指定并设置上限(max page size)
- 新增 Order 领域模型与仓储接口(Repository)，保持与现有 UploadService 风格一致的包内组织
- 查询逻辑对过滤条件做参数校验与白名单控制，避免注入与非法字段排序
- 为查询接口提供可测试的单元测试，覆盖过滤组合、边界(空结果、最后一页、游标还原)等场景

## 架构
- 组件: Order 领域模型(src/order.go)：定义 Order 结构体(id, tenant_id, status, amount, created_at, updated_at) 与订单状态枚举, OrderQueryFilter(src/order_query.go)：过滤条件值对象，含 status/tenant_id/created_at_from/created_at_to/排序方向/页大小，封装校验与白名单, Cursor(src/cursor.go)：游标编解码器，base64(JSON{last_created_at,last_id})，提供 Encode/Decode 与空值处理, OrderRepository 接口(src/order_repository.go)：抽象仓储，方法 Query(ctx, filter, cursor) (items, nextCursor, error)，便于后续替换实现, OrderQueryService(src/order_service.go)：应用服务，编排 filter 校验、cursor 解码、调用 Repository、生成 next_cursor，与 UploadService 风格保持一致, HTTP Handler(src/order_handler.go)：暴露 GET /orders 查询接口，解析 query string 为 filter+cursor，返回 {items,next_cursor,has_more}, Repository 实现(src/order_repository_impl.go)：基于具体存储(默认内存 map / 可替换为 SQL)实现稳定排序与游标查询, 单元测试(src/order_service_test.go, src/cursor_test.go)：覆盖过滤组合、游标往返、边界场景
- 质量属性: 可测试性：OrderRepository 为接口，OrderQueryService 依赖抽象，可注入内存实现进行单测, 可扩展性：filter 字段通过结构体聚合，新增过滤条件不需改方法签名；Repository 可替换为 SQL/NoSQL 实现, 稳定性/正确性：游标基于(created_at, id)二元组稳定排序，避免分页重复/遗漏；page size 设上限防止过大查询, 安全性：过滤字段白名单校验，游标为受信 base64 编码并做解码失败容错，防止注入与篡改, 一致性：沿用现有 Go 包风格(src 包)，命名与服务结构对齐 UploadService/Handler 模式, 可观测性：查询接口记录 filter/cursor/返回条数，便于排查分页问题

## REST API
- GET /orders?status=&tenant_id=&created_at_from=&created_at_to=&sort=&page_size=&cursor= — 查询订单列表，支持条件过滤与游标分页；响应体: {"items":[Order], "next_cursor":"base64...", "has_more":bool}；当为最后一页时 next_cursor 为空字符串
- Order 字段示例: {"id":"string","tenant_id":"string","status":"pending|paid|cancelled|...","amount":123.45,"created_at":"RFC3339","updated_at":"RFC3339"}
- 游标语义: cursor 为不透明 base64(JSON{last_created_at,last_id})；调用方原样回传以获取下一页；不可手工构造
- 错误响应: 400(过滤参数非法/游标解码失败)、422(page_size 超上限)、500(仓储异常)

## 数据设计
- 数据库: 初始采用内存实现(map)，仓储接口抽象使后续可平滑迁移至 SQL(如 PostgreSQL/MySQL)；游标与过滤逻辑不依赖具体存储
- 表: orders(id VARCHAR PK, tenant_id VARCHAR NOT NULL INDEX, status VARCHAR NOT NULL INDEX, amount DECIMAL NOT NULL, created_at TIMESTAMP NOT NULL INDEX, updated_at TIMESTAMP NOT NULL) — 建议复合索引 (tenant_id, status, created_at DESC, id DESC) 以支撑游标分页稳定排序与过滤组合查询, order_cursor(逻辑结构, 非物理表): {last_created_at TIMESTAMP, last_id VARCHAR} — 经 base64(JSON) 编码为不透明游标字符串，不落库

## 证据
- `src/UploadService.go` L1-4 (UploadService.go.UploadService)
- `src/UploadService.go` L4-4 (UploadService.go.Retention)
- `src/caller.go` L1-7 (caller.go.Handler)
- `src/caller.go` L3-7 (caller.go.Process)

## 评审发现 (critic 独立 challenge)
- [high/high] 证据行号不准确：evidenceCandidates 中 'Retention' 标注 lineStart=4,lineEnd=4，但 src/UploadService.go 中 Retention 方法实际位于第 6 行（第 4 行是 `type UploadService struct{}`）；'Process' 标注 lineStart=3,lineEnd=7，但 Process 方法实际跨越第 6–9 行，标注区间 3-7 漏掉了第 8 行 `return s.Retention()` 与第 9 行 `}`。证据区间与真实符号位置不符，违反“禁止编造证据”约束。 → 更正 Retention 证据为 lineStart=6,lineEnd=6；Process 证据为 lineStart=6,lineEnd=9（或含注释 lineStart=3,lineEnd=9）。重新核验所有 evidenceCandidates 的行号区间后再提交。
- [high/high] 遗漏 Go 模块/服务引导：仓库当前仅有 src/UploadService.go 与 src/caller.go 两个文件，无 go.mod、无 go.sum、无 main 包、无任何 HTTP 服务启动入口。架构方案新增了 order_handler.go(GET /orders) 等文件，但未说明 go.mod 模块路径初始化与 main/server bootstrap，导致“提供订单查询接口”这一验收条件在当前仓库上无法直接构建运行。 → 在 components 中显式补齐 go.mod（如 module test-repo-2 / go 1.21）与 cmd/server/main.go（net/http.ListenAndServe 注册 /orders 路由）作为前置任务，并标注为新建基础设施。
- [medium/medium] “与 UploadService/Handler 风格一致”表述过强：现有代码采用值接收者、无 context.Context、无 error 返回、无接口、无导入的扁平极简风格；而方案引入 OrderRepository 接口、OrderQueryService(ctx, filter, cursor)、值对象 Cursor/OrderQueryFilter、HTTP Handler，分层与依赖显著 richer，与现有风格存在实质差异（context 贯穿、接口抽象、错误返回均未在现有代码出现）。 → 将 qualityAttribute 措辞改为“在 src 包内组织、命名沿用 UploadService/Handler 习惯”，而非声称整体风格一致；并在决策中显式承认这是从扁平结构向分层结构的演进，列出风格迁移点（值/指针接收者、ctx 传递、error 处理）。
- [medium/medium] Order 主键 id 为 string 但未指定生成策略（UUID/雪花/业务号）；数据设计声明 amount 为 DECIMAL，但 Go 无原生 decimal 类型，未说明采用 float64、shopspring/decimal 还是 int 分表示，存在模型与实现不一致风险；内存 map 仓储未提及并发安全（sync.RWMutex），分页查询与并发写入可能产生竞态。 → 明确 id 生成策略（建议 UUID 或时间序字符串）；在 Order 模型中指定 amount 的 Go 类型（推荐 int64 分表示或引入 decimal 库并加入 go.mod 依赖）；内存仓储实现注明加锁策略。
- [low/medium] 排序白名单与 page size 上限的具体取值未给定：验收要求“避免注入与非法字段排序”及“设置上限(max page size)”，方案仅笼统称白名单校验，未列出允许排序字段集合（created_at? id? status?）与 max page size 具体数值（如 100/500），易在实现阶段产生歧义。 → 在 OrderQueryFilter 设计中显式列出允许的 sort 字段白名单与方向枚举（ASC/DESC），并给出 max page size 常量默认值与超限 422 行为的明确边界。
> 需求覆盖在组件层面基本完整（Order 模型、QueryFilter、Cursor、Repository 接口、QueryService、HTTP Handler、测试、数据索引与游标语义均与七条验收条件对应），但存在两类需修正的问题：(1) 证据充分性问题——Retention 与 Process 两个 evidenceCandidates 的行号区间与仓库真实行号不符（Retention 实为第6行而非第4行；Process 实为6-9行而非3-7行），属证据不实，须更正后方可进入审批；(2) 设计遗漏——仓库当前无 go.mod、无 main 包、无 HTTP 服务入口，方案未补齐模块初始化与服务 bootstrap，且“与 UploadService 风格一致”表述过强（现有为扁平值接收者无 ctx 风格，方案为分层接口+ctx 风格，实质为风格演进），同时 id 生成策略、amount 的 Go 类型与内存仓储并发安全均未明确。建议修正证据行号、补齐 go.mod 与 main 引导、收敛风格一致性表述、明确 id/amount/锁/排序白名单/上限取值后再提交人工审批。
