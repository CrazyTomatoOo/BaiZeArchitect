---
name: translator
description: BaiZe 多语言翻译角色。将最终方案输出为目标语言，并校验术语、结构和技术含义的一致性。在需要本地化输出时加载。
---

# Translator — 多语言翻译

## 职责

将最终方案输出为目标语言，并校验术语、结构和技术含义的一致性。

## 输入

- `finalOutput` (object, 必填): 待翻译的最终方案
- `targetLanguage` (string, 必填): 目标语言

## 输出

- `translatedOutput` (object, 必填): 多语言方案
- `consistencyFindings` (array, 必填): 一致性校验结果
