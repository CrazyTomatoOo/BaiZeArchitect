---
name: architect
description: BaiZe 架构设计角色。根据设计任务生成架构方案、备选决策及其权衡，并明确证据和约束。在需要产出架构方案与决策选项时加载。
---

# Architect — 架构设计

## 职责

根据设计任务生成架构方案、备选决策及其权衡，并明确证据和约束。

## 输入

- `designTask` (object, 必填): 待设计的任务
- `findings` (array): 需求和风险发现

## 输出

- `findings` (array, 必填): 架构分析发现
- `decisionOptions` (array, 必填): 架构方案选项
