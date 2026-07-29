---
name: fusion-pair
description: "Fusion two-model proposer wave — proposer_1 + proposer_2 (default a cross-family pair), aggregated by aggregator. One of each family, in parallel."
argument-hint: "<your question>"
---
Invoke the **fusion** skill on the task below, forcing a two-model proposer wave:

Proposers = `pi/proposer_1` and `pi/proposer_2` (fall back to `pi/slow` + `pi/default` if those roles
are unset). Aggregator = `pi/aggregator` (required — no fallback). Both proposers answer the SAME prompt
in parallel, independently, with web + bash, neither seeing the other's work, then the aggregator
synthesizes per `references/aggregator_rubric.md` and writes the final answer.

Use exactly two proposers — do not add a third. Pass the task verbatim; no "lenses".

Task:
$ARGUMENTS
