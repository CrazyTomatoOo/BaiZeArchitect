# V05 排障控件归宿

status: closed（作废）
assignee: none
blocked-by: V01
labels: wayfinder:grilling

## Question

实时跟随、Run 切换、加载更多、深度 payload 检视等排障控件从审计视图移除后去向何处——删除、迁入 Workflow Doctor 面、还是保留为视图内折叠诊断抽屉？

## 本票要决议的细节

1. **逐一判定**：实时跟随 / Run 选择器 / 加载更多 / payload 深度检视，各自删除、迁移还是降级保留。
2. **Workflow Doctor 现状与缺口**：spec 故事 64 定义为只读不变量检查权威；勘察其现有 UI/CLI 形态，判定排障控件是否归属该面。
3. **语义冲突裁决**：SSE 实时跟随（live tail）与「审计 = 已定历史追溯」的语义冲突如何解——审计视图是否一律不含实时订阅。
4. **与 V03 的边界**：深度 payload 检视若保留在某处，其字段红线沿用 V03 决议，本票不重复决议裁剪规则。

## 输入

- V01 的目的清单与 Workflow Doctor 职责边界。
- 第一轮已锁：raw 转储删除；审计视图以 auditor 目的为主轴。

## Resolution（2026-08-18）

作废——Destination 重绘为「删除审计视图」，排障控件随视图一并移除；live tail / Run 切换 / payload 检视不再存在于产品 UI，无需另觅归宿。
