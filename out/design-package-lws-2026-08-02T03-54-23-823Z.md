# DS subdomainPolicy 校验:复用 LWS null+枚举模式,在 validate 循环内、External continue 前对所有 role 生效;NetworkConfig nil 不强制;revision-key 扩展作为 follow-up

> 审批状态: accepted
> DS webhook validate 循环第 72-80 行对非 External role 在 continue 前仅调用 validateRoleRolloutStrategy,subdomainPolicy 校验须插在该调用之后、continue 之前以覆盖 Static role;DS 无 defaulter 故 NetworkConfig nil 不应拒绝

## 上下文
仓库 lws 是 Kubernetes LeaderWorkerSet + DisaggregatedSet 控制器(Go)。DisaggregatedSet(DisaggregatedRoleSpec)内嵌 leaderworkerset.LeaderWorkerSetTemplateSpec,故每个 role 携带 spec.networkConfig.subdomainPolicy(枚举 Shared/UniquePerReplica)。LWS webhook 已实现 generalValidate + Default(把 nil NetworkConfig/SubdomainPolicy 默认为 Shared),并在 ValidateUpdate 拒绝 'cannot set subdomainPolicy as null';revision_utils.getPatch 把 NetworkConfig 写入 ControllerRevision patch,故 LWS 侧 subdomain 变更能触发新版本。但 DisaggregatedSet webhook(ValidateCreate/ValidateUpdate → validate 循环)当前只校验 rolloutStrategy/placement/external scaling,缺 subdomainPolicy 校验;且 DS 无 defaulter,所以 nil subdomainPolicy 会静默下传到子 LWS。DS revision 由 disaggregatedsetutils.ComputeRevision 计算,仅哈希 role.Name+LeaderWorkerTemplate,不含 NetworkConfig,故 subdomain 变更不触发新 DS revision(已知历史 gap)。本次需求聚焦:为 DS webhook 增加 subdomainPolicy 枚举校验(拒绝 nil),复用 LWS 的 null 检查语义与 field.ErrorList 路径风格。

## 需求
- 变更请求: 为 disaggregatedset webhook 增加 subdomainPolicy 枚举校验:DS ValidateCreate/ValidateUpdate 对每个 role 的 spec.networkConfig.subdomainPolicy 进行校验,NetworkConfig 非 nil 时 SubdomainPolicy 不得为 nil,枚举仅 Shared/UniquePerReplica;null 校验语义与 LWS webhook(leaderworkerset_webhook.go ValidateUpdate 'cannot set subdomainPolicy as null')一致;错误经 field.ErrorList 返回,路径为 spec.roles[i].spec.networkConfig.subdomainPolicy。复用 LWS generalValidate 的 null 检查模式与 field.NotSupported 枚举校验风格。
- 仓库: lws @ eb27a21ed60d21471761ded92be024e31ccf75e7
### 验收条件
- DS ValidateCreate/ValidateUpdate 对每个 role 校验 spec.networkConfig.subdomainPolicy:NetworkConfig 非 nil 时 SubdomainPolicy 不得为 nil(复用 LWS null 检查语义),枚举仅 Shared/UniquePerReplica
- subdomainPolicy 校验错误经 field.ErrorList 返回,路径为 spec.roles[i].spec.networkConfig.subdomainPolicy;ValidateUpdate 对 'cannot set subdomainPolicy as null' 的语义与 LWS webhook 一致
- 校验对所有 role 生效(Static 与 External),不因 External 分支的 continue 而跳过
- 新增单元测试:nil subdomainPolicy(NetworkConfig 非 nil)被拒、合法 Shared/UniquePerReplica 通过、非法枚举值被拒、NetworkConfig 为 nil 时通过(不强制要求设置);既有 disaggregatedset_webhook_test 全部通过
- LWSManager.Create 将校验后的 NetworkConfig/SubdomainPolicy 原样下发到子 LWS spec(已由 config.Spec 拷贝实现,无需改动),由 LWS getPatch/ControllerRevision patch 持久化(复用既有 revision_utils.getPatch 已包含 networkConfig)
- 后续相关(本次不实现,记为 follow-up):subdomain 变更纳入 DS ComputeRevision 哈希输入以触发新 revisionKey——当前 ComputeRevision 仅哈希 LeaderWorkerTemplate(utils.go:144-166),subdomain 变更当前不触发新 DS revision,本计划在校验层避免 nil/非法值后,revision-key 扩展作为独立后续变更

## 架构
- 组件: pkg/webhooks/disaggregatedset/disaggregatedset_webhook.go:新增 validateRoleSubdomainPolicy(role, rolePath) field.ErrorList,在 validate 的 role 循环内、External 分支 continue 之前调用,对所有 role 生效;复用 field.Invalid(null) + field.NotSupported(枚举) 风格,与 LWS generalValidate/ValidateUpdate 一致, pkg/webhooks/disaggregatedset/disaggregatedset_webhook_test.go:在 TestValidateCreate/TestValidateUpdate 增加用例(nil subdomainPolicy 拒、Shared/UniquePerReplica 通过、非法枚举拒、NetworkConfig nil 通过), pkg/webhooks/leaderworkerset_webhook.go:参考样板(Default 默认 Shared、ValidateUpdate 'cannot set subdomainPolicy as null'),不修改, api/leaderworkerset/v1/leaderworkerset_types.go:NetworkConfig/SubdomainPolicy 枚举 Shared/UniquePerReplica 来源,不修改, pkg/controllers/disaggregatedset/lws_manager.go:Create 将 config.Spec(含 NetworkConfig)原样拷入子 LWS spec,校验后值自然下发,不修改, pkg/utils/revision/revision_utils.go:getPatch 已包含 networkConfig,子 LWS 侧 subdomain 变更可持久化,不修改
- 质量属性: 校验一致性:DS 与 LWS 对 subdomainPolicy null 的拒绝语义统一,避免静默漂移, 可维护性:复用既有 field.ErrorList 路径风格与 validate 循环结构,最小侵入, 向后兼容:NetworkConfig 为 nil 时不强制设置(DS 无 defaulter,允许用户省略),仅当显式设置 NetworkConfig 但 SubdomainPolicy 为 nil 或非法枚举时拒绝, 测试覆盖:单元测试覆盖 null 拒/枚举合法/枚举非法/NetworkConfig nil 四象限,既有测试全绿

## REST API
- POST /validate-disaggregatedset-x-k8s-io-v1-disaggregatedset (ValidateCreate) — 对 spec.roles[*].spec.networkConfig.subdomainPolicy 增加 nil 拒绝与枚举校验
- PUT/PATCH /validate-disaggregatedset-x-k8s-io-v1-disaggregatedset (ValidateUpdate) — 同上,且 'cannot set subdomainPolicy as null' 语义与 LWS ValidateUpdate 一致;webhook 路径/failurePolicy=fail/sideEffects=None 不变

## 数据设计
- 数据库: 无新增存储;校验在 admission webhook 层完成,不涉及 etcd schema 变更
- 表: api/leaderworkerset/v1/leaderworkerset_types.go:NetworkConfig{SubdomainPolicy *SubdomainPolicy} + 枚举 Shared/UniquePerReplica(行 246-266)——DS role 经内嵌 LeaderWorkerSetTemplateSpec 复用该字段,无 CRD 字段变更, ControllerRevision(patch via revision_utils.getPatch,行 265-295):子 LWS 的 networkConfig 已持久化于 patch;DS 侧 ComputeRevision(utils.go:144-166)当前不含 NetworkConfig——subdomain 变更触发新 revisionKey 的扩展记为 follow-up,本次仅做校验

## 证据
- `pkg/webhooks/disaggregatedset/disaggregatedset_webhook.go` L66-108 (disaggregatedset_webhook.go.validate)
- `pkg/webhooks/disaggregatedset/disaggregatedset_webhook.go` L48-56 (disaggregatedset_webhook.go.ValidateCreate)
- `pkg/webhooks/disaggregatedset/disaggregatedset_webhook.go` L55-61 (disaggregatedset_webhook.go.ValidateUpdate)
- `pkg/webhooks/leaderworkerset_webhook.go` L98-114 (leaderworkerset_webhook.go.ValidateUpdate)
- `pkg/webhooks/leaderworkerset_webhook.go` L52-84 (leaderworkerset_webhook.go.Default)
- `api/leaderworkerset/v1/leaderworkerset_types.go` L246-266 (leaderworkerset_types.go.NetworkConfig)
- `pkg/utils/disaggregatedset/utils.go` L144-166 (utils.go.ComputeRevision)
- `pkg/utils/revision/revision_utils.go` L265-295 (revision_utils.go.getPatch)
- `pkg/controllers/disaggregatedset/lws_manager.go` L59-110 (lws_manager.go.Create)
- `pkg/webhooks/disaggregatedset/disaggregatedset_webhook_test.go` L33-553 (disaggregatedset_webhook_test.go.TestValidateCreate)

## 评审发现 (critic 独立 challenge)
- [medium/high] 语义矛盾:方案声称'复用 LWS null 检查语义',但 LWS 的实际用户可见行为是 Default(defaulter,leaderworkerset_webhook.go 行 52-84)在 mutating 阶段把 nil SubdomainPolicy 默认为 Shared,先于 ValidateUpdate 执行。LWS ValidateUpdate 的 null 检查(行 110-112 'cannot set subdomainPolicy as null')在 defaulter 运行后几乎不会触发,是防御性死代码。DS 无 defaulter,方案选择在 validate()(被 ValidateCreate+ValidateUpdate 共用)中拒绝 nil,这意味着:同一份 NetworkConfig 非 nil 但 SubdomainPolicy 为 nil 的模板,在 LWS 可被接受(默认为 Shared),在 DS 会被拒绝。这是用户可见的行为分歧,与'复用 LWS 语义'的声明不一致。 → 二选一:(A) 为 DS 增加 defaulter(默认 nil SubdomainPolicy→Shared),使 DS 用户行为与 LWS 对齐,ValidateUpdate 保留 null 检查作防御;或 (B) 若明确选择 DS 更严格(拒绝 nil),则在 qualityAttributes/restApiContent 中显式文档化此分歧,并修改 acceptanceCriteria 中'复用 LWS null 检查语义'的措辞为'DS 采用更严格的拒绝语义(因无 defaulter)'。
- [medium/high] ComputeRevision gap 使校验价值减半:pkg/utils/disaggregatedset/utils.go ComputeRevision(行 144-166)仅哈希 role.Name + LeaderWorkerTemplate,不含 NetworkConfig。即使用户通过 webhook 校验将 SubdomainPolicy 从 Shared 改为 UniquePerReplica,DS revision key 不变,变更不会触发新 revision、不会 rollout 到已有子 LWS。方案将此记为 follow-up,但缺少对操作者的可见限制说明——用户可能以为校验通过即变更生效。 → 在本次变更的 webhook 注释或 release notes 中明确标注:'subdomainPolicy 变更当前不触发 DS revision rollout(ComputeRevision 未含 NetworkConfig),需配合后续 revision-key 扩展才能生效'。或考虑将 ComputeRevision 扩展纳入本次变更(只需在 roleTemplate 结构体加 NetworkConfig 字段),工作量小且闭环。
- [low/medium] 枚举校验可能冗余:SubdomainPolicy 字段已有 CRD schema 级 +kubebuilder:validation:Enum={Shared,UniquePerReplica}(leaderworkerset_types.go 行 248),非法枚举值会被 API server 在 admission 前拒绝,不会到达 webhook。方案提出在 webhook 用 field.NotSupported 做枚举校验,对非法值而言是防御性死代码。null 检查(nil pointer)才是 webhook 层的主要价值,因 CRD +optional + pointer 允许 nil。 → 保留枚举校验作为 defense-in-depth 无妨,但在测试用例中注意:非法枚举值的测试可能无法通过 webhook(会被 schema 先拒),需确认测试直接调用 webhook.ValidateCreate 绕过 schema,否则测试无法覆盖。
- [low/high] 证据行号不精确:evidenceCandidates 中 ValidateCreate 标注 48-56、ValidateUpdate 标注 55-61,两者重叠且越界。实际 ValidateCreate 函数体为行 48-52,ValidateUpdate 为行 54-59。validate 标注 66-108 正确。 → 修正 evidenceCandidates 行号:ValidateCreate→48-52,ValidateUpdate→54-59,消除重叠。
- [low/medium] LWSManager.Create 浅拷贝风险:lws_manager.go 行 66 `lwsSpec := config.Spec` 是 struct 值拷贝,但 NetworkConfig 是 *NetworkConfig 指针,故 DS 与子 LWS 共享同一 NetworkConfig 对象。当前 webhook 只校验不修改,安全;但若未来为 DS 增加 defaulter(见 Finding 1 方案 A),defaulter 会修改共享指针,影响子 LWS。代码注释(行 71-72)已提及 shallow copy 风险但仅针对 maps。 → 若未来增加 DS defaulter,需在 defaulter 中 DeepCopy NetworkConfig 或在 Create 中对 NetworkConfig 做深拷贝。本次无需改动,但建议在 NetworkConfig 相关注释中补充提醒。
> 架构方案对需求的核心意图(为 DS webhook 增加 subdomainPolicy 校验)理解正确,证据文件与行号基本可复核,插入点(validate 循环内、continue 之前)也准确。但方案存在一个中等严重度的语义矛盾:声称"复用 LWS null 检查语义",但 LWS 实际用户可见行为是"defaulter 把 nil 默认为 Shared"(Default 行 52-84 在 mutating 阶段先于 ValidateUpdate 执行),ValidateUpdate 的 null 检查(行 110-112)实际是几乎不触发的防御性死代码。DS 无 defaulter 故选择"拒绝 nil"而非"默认 nil",这使 DS 比 LWS 更严格——同一份模板在 LWS 可创建(nil→Shared),在 DS 会被拒。此外 ComputeRevision gap 使校验只能防非法值、无法保证变更生效,方案虽记为 follow-up 但缺少对用户的可见限制说明。建议:(1) 评估是否为 DS 增加 defaulter 以对齐 LWS 用户行为,或显式文档化此分歧;(2) 至少在 follow-up 中将 ComputeRevision 扩展与本变更关联标注,避免校验通过但变更不生效的假象。
