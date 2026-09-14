---
name: scenario-analysis
description: Analyze a requirement against the full scenario tree and propose related and new scenarios.
---

# Scenario Analysis

Use this skill when analyzing a requirement against the full scenario tree.

## Instructions

1. Read the scenario tree from the `query_scenario_tree` tool.
2. Identify existing scenarios that are related to the requirement.
3. Propose new scenarios only when the requirement is not covered by existing scenarios.
4. Return only JSON in this shape:

```json
{
  "proposals": [
    {
      "kind": "related",
      "title": "Existing scenario title",
      "description": "Why this existing scenario is related"
    },
    {
      "kind": "new",
      "title": "New scenario title",
      "description": "Why this new scenario is needed"
    }
  ]
}
```

Do not invent scenario tree entries that were not returned by the tool.
