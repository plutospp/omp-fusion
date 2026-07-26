---
name: fusion-trio
description: "Fusion three-model proposer wave — fusion_proposer_1 + fusion_proposer_2 + fusion_proposer_3 (default three families), aggregated by fusion_aggregator. The richest proposer wave."
argument-hint: "<your question>"
---
Invoke the **fusion** skill on the task below, forcing a three-model proposer wave:

Proposers = `pi/fusion_proposer_1`, `pi/fusion_proposer_2`, `pi/fusion_proposer_3` (fall back to
`pi/slow`, `pi/default`, and a third cross-family model if a role is unset; if a provider is unavailable
let OMP's fallback handle it, dropping to a two-model wave rather than failing; legacy `fusion_panel_1..3`
also resolve). Aggregator = `pi/fusion_aggregator` (fall back to `pi/slow`). All three answer the SAME
prompt in parallel, independently, with web + bash, none seeing the others' work, then the aggregator
synthesizes per `references/aggregator_rubric.md` and writes the final answer.

Three families, one of each — do not add lenses or a second run of the same model. Pass the task verbatim.

Task:
$ARGUMENTS
