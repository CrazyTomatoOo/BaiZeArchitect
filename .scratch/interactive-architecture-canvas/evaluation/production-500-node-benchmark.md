# Production 500-node canvas benchmark

## Result

**Passed** on the project benchmark machine using the dedicated 1280×800 Playwright Chromium harness.

| Measure | Budget | Observed | Result |
|---|---:|---:|---|
| Initial interactive canvas | ≤ 1,500 ms | 918 ms | Pass |
| Filter submission / URL state | ≤ 250 ms | 101 ms | Pass |
| Filter-driven topology layout | ≤ 1,000 ms | 272.8 ms | Pass |
| Selection / inspector update | ≤ 100 ms | 18 ms | Pass |

Fixture: 500 Context nodes, 499 `dependsOn` relationships, deterministic evidence, and a query transition from the full graph to the matching view.

## Environment

- Date: 2026-08-09 UTC
- OS: macOS 26.5.2, arm64
- CPU: Apple M4 Pro
- Memory: 51,539,607,552 bytes (48 GiB)
- Playwright: 1.62.1
- Chromium: 151.0.7922.34
- Viewport: 1280×800
- Command: `cd web && npm run benchmark:canvas`

## Reproduction

The benchmark is isolated from visual/E2E regression runs:

```sh
cd web
npm run benchmark:canvas
```

It starts the Vite server, serves a deterministic API-mocked 500-node projection, waits for the G6/ELK Worker canvas to become interactive, and records the four timing measurements in Playwright output. It is a designated-machine measurement; CI should not be treated as the release hardware substitute.

## Remaining release checks

This result does not replace the required keyboard-only, VoiceOver/Safari, and NVDA/Firefox full exploration checks. Those require a human operator on their respective assistive-technology platforms and remain open.