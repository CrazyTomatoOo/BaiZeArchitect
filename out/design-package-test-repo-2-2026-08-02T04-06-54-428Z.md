# 软删除字段落地于 UploadService 并采用 time.Time 零值判定

> 审批状态: accepted
> Retention 概念载体为 UploadService 空结构体,软删除字段应落其上且调用方零改动

## 上下文
仓库 test-repo-2 为极简 Go 项目(2 文件/2 节点),包路径 src。核心热点为 src.UploadService.Retention(高 fan_in,被 src.Handler.Process 调用),Leiden 社区 Retention/Process 内聚 1.00。当前 UploadService 是无字段空结构体,仅暴露 Retention() int 返回固定 7 天保留期;caller.go 的 Handler.Process 直接构造 UploadService{} 并调用 Retention。需求要求为"Retention 实体"增加软删除字段 deletedAt。由于仓库无独立 Retention 类型,Retention 实为 UploadService 的方法/概念载体,因此软删除字段应落在 UploadService 结构体上(命名为 DeletedAt,符合 Go 导出约定)。无历史 ADR,无 git 可用(commitSha 以 HEAD 标记)。

## 需求
- 变更请求: 为 Retention 实体增加软删除 deletedAt 字段
- 仓库: test-repo-2 @ HEAD
### 验收条件
- UploadService 结构体新增导出字段 DeletedAt(类型 time.Time,零值表示未删除),承载 Retention 概念的软删除状态
- 软删除语义通过零值判定(isZero),无需额外 bool 标志,符合 Go 惯例
- Retention() 方法语义保持向后兼容(仍返回保留天数),软删除字段不破坏现有调用方 Handler.Process
- caller.go 中 UploadService{} 的构造点显式考虑 DeletedAt 的零值语义,无需强制初始化
- 新增字段命名采用 DeletedAt 而非 deletedAt,满足 Go 导出约定与跨包可见性(当前为包内引用,但保留扩展性)

## 架构
- 组件: src.UploadService:承载 Retention 概念的聚合根,新增 DeletedAt time.Time 字段表达软删除状态;Retention() 方法维持原返回值,后续可扩展按 DeletedAt 过滤的逻辑, src.Handler(调用方):Process 直接构造 UploadService{},因 DeletedAt 为 time.Time 零值即未删除,调用链向后兼容,无需改动业务逻辑, 软删除判定约定:以 DeletedAt.IsZero() 为未删除,true 为已软删除,形成单一事实来源,避免 bool+time 双字段冗余
- 质量属性: 向后兼容性:新增字段为值类型 time.Time,零值天然表达未删除,不破坏现有 UploadService{} 构造与 Retention() 调用, 可维护性:软删除语义集中由 DeletedAt 零值判定表达,无散落标志位, 可扩展性:导出字段 DeletedAt 为后续跨包/持久层过滤保留空间, 最小变更原则:仅触及 UploadService 结构体定义,调用方零改动

## REST API
- 本次为内部领域模型字段新增,无 HTTP/REST 接口暴露;UploadService.Retention() 仍为纯内存方法签名 func (s UploadService) Retention() int,未引入网络端点

## 数据设计
- 数据库: 无持久化数据库(当前为纯内存 Go 结构体);未来若引入持久层,建议映射为 upload_service.deleted_at TIMESTAMP NULL
- 表: (未来)upload_services:deleted_at TIMESTAMP NULL — 零值/NULL 表示未删除,非空表示软删除时间戳;查询过滤 WHERE deleted_at IS NULL

## 证据
- `src/UploadService.go` L3-6 (UploadService.go.UploadService)
- `src/UploadService.go` L6-6 (UploadService.go.Retention)
- `src/caller.go` L5-9 (caller.go.Process)
- `src/caller.go` L3-3 (caller.go.Handler)

## 评审发现 (critic 独立 challenge)
- [high/medium] 需求要求为"Retention 实体"增加软删除字段,但仓库中 Retention 仅为 UploadService 上一个返回 int(7) 的方法,并非独立实体/聚合根。架构将"Retention 概念载体"等同于"需软删除的实体"并直接在 UploadService(一个 service 结构体)上挂 DeletedAt,属于领域建模语义混淆:软删除通常落在实体/聚合根(如 Upload),而非承载策略的无状态服务。若需求中"Retention 实体"另有所指(如保留策略记录表),则该方案落点可能根本错误。需澄清需求中"Retention 实体"的确切定义,而非默认其等同于 UploadService。 → 向需求方澄清"Retention 实体"是否指独立类型(如 type Retention struct{...}),若是则应新增 Retention 类型而非污染 UploadService;若确认软删除对象为 Upload/UploadService,则在架构决策中显式记录该映射假设并标注其可逆性。
- [medium/high] 新增的 DeletedAt 字段为"孤儿字段":架构未定义任何 setter/构造器/过滤逻辑,Retention() 行为保持不变(仍返回 7),无验收标准说明 UploadService 被 soft-delete 后 Retention() 应如何表现(返回 0?返回原值?禁止调用?)。当前方案下 DeletedAt 既无法被设置(UploadService{} 零值构造、值接收者方法),也无行为效果,实质为死代码,仅满足"加字段"的字面要求而不满足软删除的语义意图。 → 补充验收标准:定义 IsDeleted()/软删除判定入口;明确 Retention() 对已删除实例的行为(如返回 0 或 panic);至少新增一处显式设置 DeletedAt 的构造路径(如 NewUploadServiceWithDeletion)或由持久层注入,使字段可被赋值与观测。
- [low/medium] 验收标准 4 表述内部张力:"caller.go 中 UploadService{} 的构造点显式考虑 DeletedAt 的零值语义,无需强制初始化" —— "显式考虑"与架构声明"调用方零改动"存在措辞冲突:若调用方零改动,则并无"显式考虑"动作;若需显式考虑,则至少需注释或构造调整。该条难以被机械验收(如何证明"已考虑"?)。 → 将该验收标准改为可验证形式,如"caller.go 构造 UploadService{} 时无需传 DeletedAt,因 time.Time 零值即未删除;编译通过且现有 Process() 单元测试不变"。
- [low/high] 证据候选 caller.go.Handler 标注 lineStart=3 lineEnd=3,但 line 3 为文档注释 "// Handler demonstrates...",实际类型声明 "type Handler struct{}" 位于 line 4。证据指向符号所在行不精确(虽可接受为注释+声明块,但单行 3 未覆盖类型声明本身)。 → 将该证据修正为 lineStart=3 lineEnd=4(注释+声明),或改为 lineStart=4 lineEnd=4 仅指向类型声明,以保证证据区间与符号定义对齐。
- [low/high] 架构未提及新增字段所需 import "time"。UploadService.go 当前无 import,添加 time.Time 字段后需补 import 块(gofmt 要求分组)。虽为机械实现细节,但架构组件描述"仅触及 UploadService 结构体定义"不够准确(还需动 import 块),与"最小变更/调用方零改动"的纯度略有出入。 → 在架构 components 中显式说明:UploadService.go 需新增 import "time" 并将 struct{} 改为 struct{ DeletedAt time.Time },以如实反映变更范围。
- [low/medium] 字段命名与需求字面值不一致:需求写 deletedAt(camelCase,常见于 JSON/序列化场景),架构改为 DeletedAt(PascalCase,Go 导出约定)。架构给出了合理理由,但未约定未来序列化/JSON 标签(如 json:"deletedAt")如何映射,若后续引入 REST/持久层(数据设计已提未来表 deleted_at),存在命名三态(deletedAt/DeletedAt/deleted_at)未统一约定。 → 在数据设计/REST 章节补一条命名映射约定:Go 字段 DeletedAt、JSON 标签 deletedAt、DB 列 deleted_at,并在 Acceptance 中固化,避免后续三态漂移。
> 证据真实性通过(4 条候选文件均存在,核心行号基本对齐;caller.go.Handler 行号偏移 1 行属轻微瑕疵)。需求覆盖方面存在两类核心问题:(1) 领域建模层面将\"Retention 实体\"默认等同于 UploadService(一个无状态 service)并在其上落 DeletedAt,语义混淆、落点存疑,建议 high 严重度需澄清;(2) 新增 DeletedAt 为孤儿字段——无 setter、无行为、Retention() 不感知软删除,实质死代码,仅满足字面\"加字段\"而未覆盖软删除语义,建议 medium 严重度补验收标准。其余为措辞张力、import/命名映射等低严重度补全项。整体方案最小变更意图清晰、向后兼容论证合理,但在\"为何落在此结构体上\"与\"软删除如何生效\"两点上论证不足,建议人工审批前先闭环上述澄清与补充。
