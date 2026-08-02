# DS subdomainPolicy 校验复用 generalValidate + revision key 扩展

> 审批状态: accepted
> DS webhook 缺 subdomainPolicy 校验且 ComputeRevision 未纳入 NetworkConfig

## 上下文
仓库 lws (commit eb27a21ed60d21471761ded92be024e31ccf75e7) 是 Kubernetes LeaderWorkerSet + DisaggregatedSet 控制器(Go)。DisaggregatedSet 通过 DisaggregatedRoleSpec 内嵌 leaderworkerset.LeaderWorkerSetTemplateSpec,其 Spec.NetworkConfig.SubdomainPolicy(*SubdomainPolicy,枚举 Shared/UniquePerReplica)决定 headless service 域名策略。LDS webhook 当前只校验 rolloutStrategy/placement/scaler 名长,缺 subdomain 校验;LWS webhook 已有 generalValidate 与 ValidateUpdate 中 "cannot set subdomainPolicy as null" 语义可复用。DS revision key 由 pkg/utils/disaggregatedset.ComputeRevision 计算(仅哈希 role.Name + LeaderWorkerTemplate,不含 NetworkConfig),子 LWS 由 LWSManager.Create 用 config.Spec(含 NetworkConfig)下发,ControllerRevision patch 由 revision.getPatch 持久化 networkConfig。需求:为 DS webhook 增加 subdomainPolicy 校验(拒绝 nil、限制枚举、跨 role 一致),并使 subdomain 变更纳入 revision key。

## 需求
- 变更请求: 为 disaggregatedset 控制器增加 subdomain 字段校验,复用 generalValidate 与 revision key 机制
- 仓库: lws @ eb27a21ed60d21471761ded92be024e31ccf75e7
### 验收条件
- DS webhook(ValidateCreate/ValidateUpdate)对每个 role 的 spec.networkConfig.subdomainPolicy 进行校验:NetworkConfig 非 nil 时 SubdomainPolicy 不得为 nil(复用 LWS generalValidate 的 null 检查语义),枚举仅 Shared/UniquePerReplica
- subdomainPolicy 校验错误经 field.ErrorList 返回,路径为 spec.roles[i].spec.networkConfig.subdomainPolicy,且 ValidateUpdate 对 'cannot set subdomainPolicy as null' 的语义与 LWS webhook 一致
- subdomain 变更纳入 revision key 机制:ComputeRevision 哈希输入需包含 role.Spec.NetworkConfig(或新增 subdomain 字段)以使 subdomain 变更产生新 revisionKey,保证 GetRevisionKey/GetRevisionRolesList 能区分新旧版本
- LWSManager.Create 将校验后的 NetworkConfig/SubdomainPolicy 原样下发到子 LWS spec,并由 LWS getPatch/ControllerRevision patch 持久化(复用既有 revision_utils.getPatch 已包含 networkConfig)
- 新增单元测试覆盖:null subdomainPolicy 被拒、合法 Shared/UniquePerReplica 通过、subdomain 变更触发新 revision key;既有 disaggregatedset_webhook_test 全部通过

## 架构
- 组件: pkg/webhooks/disaggregatedset/disaggregatedset_webhook.go:新增 validateRoleNetworkConfig(role, rolePath),在 validate() 的 role 循环(line 72-94)内调用,复用 LWS generalValidate 的 null 检查语义——NetworkConfig != nil 时 SubdomainPolicy 不得为 nil,否则 field.Invalid(rolePath.Child("spec","networkConfig","subdomainPolicy"), nil, "cannot set subdomainPolicy as null");枚举校验用 field.NotSupported 限定 Shared/UniquePerReplica(复用 api/leaderworkerset/v1 已有 SubdomainShared/SubdomainUniquePerReplica 常量), pkg/webhooks/disaggregatedset/disaggregatedset_webhook.go:ValidateUpdate(line 54-59)在调用 validate(newDisagg) 后,对每个 role 增加与 LWS ValidateUpdate(line 104-113)一致的 'cannot set subdomainPolicy as null' 语义校验——若 newDisagg role 的 NetworkConfig 非 nil 且 SubdomainPolicy==nil 则报错;避免新增跨 role 一致性约束(当前 LWS 也无此约束,保持语义对齐,降低回归面), pkg/utils/disaggregatedset/utils.go:扩展 ComputeRevision(line 144-168)的 roleTemplate 结构体,新增 NetworkConfig *leaderworkerset.NetworkConfig 字段(从 role.Spec.NetworkConfig 取值),使 subdomain 变更进入 sha256 哈希输入;这样 revisionKey 变化会自然驱动 controller Reconcile(step1, line 79)走新版本创建路径,LWSManager.Create(line 335)用新 revision 名建子 LWS,GetRevisionRolesList/GetRevisionKey(line 232-240)按 revisionKey 聚合区分新旧版本, pkg/controllers/disaggregatedset/lws_manager.go:Create(line 59-66)无需改动——lwsSpec := config.Spec 已整体拷贝 LeaderWorkerSetTemplateSpec(含 NetworkConfig),校验后的 SubdomainPolicy 原样下发到子 LWS spec;子 LWS 的 LWS webhook Default 会补默认 SubdomainShared,ControllerRevision 由 revision.getPatch(line 265-296)持久化 networkConfig(已含 $patch replace), pkg/webhooks/disaggregatedset/disaggregatedset_webhook_test.go:新增 TestValidateSubdomainPolicy 用例(null 被拒/Shared 通过/UniquePerReplica 通过/非法枚举被拒),复用既有 table-driven TestValidateCreate 模式(line 33-60);pkg/utils/disaggregatedset 增 ComputeRevision subdomain 变更触发新 key 的测试
- 质量属性: 向后兼容:ComputeRevision 哈希输入扩展会使历史 revisionKey 改变,但 DS 控制器 Reconcile 按 'ComputeRevision 新 key 找不到既有 LWS → 走 Create 新 revision + 排空旧 revision' 的既有滚动路径处理,无需迁移;getPatch 已默认 nil→SubdomainShared 与 LWS Default 一致,不破坏既有 patch, 可复用性:校验逻辑复用 LWS generalValidate/ValidateUpdate 既有语义,不引入新校验 helper 包;枚举常量复用 api/leaderworkerset/v1, 最小回归面:不在 DS 增加跨 role subdomain 一致性强约束(与 LWS 行为对齐),避免误拒现有用例, 可观测性:校验错误经 field.ErrorList 返回标准路径 spec.roles[i].spec.networkConfig.subdomainPolicy,便于 kubectl 报错定位

## REST API
- POST /validate-disaggregatedset-x-k8s-io-v1-disaggregatedset (ValidateCreate):新增 subdomainPolicy null/枚举校验,失败返回 field.ErrorList 路径 spec.roles[i].spec.networkConfig.subdomainPolicy
- PUT /validate-disaggregatedset-x-k8s-io-v1-disaggregatedset (ValidateUpdate):新增 subdomainPolicy null 校验,语义与 LWS 'cannot set subdomainPolicy as null' 一致;无新增 endpoint,仅扩展既有 validating webhook

## 数据设计
- 数据库: 无数据库;数据模型为 Kubernetes CRD DisaggregatedSet(api/disaggregatedset/v1)与子 LeaderWorkerSet + ControllerRevision
- 表: DisaggregatedSet.Spec.Roles[i].Spec.NetworkConfig.SubdomainPolicy(*leaderworkerset.SubdomainPolicy,枚举 Shared/UniquePerReplica)— 校验目标字段,api/leaderworkerset/v1/leaderworkerset_types.go:246-266, ControllerRevision.Data.Raw(patch)— 由 revision_utils.getPatch(line 265-296)持久化 networkConfig,subdomain 变更经 ComputeRevision 产生新 revisionKey 后由 NewRevision 创建新 ControllerRevision;旧 revision ControllerRevision 由 TruncateRevisions(line 251-258)在排空后清理

## 证据
- `pkg/webhooks/disaggregatedset/disaggregatedset_webhook.go` L66-94 (disaggregatedset_webhook.go.validate)
- `pkg/webhooks/disaggregatedset/disaggregatedset_webhook.go` L54-59 (disaggregatedset_webhook.go.ValidateUpdate)
- `pkg/webhooks/leaderworkerset_webhook.go` L123-123 (leaderworkerset_webhook.go.generalValidate)
- `pkg/webhooks/leaderworkerset_webhook.go` L104-113 (leaderworkerset_webhook.go.ValidateUpdate)
- `pkg/utils/disaggregatedset/utils.go` L144-168 (utils.go.ComputeRevision)
- `pkg/utils/revision/revision_utils.go` L265-296 (revision_utils.go.getPatch)
- `pkg/controllers/disaggregatedset/lws_manager.go` L59-66 (lws_manager.go.Create)
- `api/leaderworkerset/v1/leaderworkerset_types.go` L246-266 (leaderworkerset_types.go.NetworkConfig)
- `pkg/webhooks/disaggregatedset/disaggregatedset_webhook_test.go` L33-60 (disaggregatedset_webhook_test.go.TestValidateCreate)

## 评审发现 (critic 独立 challenge)
- [high/high] ComputeRevision 哈希输入扩展的向后兼容论证不充分,存在存量滚动重启风险。架构方案在 roleTemplate 新增 NetworkConfig 字段但未指定 json omitempty;当前 roleTemplate(json:`template`)无 omitempty,新增 `NetworkConfig *leaderworkerset.NetworkConfig` 若同样无 omitempty,则即便 role.Spec.NetworkConfig==nil 也会序列化为 "networkConfig":null,导致所有存量 DS 的 revisionKey 在控制器升级后全部改变。controller Reconcile(disaggregatedset_controller.go:79 ComputeRevision → :130 reconcileSlice → :215-230 oldRevisions 滚动路径)会将新 key 视为目标 revision、旧 key 视为需排空的 old revision,触发对所有运行中 DS 工作负载的滚动重建。架构 qualityAttribute 称'无需迁移/既有滚动路径处理'实质上就是一次全量滚动重启,严重度被低估。 → 明确新增字段使用 `json:"networkConfig,omitempty"` 并在设计中区分:仅当 role.Spec.NetworkConfig!=nil 时才进入哈希;同时补充迁移影响评估(存量 DS 若已显式设置 subdomain 仍会改 key → 仍会滚动重启),给出降级/灰度策略或版本化哈希方案。
- [high/medium] revision key 与子 LWS 实际 spec 存在归一化不对称。仓库无 DS 侧 Default webhook(grep pkg/webhooks/disaggregatedset 与 api/disaggregatedset 均无 Default/defaulter),DS Spec.Roles[i].Spec.NetworkConfig 不会被默认为 Shared;而子 LWS 由 LWS Default(leaderworkerset_webhook.go:73-81)默认 NetworkConfig=Shared。因此 role.Spec.NetworkConfig==nil 与 ==Shared 两种 DS spec 产生的子 LWS 实际等价,但 ComputeRevision(若按方案纳入 NetworkConfig)会给出不同 revisionKey(nil→omitempty 省略 vs Shared→包含)。后果:语义相同的 DS 编辑(nil↔Shared no-op)会触发非预期的滚动重启;同一有效 spec 出现两个 revisionKey,违反 revision 语义唯一性。架构'校验后 SubdomainPolicy 原样下发+Default 补默认'的描述未识别该不对称。 → 在 ComputeRevision 哈希前对 NetworkConfig 归一化(nil 视为 SubdomainShared),或在 DS 侧增加 Default webhook 使 NetworkConfig 默认化后再参与哈希,保证等价 spec→同一 revisionKey。
- [medium/medium] 需求与架构存在矛盾:contextSummary 明确需求含'跨 role 一致'(拒绝 nil、限制枚举、跨 role 一致),但验收条件#1 仅要求 per-role 校验,架构 components 第2项显式决定'避免新增跨 role 一致性约束'。需求是否需要跨 role subdomainPolicy 一致未澄清;若需要,架构方案不完整;若不需要,contextSummary 表述需修正。 → 先澄清需求:跨 role 一致是否为硬性验收条件。若是,补充 validateCrossRoleSubdomainPolicy;若否,在 contextSummary/验收条件中删除'跨 role 一致'措辞以避免实现与需求脱节。
- [low/medium] ValidateUpdate 的 subdomainPolicy null 校验与 validate() 重复。ValidateUpdate(:55-59)已调用 validate(newDisagg),而 validate()(:66-94)的 role 循环内新增 validateRoleNetworkConfig 会同时作用于 create 与 update。架构又在 ValidateUpdate '后'重复追加同一 'cannot set subdomainPolicy as null' 检查,造成重复报错(同一 field path 产生两条 field.Invalid)。LWS 的语义不同:LWS 将 null 检查仅置于 ValidateUpdate(:111-113)而 generalValidate 不含,因 create 依赖 Default 先行补默认。 → 仅在 validate() 内实现 null+枚举校验(覆盖 create 与 update);ValidateUpdate 无需重复追加。若确需 update-only 语义(如禁止从 Shared 改回 nil),应明确为不可变性校验而非复用 null 检查文案。
- [low/high] 枚举校验与 CRD 层校验冗余。SubdomainPolicy 已有 +kubebuilder:validation:Enum={Shared,UniquePerReplica}(leaderworkerset_types.go:249),API server 已拒绝非法枚举。webhook 内 field.NotSupported 为防御性重复,可接受但应明确为 defense-in-depth,避免误以为 CRD 缺校验。 → 保留 webhook 枚举校验作为防御,但在设计文档注明 CRD 层已校验,避免实现者重复造常量映射或误改 CRD。
- [low/medium] 证据/引用不一致:架构正文称 'LWSManager.Create(line 335)'(实为 disaggregatedset_controller.go:335 的调用点),而 evidenceCandidate 给出的是 lws_manager.go:59-66 的 Create 定义。两处均为真实代码但指向不同文件不同行,可能误导实现者定位。此外,支撑'无需迁移'质量属性的关键证据(controller Reconcile step1 :79、reconcileSlice 滚动路径 :208-230、rolling update executor)未列入 evidenceCandidates,导致向后兼容结论缺乏可追溯证据。 → 在 evidenceCandidates 中补充 disaggregatedset_controller.go:79 与 :208-230(或 executor.go 滚动逻辑)作为 revision key 变更→滚动重启的因果证据,并统一 Create 引用(区分定义点与调用点)。
> 证据文件路径与行号经复核基本真实存在(ComputeRevision 144-168、getPatch 265-296、Create 59-66、NetworkConfig 246-266、TestValidateCreate 33-60 均吻合;generalValidate 123、LWS ValidateUpdate subdomain null 检查 111-113 吻合)。但架构方案在 revision key 扩展的向后兼容性论证上存在实质缺陷:未指定 omitempty 且忽略了 DS 侧无 Default webhook 导致的 nil/Shared 归一化问题,会引发存量工作负载非预期滚动重启。同时需求 contextSummary 的"跨 role 一致"与验收条件/架构决策(放弃跨 role 一致性)存在矛盾,需澄清。建议就 revision key 归一化与迁移影响补充设计后再进入实现。
