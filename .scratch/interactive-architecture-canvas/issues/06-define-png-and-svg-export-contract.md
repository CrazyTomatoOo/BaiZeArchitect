# Define the PNG and SVG export contract

Type: grilling
Status: resolved
Blocked by: 03

## Question

What exactly should PNG and SVG export capture: the full graph or current viewport, active filters and expansion state, background/theme, repository and `head_sha` metadata, legend, scale, and filename? Define failure behavior and confirm that export remains a document operation rather than automatic asset creation.

## Answer

Export captures the **complete current visible graph**, fitted to its content bounds rather than cropped to the on-screen viewport. It faithfully includes the active C4 layer/root, filters, aggregate expansion, and neighbor-focus lens; exports therefore represent the user’s current analysis view, not an unfiltered repository diagram.

- **Presentation and provenance:** PNG and SVG use the opaque graphite-indigo theme. The embedded header contains repository, short `head_sha`, C4 layer, and root; the footer provides node/edge legend, active filters/focus conditions, and UTC generation time.
- **Formats:** SVG is standalone—inline styles, legend, and font fallback only; it has no external CSS, scripts, images, or network dependencies. PNG renders at 2× scale with a longest-side limit of 8192px.
- **Files and delivery:** the browser directly downloads `<repo>-<shortSha>-<layer>-<root>-<UTC timestamp>.<ext>`. Downloads are document operations only: they never create an `ArtifactRevision`, persist an asset, or invoke a server-side export job.
- **Failure behavior:** export actions disable while a capture is running. Missing/empty views, projection/render errors, or SVG serialization failures show an actionable error with retry and snapshot ID while preserving the current view. A PNG estimated above 8192px is refused—not cropped or silently downscaled—and directs the user to standalone SVG or a narrower filter before retrying.
