# Store（存储域）

本产品持久化子域：Workspace registry、Reusable Asset 资产库与内容寻址 Snapshot Document 的 schema、写读方法与级联删除语义；治理域经 `WorkflowStore` 门面消费本域，不反向依赖。子域边界决议见 [ADR-006](../../docs/adr/ADR-006-store-subdomain-boundary.md)。

## Language

**Store（存储域）**:
本产品持久化子域，拥有 Workspace registry、Reusable Asset 资产库与 Snapshot Document 内容寻址对象存储的 schema 与写读方法；以类型即契约（类型 + error 类）向治理域暴露边界。
_Avoid_: persistence 工具层、workflow-store 类、数据库连接配置

**Workspace（工作区）**:
由仓库注册（repo_path 唯一字符串 = 身份，name = 可重复标签）、快照归属与 Requirement / Reusable Asset / Design Package 容器构成的产品层第一类实体；删除 = 级联销毁其下全部治理事实（单事务、不可恢复）；多操作员共享，不按工作区隔离可见性或权限。
_Avoid_: 上层 project 概念、软归档/可逆删除、按工作区 ACL

**Reusable Asset（可复用资产）**:
属于 Workspace、独立于 Requirement/Workflow/Attempt 的 scenario、usecase、function 或 stakeholder 版本化资产；被 Task 使用时必须引用精确 revision。
_Avoid_: 隐藏 Requirement、fake Run、当前治理 Artifact

**Stakeholder（干系人）**:
属于 Workspace、作为场景/用例干系人共享事实源的版本化可复用资产（kind=stakeholder），content 仅含 name（workspace 内 trim+大小写不敏感唯一）与 description；与治理域的 Actor（操作者身份）及 Agent 角色明确区分。
_Avoid_: Agent Role、操作员 Actor（可信 Actor / ActorRef / actor snapshot）、权限/职责枚举、RBAC 继承

**Snapshot Document（快照文档）**:
以 kind 与内容 digest 寻址、插入后不可修改的内容寻址大对象；治理域的 Plan、Context、Contract、Policy、Result 与 Packet 通过精确引用复用；全局共享、不随 Workspace 级联删除。
_Avoid_: 可变 JSON blob、仅保存文件路径