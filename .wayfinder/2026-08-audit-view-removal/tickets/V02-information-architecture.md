# V02 信息架构与溯源面整合

status: closed（作废）
assignee: none
blocked-by: V01
labels: wayfinder:prototype

## Question

独立全屏审计视图的内部结构是什么——分几个区、层级与顺序如何、digest 单一溯源面如何呈现？「如何组织」是关键问题，以粗糙静态 prototype 供用户反应（参照 2026-08-auto-orchestration/prototypes/operator-experience 先例）。

## 本票要决议的细节

1. **区块组织**：按 V01 问题清单推导——每个区对应一个审计问题，区的标题即问题本身；不再有「不回答任何审计问题」的区块。
2. **完整性核验区**：workflow version/lastEventSeq、policy bundle digest、requirement revision digest、packet digest 的呈现方式（已锁：审计视图是唯一完整溯源面，主页面只留摘要 + 链接）。
3. **长列表组织**：事件/回执的时间序 vs 类型分组、分页 vs 加载更多、空态。
4. **层级与动线**：默认折叠/展开策略、区内密度、Esc/关闭行为沿用现有 overlay 惯例。
5. **产出**：静态 prototype（HTML 或等效物）链接为本票资产；prototype 只表决结构与层级，不表决视觉细节（DESIGN.md token 约束不变）。

## 输入

- V01 的目的与问题清单（每区必须能回指至少一个审计问题）。
- 第一轮已锁：独立全屏 overlay；digest 单一事实位置在本视图。

## Resolution（2026-08-18）

作废——Destination 由「重构审计视图」重绘为「删除审计视图」，重构向信息架构决议不再必要。
