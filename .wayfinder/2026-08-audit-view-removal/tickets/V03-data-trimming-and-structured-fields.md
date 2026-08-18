# V03 数据裁剪与结构化展示规则

status: closed（作废）
assignee: none
blocked-by: V01
labels: wayfinder:grilling

## Question

每个数据面展示哪些字段、以什么结构呈现；raw payload 转储的结构化替代物是什么；裁剪发生在哪一层（前端 vs 服务端只读 API）？

## 本票要决议的细节

1. **运行事件表替代字段集**：删除 `JSON.stringify(event.payload)` 转储（已锁）后，以哪些结构化字段替代——事件类型、actor、关联实体、版本、digest、结果摘要等待定；逐 run-event 类型枚举。
2. **裁剪策略**：payload 白名单字段枚举 vs 黑名单剔除的取舍；模型过程类字段（token/工具细节）的处置红线与 V01 目的清单一并校准。
3. **裁剪落点**：服务端只读 API 扩展（裁剪后视图端点/字段选择）vs 前端裁剪的分工（已锁：允许只读 API 扩展，治理写路径不动）；纯前端裁剪的合规残留风险裁决。
4. **工作流事件表与回执表字段**：现有列（seq/type/version/entity/commandId；outcome/httpStatus/actorRef/requestDigest…）按 V01 问题清单增删。
5. **存量兼容**：旧形状事件/回执在新规则下的展示兜底。

## 输入

- V01 的问题清单与展示红线。
- 第一轮已锁：删 raw 转储；改动限前端 + 只读 API 扩展。

## Resolution（2026-08-18）

作废——Destination 重绘为「删除审计视图」，数据裁剪规则随视图一并消失；raw 转储问题由删除根除。
