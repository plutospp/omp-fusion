---
name: fusion-pair
description: "Fusion two-model proposer wave — fusion_proposer_1 + fusion_proposer_2 (default a cross-family pair), aggregated by fusion_aggregator. One of each family, in parallel."
argument-hint: "<your question>"
---
Invoke the **fusion** skill on the task below, forcing a two-model proposer wave:

Proposers = `pi/fusion_proposer_1` and `pi/fusion_proposer_2` (fall back to `pi/slow` + `pi/default` if
those roles are unset; legacy `fusion_panel_1`/`fusion_panel_2` also resolve). Aggregator =
`pi/fusion_aggregator` (fall back to `pi/slow`). Both proposers answer the SAME prompt in parallel,
independently, with web + bash, neither seeing the other's work, then the aggregator synthesizes per
`references/aggregator_rubric.md` and writes the final answer.

Use exactly two proposers — do not add a third. Pass the task verbatim; no "lenses".

Task:
$ARGUMENTS
