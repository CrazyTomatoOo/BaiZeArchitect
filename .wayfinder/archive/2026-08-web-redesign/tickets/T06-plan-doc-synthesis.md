# T06 — 逐页设计要点 + 方案文档整合 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by: T03, T04, T05

## Question

把 T03(IA)+ T04(视觉)+ T05(交互)整合为《BaiZe web 重构方案》文档:

- 逐页设计要点:新 IA 下每页的布局、组件、交互、数据来源。
- 组件模式清单:卡片/列表-详情/徽章/空态等的统一定义。
- tokens 落地形式,与对现有 5 个组件的改造顺序建议。
- 文档章节与验收标准;评审通过即到达 destination。

产出:`docs/web-redesign-plan.md`(评审通过 = 本图完成)。

## Resolution(2026-08-05,grilling 3 分叉 + 文档产出)

方案文档落盘:`docs/web-redesign-plan.md`(10 章:概述/设计依据/tokens/IA/交互/逐页/组件/迁移/验收/附)。
逐页分叉:
- F1 资产库:**三 tab 分库**(场景/用例/功能,各列表+详情)。
- F2 需求录入:**全屏 chat + 右侧结构化预览**(agent 反问 → 预览 → 确认落库)。
- F3 系统页:**证据可视化独立子页**(系统页主区=设置+摘要入口;证据热点/boundaries/clusters/ADR/gene 收为子页)。
destination 到达:6 票全 closed,方案文档产出,待用户评审。
