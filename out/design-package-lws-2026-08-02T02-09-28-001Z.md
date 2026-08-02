# DisaggregatedSet subdomain 字段校验:复用 generalValidate 模式并纳入 revision key 机制

> 审批状态: accepted
> DS revision 仅哈希 LeaderWorkerTemplate,NetworkConfig/subdomain 当前不触发新版本;DS webhook 缺 subdomain 校验

## 上下文
仓库 lws 是 Kubernetes LeaderWorkerSet + DisaggregatedSet 控制器(Go,2724 节点/6732 边)。DisaggregatedSet 通过 DisaggregatedRoleSpec 内嵌 leaderworkerset.LeaderWorkerSetTemplateSpec,其 Spec.NetworkConfig.SubdomainPolicy(Shared/UniquePerReplica)决定 headless service 域名策略。LWS webhook 已有 generalValidate(校验 subdomain null、maxSurge/maxUnavailable 等)与 revision key 机制(getPatch 把 NetworkConfig 写入 ControllerRevision patch,GetRevisionKey 比对)。DS 控制器 Reconcile 第 1 步用 ComputeRevision(role 名+LeaderWorkerTemplate 的 sha256 前 8 位)计算目标 revision,LWSManager.Create 用该 revision 名创建子 LWS。需求要求:为 DS 增加校验 subdomainPolicy(禁止设为 null、限制枚举、跨 role 一致性),复用 LWS generalValidate 模式与 revision key 机制,使 subdomain 变更能被识别为触发新版本(或在 create 时复用 generalValidate 校验),避免静默漂移。

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
- 组件: pkg/webhooks/disaggregatedset/disaggregatedset_webhook.go:新增 validateRoleSubdomain(role, rolePath) 并在 validate() 的 role 循环中调用,复用 webhooks 包既有 ValidatePositiveIntOrPercent/field 工具;语义对齐 leaderworkerset_webhook.go:111-112 的 null 检查, pkg/utils/disaggregatedset/utils.go:扩展 ComputeRevision(144-167) 的 roleTemplate 结构,加入 role.Spec.NetworkConfig(或显式 SubdomainPolicy)作为哈希输入,使 subdomain 变更产出新 revisionKey,与 revision_utils.GetRevisionKey(103) 比对链路一致, pkg/utils/revision/revision_utils.go:无需改动;getPatch(265-315) 已将 NetworkConfig 写入 ControllerRevision patch,NewRevision(52) 生成的 revisionKey 通过 GetRevisionKey(103) 被 DS 控制器 reconcileSlice/GetRevisionRolesList 复用, pkg/controllers/disaggregatedset/disaggregatedset_controller.go:Reconcile 第1步 ComputeRevision(79) 自动反映新 subdomain;无需改动结构,仅依赖 utils.ComputeRevision 输出变化, pkg/controllers/disaggregatedset/lws_manager.go:Create(59-102) 已 copy config.Spec(含 NetworkConfig) 下发子 LWS,无需改动;校验由 webhook 在创建前拦截, api/disaggregatedset/v1/disaggregatedset_types.go:DisaggregatedRoleSpec(84-103) 已内嵌 LeaderWorkerSetTemplateSpec,subdomain 经 role.Spec.NetworkConfig.SubdomainPolicy 暴露,无需新增字段(若需顶层专用字段则需 CRD/DeepCopy 同步)
- 质量属性: API 兼容性:不破坏现有 DisaggregatedSet/LeaderWorkerSet CRD schema,subdomain 仍走 LWS NetworkConfig;既有 revision patch 二进制兼容, 一致性:DS webhook 校验语义与 LWS generalValidate(subdomain null/枚举)对齐,避免两套不一致规则, 可观察性:校验失败返回明确 field.Path 与 message,复用既有 Eventf/Record, 测试覆盖:新增 subdomain null 拒绝、合法枚举、revision 变更用例;回归 disaggregatedset_webhook_test, 演进安全:ComputeRevision 扩展哈希输入会改变历史 revisionKey,需在 KEP/release note 说明升级期旧 revision 视为相同(或一次性滚动)

## REST API
- POST/PUT /validate-disaggregatedset-x-k8s-io-v1-disaggregatedset (ValidatingWebhookConfiguration vdisaggregatedset.kb.io,failurePolicy=fail) 对 spec.roles[*].spec.networkConfig.subdomainPolicy 增加校验:null 拒绝、枚举 Shared/UniquePerReplica;无新增 HTTP 端点
- 内部:Reconcile 计算的 revisionKey 变化触发 reconcileSlice/reconcileSimple 走 Create/Scale 路径,revision_utils.GetRevision 匹配 ControllerRevision

## 数据设计
- 数据库: Kubernetes API(etcd)
- 表: disaggregatedsets.disaggregatedset.x-k8s.io (v1):Spec.Roles[].Spec.NetworkConfig.SubdomainPolicy 复用 leaderworkerset.NetworkConfig,无 schema 变更, leaderworkersets.leaderworkerset.x-k8s.io (v1):子 LWS 继承 DS role 的 NetworkConfig,由 LWS webhook 默认值/校验兜底, controllerrevisions.apps (ControllerRevision):revision_utils.getPatch 已持久化 networkConfig;ComputeRevision 扩展后 revisionKey 不同但 patch 结构不变,旧 revision 仍可 GetRevision 读取

## 证据
- `pkg/webhooks/disaggregatedset/disaggregatedset_webhook.go` L66-108 (disaggregatedset_webhook.validate)
- `pkg/webhooks/leaderworkerset_webhook.go` L123-200 (leaderworkerset_webhook.generalValidate)
- `pkg/webhooks/leaderworkerset_webhook.go` L111-112 (leaderworkerset_webhook.ValidateUpdate.subdomainNullCheck)
- `api/leaderworkerset/v1/leaderworkerset_types.go` L246-265 (leaderworkerset_types.NetworkConfig.SubdomainPolicy)
- `api/disaggregatedset/v1/disaggregatedset_types.go` L84-103 (disaggregatedset_types.DisaggregatedRoleSpec.embedsLeaderWorkerSetTemplateSpec)
- `pkg/utils/disaggregatedset/utils.go` L144-167 (utils.ComputeRevision)
- `pkg/utils/revision/revision_utils.go` L52-90 (revision_utils.NewRevision)
- `pkg/utils/revision/revision_utils.go` L103-109 (revision_utils.GetRevisionKey)
- `pkg/utils/revision/revision_utils.go` L265-315 (revision_utils.getPatch.NetworkConfig)
- `pkg/controllers/disaggregatedset/disaggregatedset_controller.go` L72-80 (disaggregatedset_controller.Reconcile.ComputeRevision)
- `pkg/controllers/disaggregatedset/lws_manager.go` L59-102 (lws_manager.Create.copySpec)

## 评审发现 (critic 独立 challenge)
- [medium/high] 架构方案将 DS 的 revision 机制与 LWS 的 ControllerRevision 机制混为一谈。证据候选 #7(NewRevision 52-90)/#8(GetRevisionKey 103-109)/#9(getPatch 265-315) 属于 LWS 控制器内部的 ControllerRevision 链路,DS 控制器根本不调用它们。DS 自有 revision 链路是:utils.ComputeRevision(sha256) → revision 字符串 → 作为子 LWS 名后缀(GenerateName,lws_manager.go:60)并写入 disaggregatedsetv1.RevisionLabelKey 标签 → GetRevisionRolesList 用 `lws.Labels[RevisionLabelKey]==revision` 比对新旧版本(lws_manager.go:225)。grep 确认 pkg/controllers/disaggregatedset 下无任何 revision_utils 调用。因此验收标准#3 中『保证 GetRevisionKey/GetRevisionRolesList 能区分新旧版本』表述错误:GetRevisionKey 与 DS 版本区分无关。核心修复(扩展 ComputeRevision 哈希输入)方向正确,但证据归属与链路叙述不准确,可能误导实现者去改错文件。 → 更正:只需修改 pkg/utils/disaggregatedset/utils.go 的 ComputeRevision roleTemplate 结构加入 role.Spec.NetworkConfig(或 SubdomainPolicy);从 components/数据设计中删除『依赖 revision_utils.GetRevisionKey/getPatch』的论述;验收标准#3 改为『保证 GetRevisionRolesList(按 RevisionLabelKey 标签)能区分新旧版本』。
- [medium/high] 架构方案反复声称『复用 generalValidate 的 null 检查语义』『generalValidate(subdomain null/枚举)对齐』,但 generalValidate(leaderworkerset_webhook.go:123-200)实际不含任何 subdomain null 检查,也不含枚举检查。null 检查只存在于 ValidateUpdate(111-112);枚举由 CRD kubebuilder 注解 `+kubebuilder:validation:Enum={Shared,UniquePerReplica}`(types.go:249)在 CRD 层强制,而非 webhook 代码。因此所述『复用目标』在源码中并不存在,容易让实现者找不到可复用的代码片段。 → 更正措辞:DS webhook 的 null 检查应『参考 ValidateUpdate:111-112 的检查形式』而非 generalValidate;枚举校验说明『已由 CRD Enum 注解兜底,webhook 层为可选冗余』。
- [high/high] DS webhook 没有注册 Defaulter(SetupDisaggregatedSetWebhook 仅 WithValidator,见 disaggregatedset_webhook.go;grep 确认 pkg/webhooks/disaggregatedset 与 api/disaggregatedset/v1 下均无 Defaulter/Default 实现)。而 LWS 的 line-111 null 检查之所以实际几乎不触发,是因为 LWS Default()(leaderworkerset_webhook.go)会先把 nil SubdomainPolicy 默认成 Shared,且 mutating(defaulter)先于 validating 运行。若把同样的 null 检查复制到无 Defaulter 的 DS webhook,将在 update 时硬拒『NetworkConfig 非 nil 但 SubdomainPolicy 为 nil』的请求——比 LWS 更严格、行为不一致。架构方案未处理此差异。 → 二选一并明确:(a) 为 DS 新增 Defaulter 镜像 LWS Default(把 nil NetworkConfig/SubdomainPolicy 默认 Shared)后再做 null 检查,行为与 LWS 对齐;或 (b) 显式声明 DS 语义更严(nil 即拒、不默认),并在 KEP/文档说明与 LWS 的差异。当前方案声称『语义与 LWS webhook 一致』但实际不一致。
- [medium/high] 需求 changeRequest 明确包含『跨 role 一致性』(『禁止设为 null、限制枚举、跨 role 一致性』),但架构方案 components 中的 validateRoleSubdomain 仅做单 role 的 null+枚举校验,完全没有跨 role 一致性检查;验收标准#1 也未覆盖该点。存在需求覆盖遗漏/术语歧义:CR 提到但 AC 未测试,架构静默丢弃。 → 澄清『跨 role 一致性』的语义(是否要求所有 role 的 SubdomainPolicy 必须相同?还是仅记录差异?)。若需一致,新增 validateSubdomainConsistency(roles) 并补 AC 与测试用例;若不需,在设计中显式声明降级并回写需求方。
- [medium/high] ComputeRevision 哈希输入变更的升级爆炸半径未给出具体机制。当前 ComputeRevision 仅哈希 LeaderWorkerTemplate;加入 NetworkConfig 后,所有存量 DS 对象升级后 revisionKey 变化,而 DS 用 RevisionLabelKey 标签匹配现有子 LWS(lws_manager.go:225),新 key 不匹配任何现有 LWS → 控制器把全部现有 role 视为旧版本触发滚动重建。架构 qualityAttribute 的缓解(『旧 revision 视为相同(或一次性滚动)』)属愿望式描述,无具体实现路径。此外 DS 无 Defaulter,ComputeRevision 也不做 nil→Shared 归一化,会导致『NetworkConfig nil』与『NetworkConfig{Shared}』语义相同但哈希不同,产生伪版本。 → 在 ComputeRevision 哈希前对 NetworkConfig 做 nil→Shared、SubdomainPolicy nil→Shared 的归一化(对齐 getPatch:271-277 的归一化逻辑);并给出升级策略:例如先发布只新增校验、哈希输入不变的版本,再单独发布哈希变更版本,或提供一次性 reconcile 迁移,避免存量 DS 全量滚动。
- [low/medium] 枚举校验『仅 Shared/UniquePerReplica』已由 NetworkConfig.SubdomainPolicy 的 CRD 注解(types.go:249)在 CRD 层强制,且 DS role 内嵌 LeaderWorkerSetTemplateSpec,故 DS CRD 已继承该枚举约束。在 webhook 层再加枚举校验是冗余。架构方案未指出此点,可能引入重复维护。 → 在设计中注明『枚举由 CRD 注解兜底』;webhook 层若仍加,标注为防御性冗余,并与注释/测试说明其仅为 API server 未生效时的兜底。
> 证据行号全部核实真实(disaggregatedset_webhook.go:66-108/validate、leaderworkerset_webhook.go:123-200/generalValidate、111-112/null 检查、types.go:246-265/NetworkConfig、disaggregatedset_types.go:84-103/内嵌、utils.go:144-167/ComputeRevision、revision_utils.go 各区间、controller.go:72-80、lws_manager.go:59-102 均吻合)。核心修复方向(在 DS webhook 增加 subdomain 校验、扩展 ComputeRevision 哈希输入)是正确的。但方案存在三处需修正的关键问题:(1) 误将 LWS 内部 ControllerRevision 链路(GetRevisionKey/NewRevision/getPatch)当作 DS 版本比较链路,实际 DS 用 RevisionLabelKey 标签比较,与 revision_utils 无关;(2) 『复用 generalValidate null 检查』目标不存在——generalValidate 无 subdomain 逻辑,null 检查在 ValidateUpdate;(3) DS 无 Defaulter,照搬 LWS null 检查会变成硬拒,与 LWS(由 Default 兜底)行为不一致,方案未处理。此外需求『跨 role 一致性』被静默丢弃、ComputeRevision 升级爆炸半径与 nil→Shared 归一化未给出具体机制。建议补充 DS Defaulter 或显式声明语义差异、澄清跨 role 一致性、在 ComputeRevision 做归一化并给出升级策略后再进入实现。
