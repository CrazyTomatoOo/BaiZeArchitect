---
name: use-case-analysis
description: Analyze confirmed scenarios against the full use-case library and propose related and new use cases.
---

# Use Case Analysis

Use this skill when analyzing confirmed scenarios against the full use-case library.

## Instructions

1. Read the use-case library from the `query_use_case_library` tool.
2. Use only the confirmed scenarios supplied by the caller.
3. Identify existing use cases that are related to the confirmed scenarios.
4. Propose new use cases only when a confirmed scenario is not covered by the library.
5. Return only JSON in this shape:

```json
{
  "proposals": [
    {
      "kind": "related",
      "title": "Existing use case title",
      "description": "Why this existing use case is related",
      "scenarioTitle": "Confirmed scenario title"
    },
    {
      "kind": "new",
      "title": "New use case title",
      "description": "Why this new use case is needed",
      "scenarioTitle": "Confirmed scenario title"
    }
  ]
}
```

For `related` proposals, `title` must name a use case returned by the tool. For `new` proposals, provide a title that is not already in the library.
