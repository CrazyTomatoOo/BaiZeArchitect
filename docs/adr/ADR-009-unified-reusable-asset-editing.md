# Reusable Asset 统一 revision 编辑与关系替换

资产库浏览重做需要让 8 种 Reusable Asset 都能被结构化编辑；原有仅 stakeholder 支持 PATCH 的边界无法支撑主从详情与关系选择器。决定采用统一 `PUT /api/assets/:id`：提交 `expectedRevisionId`、title、按 kind 校验的 content 和完整 outgoing relations，在同一事务中追加不可变 revision 并替换 outgoing 关系；旧 revision 与关系创建时的 revision 引用保留，展示仍解析双方最新 revision。业务字段复用现有 v1 schema，治理字段由系统处理，不修改 Artifact schema。

选择完整替换而非局部 PATCH，是为了让 revision、关系集合和并发校验具有单一提交边界；`expectedRevisionId` 防止多操作员静默覆盖。原 stakeholder-only PATCH 不保留双轨写入，导入复用已有资产时仍不覆盖其内容。
