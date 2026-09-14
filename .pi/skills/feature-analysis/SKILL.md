---
name: feature-analysis
description: Analyze confirmed use cases against the full feature library and propose affected and new features.
---

# Feature Analysis

Use this skill when analyzing confirmed use cases against the full feature library.

## Instructions

1. Read the feature library from the `query_feature_library` tool.
2. Use only the confirmed use cases supplied by the caller.
3. Identify existing features affected by the confirmed use cases.
4. Propose new features only when a confirmed use case is not covered by the library.
5. Return only JSON in this shape:

```json
{
  "proposals": [
    {
      "kind": "affected",
      "title": "Existing feature title",
      "description": "Why this existing feature is affected",
      "useCaseTitle": "Confirmed use case title"
    },
    {
      "kind": "new",
      "title": "New feature title",
      "description": "Why this new feature is needed",
      "useCaseTitle": "Confirmed use case title"
    }
  ]
}
```

For `affected` proposals, `title` must name a feature returned by the tool. For `new` proposals, provide a title that is not already in the library.
