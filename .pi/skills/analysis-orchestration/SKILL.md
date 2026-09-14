---
name: analysis-orchestration
description: Decompose a requirement into the sequential scenario, use-case, and feature analysis stages.
---

# Analysis Orchestration

Use this skill when orchestrating the complete requirement analysis workflow.

## Instructions

1. Read the analysis contract from the `query_analysis_contract` tool.
2. Decompose the requirement into exactly these sequential stages:
   - `scenario`
   - `use_case`
   - `feature`
3. Return only JSON in this shape:

```json
{
  "stages": [
    {
      "name": "scenario",
      "description": "Analyze related and new scenarios."
    },
    {
      "name": "use_case",
      "description": "Analyze related and new use cases from confirmed scenarios."
    },
    {
      "name": "feature",
      "description": "Analyze affected and new features from confirmed use cases."
    }
  ]
}
```

Do not skip, reorder, or add analysis stages.
