# 在 DS webhook validate() 的 per-role 循环中复用 LWS 'cannot set subdomainPolicy as null' 语义,新增 validateRoleSubdomainPolicy helper(create+update 同时生效)

> 审批状态: accepted
> DS webhook 缺 subdomainPolicy 校验:null 值无 defaulter 兜底,静默流入子 LWS 被默认成 Shared 造成 spec 漂移

## 上下文
仓库 lws 是 Kubernetes LeaderWorkerSet (LWS) + DisaggregatedSet (DS) 控制器 (Go, 2724 节点/6732 边, HEAD=eb27a21ed60d21471761ded92be024e31ccf75e7)。DS 的 DisaggregatedRoleSpec 内嵌 leaderworkerset.LeaderWorkerSetTemplateSpec (api/disaggregatedset/v1/disaggregatedset_types.go:93),因此每个 role 经 role.Spec.NetworkConfig(*NetworkConfig,api/leaderworkerset/v1/leaderworkerset_types.go:142)携带 SubdomainPolicy(*SubdomainPolicy,枚举 Shared/UniquePerReplica,api line 250/253/260/265)。LWS webhook 已有语义:Default() 对 nil NetworkConfig/SubdomainPolicy 默认 Shared(pkg/webhooks/leaderworkerset_webhook.go:73-81);ValidateUpdate 拒绝 'cannot set subdomainPolicy as null'(line 111-112)。DS webhook(pkg/webhooks/disaggregatedset/disaggregatedset_webhook.go)仅有 WithValidator(无 defaulter),validate() 在 role 循环(line 72-74)中已有 validateRoleRolloutStrategy 等 per-role helper 模式,但无任何 subdomainPolicy 校验——null 值会静默流到子 LWS 被其 Default 兜底为 Shared,造成 spec 漂移不可见。上一轮已 accepted 的决策覆盖了 revision key 纳入 NetworkConfig 的更大方案;本次需求范围收窄为:DS webhook 增加 subdomainPolicy 枚举校验并拒绝 null。

## 需求
- 变更请求: 为 disaggregatedset webhook 增加 subdomainPolicy 枚举校验(拒绝 null)
- 仓库: lws @ eb27a21ed60d21471761ded92be024e31ccf75e7
### 验收条件
- ValidateCreate/ValidateUpdate 对每个 role 的 spec.networkConfig.subdomainPolicy 校验:NetworkConfig 非 nil 且 SubdomainPolicy 为 nil 时拒绝,错误消息 'cannot set subdomainPolicy as null',与 LWS webhook(leaderworkerset_webhook.go:111-112)语义一致
- SubdomainPolicy 非 nil 时校验枚举仅允许 Shared/UniquePerReplica,非法值返回 field.NotSupported
- 校验错误经 field.ErrorList 返回,路径为 spec.roles[i].spec.networkConfig.subdomainPolicy
- NetworkConfig 为 nil 时不报错(子 LWS 默认逻辑兜底)
- 新增单元测试覆盖:null subdomainPolicy 被拒、Shared/UniquePerReplica 通过、非法枚举值被拒;既有 disaggregatedset_webhook_test 全部通过

## 架构
- 组件: pkg/webhooks/disaggregatedset/disaggregatedset_webhook.go: 新增 validateRoleSubdomainPolicy(role, rolePath) helper;在 validate() 的 role 循环(line 72-74,validateRoleRolloutStrategy 调用之后)追加调用, 校验逻辑(复用 LWS 语义,见 leaderworkerset_webhook.go:111-112): role.Spec.NetworkConfig != nil && role.Spec.NetworkConfig.SubdomainPolicy == nil → field.Invalid(rolePath.Child("spec","networkConfig","subdomainPolicy"), nil, "cannot set subdomainPolicy as null");非 nil 时校验枚举仅 SubdomainShared/SubdomainUniquePerReplica(api/leaderworkerset/v1/leaderworkerset_types.go:260,265),否则 field.NotSupported(path, value, []string{"Shared","UniquePerReplica"}), 放在 validate()(line 66)而非仅 ValidateUpdate:DS webhook 只注册了 WithValidator(line 38-42),无 mutating defaulter,LWS 靠 Default()(leaderworkerset_webhook.go:73-81)兜底 nil,DS 没有这层兜底,create 时就必须拒绝 null,否则 nil 静默流入子 LWS 被默认成 Shared, 测试: pkg/webhooks/disaggregatedset/disaggregatedset_webhook_test.go 的 TestValidateCreate(line 33)/TestValidateUpdate(line 554)表驱动用例追加:null subdomainPolicy+非 nil NetworkConfig 被拒(错误路径 spec.roles[i].spec.networkConfig.subdomainPolicy)、Shared/UniquePerReplica 通过、NetworkConfig 为 nil 时跳过校验, 不改动(已在上轮 accepted 决策覆盖,本次范围外): ComputeRevision(pkg/utils/disaggregatedset/utils.go:144)仅哈希 LeaderWorkerTemplate(line 147),subdomain 变更不触发新 revision——如需纳入另起任务
- 质量属性: 一致性: 错误消息与 LWS webhook 'cannot set subdomainPolicy as null' 逐字对齐,field 路径规范为 spec.roles[i].spec.networkConfig.subdomainPolicy, 防御纵深: CRD 已有 kubebuilder Enum(api line 249)与 networkConfig 下 required subdomainPolicy,webhook 提供可单测的第二层校验与统一错误语义, 最小侵入: 单一 helper + 循环内一行调用,不改 API 类型、不改 CRD、不改控制器

## REST API
- Admission webhook: POST /validate-disaggregatedset-x-k8s-io-v1-disaggregatedset (verbs=create;update, 已有,见 disaggregatedset_webhook.go:44 kubebuilder 注解)——本次仅在其 validate() 内增加 per-role subdomainPolicy 校验,无新增端点

## 数据设计
- 数据库: 无数据库变更。涉及 API 类型(不修改,仅消费): leaderworkersetv1.NetworkConfig{SubdomainPolicy *SubdomainPolicy}(api/leaderworkerset/v1/leaderworkerset_types.go:246-251);枚举常量 SubdomainShared="Shared"(line 260)/SubdomainUniquePerReplica="UniquePerReplica"(line 265);DS 侧经 DisaggregatedRoleSpec 内嵌 LeaderWorkerSetTemplateSpec.Spec.NetworkConfig 访问(api/disaggregatedset/v1/disaggregatedset_types.go:93)
- 表: 

## 证据
- `pkg/webhooks/disaggregatedset/disaggregatedset_webhook.go` L66-74 (disaggregatedset_webhook.validate)
- `pkg/webhooks/disaggregatedset/disaggregatedset_webhook.go` L172-75 (disaggregatedset_webhook.validateRoleRolloutStrategy)
- `pkg/webhooks/leaderworkerset_webhook.go` L111-112 (leaderworkerset_webhook.ValidateUpdate)
- `pkg/webhooks/leaderworkerset_webhook.go` L73-82 (leaderworkerset_webhook.Default)
- `api/leaderworkerset/v1/leaderworkerset_types.go` L246-265 (leaderworkerset_types.NetworkConfig)
- `api/disaggregatedset/v1/disaggregatedset_types.go` L75-94 (disaggregatedset_types.DisaggregatedRoleSpec)
- `pkg/utils/disaggregatedset/utils.go` L144-167 (utils.ComputeRevision)
- `pkg/webhooks/disaggregatedset/disaggregatedset_webhook_test.go` L33-33 (disaggregatedset_webhook_test.TestValidateCreate)
- `pkg/webhooks/disaggregatedset/disaggregatedset_webhook_test.go` L554-554 (disaggregatedset_webhook_test.TestValidateUpdate)
