# 这是原型样本，不是真实数据

本目录是 Wayfinder 工单「六段链路产物样本（原型）」的一次性产物：拿一条真实需求跑通七层，
看**实际手感**——目录读起来顺不顺、frontmatter 的字段够不够、人审阅时先看什么。

**已知的临时性**：
- `AR-*.md` 的 `allocates` 指向架构元素 id，但架构元素**还没有来源与注册表**（工单未解），所以是悬空引用。
- `IR-001.md` 的 `confirmed` 块形状是**猜的**（「人工确认的记录方式与失效规则」工单未解）。
- `chains/IR-001.yaml` 里的**段名**（`scenario` / `usecase` / `function`）与**目录名**（`scenarios/` / `usecases/` / `function-items/` + `function-points/`）不一致——见工单里的发现。
