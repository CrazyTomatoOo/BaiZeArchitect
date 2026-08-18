# V06 验收标准与评审清单

status: closed（作废）
assignee: none
blocked-by: V02, V03, V04, V05
labels: wayfinder:grilling

## Question

《审计视图重构方案》spec 的验收标准、测试关注点与评审门禁是什么——评审者凭什么判定方案可执行、实施者凭什么判定完成？

## 本票要决议的细节

1. **验收资产形态**：机器可读验收资产（参照 2026-08-user-role-assets 的 actor-asset-spec-v1.json 先例）+ 人类评审入口文档（docs/ 下 spec 正文）。
2. **负向检查**：raw payload 转储不可达、模型过程字段不出现在审计面、主页面 digest 重复块移除——以何种测试关注（E2E 负向扫描先例：route-level mocking + data-testid）。
3. **评审清单**：红线遵守 / 入口语义正确 / digest 单一事实位置 / 边界不越（未动治理写路径、未引路由）。
4. **发布门禁**：用户人工评审通过 = 本图终点；实施转既有实现流程，不开新决策图。

## 输入

- V01–V05 全部决议；spec 正文骨架随本票定稿。

## Resolution（2026-08-18）

作废——Destination 重绘为「删除审计视图」，重构方案 spec 及其验收资产不再产出；删除的验收由新票覆盖。
