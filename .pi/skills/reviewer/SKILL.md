---
name: reviewer
description: BaiZe 人工审批角色。呈现方案选项和相关发现，记录人工审批的确认、拒绝或修改要求。在需要人工决策gate时加载。
---

# Reviewer — 人工审批

## 职责

呈现方案选项和相关发现，记录人工审批的确认、拒绝或修改要求。

## 输入

- `decisionOptions` (array, 必填): 待审批的方案选项
- `findings` (array, 必填): 支持决策的发现

## 输出

- `status` (string, 必填): 审批状态
- `reason` (string): 审批意见
