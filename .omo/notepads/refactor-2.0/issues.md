# Refactor 2.0 Issues

## 2026-07-20 — WP5 acceptance count regression

- `TestGetDesignRunAcceptanceReturnsReadyWhenRuntimeCompleted` still expected the pre-WP5 three-step runtime after the default orchestration became `context-engineer → analyst → architect → critic → reviewer`.
- The acceptance test uses the default runtime request without `targetLanguage`, so its exact expected count is five; the optional Translator would make a translated run six but does not apply to this scenario.
- Resolution: update only the stale expected count from three to five. Runtime behavior and readiness validation remain unchanged.
