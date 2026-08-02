---
name: orchestrator
description: BaiZe 编排角色。解析需求并生成设计任务，分配各角色工作；收集发现、决策和审批结果后汇总最终输出。在需要协调多角色流水线时加载。
---

# Orchestrator — 编排

## 职责

解析需求并生成设计任务，分配各角色工作；收集发现、决策和审批结果后汇总最终输出。

## 输入

- `requirement` (string, 必填): 用户输入的原始业务诉求
- `findings` (array): 各角色产出的发现
- `approval` (object): 人工审批结果

## 输出

- `designTask` (object, 必填): 解析后的设计任务
- `finalOutput` (object, 必填): 汇总后的最终方案
