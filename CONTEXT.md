# Domain Glossary

## Confirmation Gate

A durable pause after an analysis stage produces proposals, where a human can
approve the proposals, reject the run, or request a revision.

## Gate Stage

The analysis stage whose proposals are under review at a Confirmation Gate:
`scenario`, `use_case`, or `feature`.

## Current Stage

The analysis stage a run is currently executing or most recently executed. When
a Confirmation Gate is open, the Current Stage is the Gate Stage.

## Run Lifecycle Status

The independent state of an analysis run, such as running, awaiting
confirmation, or a terminal state. It does not encode the Gate Stage.

## Run Snapshot

A read-only view of an analysis run that combines its lifecycle status, Current
Stage, Confirmation Gate context, proposals, confirmed progress, and available
resume actions.
