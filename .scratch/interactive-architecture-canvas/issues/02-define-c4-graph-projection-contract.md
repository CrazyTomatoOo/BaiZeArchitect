# Define the C4 graph projection contract

Type: grilling
Status: resolved
Blocked by:

## Question

What canonical repository snapshot, C4 element, relationship, containment, cross-level identity, provenance, and aggregation model should the interactive canvas consume so that Context, Container, Component, and Code are faithful projections of the same `head_sha` rather than unrelated diagrams? Determine what can be reused from the current `/api/architecture/:repo/c4` payload and what must change.

## Answer

Adopt the immutable **Architecture Projection Snapshot** described in [ADR-002](../../../docs/adr/ADR-002-versioned-c4-projection-snapshots.md).

- **Identity and retention:** one persisted `C4ProjectionSnapshot` per `repositoryId + headSha + projectionVersion`, with snapshot ID, content hash, generator metadata, and generation time. Requirement evidence snapshots retain `projectionSnapshotId + contentHash`; they do not duplicate or later regenerate the graph.
- **One canonical graph:** the snapshot contains one normalized node/edge/containment graph plus Context, Container, Component, and Code view selectors. Each layer filters the same facts and exposes explicit drill-down roots; layers are not independently generated diagrams.
- **Elements:** every node has a readable semantic `id`, a cross-commit `lineageId`, C4 kind, labels/description, parent containment, source status, and non-empty provenance references. Do not retain ordinal IDs such as `component-1` as identity.
- **Relationships:** edges are strongly typed as `contains`, `dependsOn`, `calls`, `readsWrites`, `externalDependency`, or `derivedFrom`; every fact edge carries confidence and evidence references. A model may suggest candidates, but cannot introduce unproven fact edges.
- **Evidence adapters:** code graph, build/deployment manifests, and declared external dependencies emit provenance-bearing claims before projection. The projector, rather than an LLM, composes those claims into the C4 graph.
- **Aggregation:** the projection may add explicit aggregate nodes with `memberIds`, rule, counts, statistics, and provenance. It retains the addressable atomic members and relationships so filtering, export, inspection, and drill-down are reproducible.
- **Migration:** the current `/api/architecture/:repo/c4` heuristic arrays are insufficient: they lack typed edges, robust containment, stable identity, complete provenance, aggregate membership, and a durable immutable snapshot. Replace the positional-array cache with this projection; do not preserve a compatibility representation.
