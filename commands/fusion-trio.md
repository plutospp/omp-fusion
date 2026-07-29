---
name: fusion-trio
description: "Fusion three-model proposer wave — proposer_1 + proposer_2 + proposer_3 (default three families), aggregated by aggregator. The richest proposer wave."
argument-hint: "<your question>"
---
Invoke the **fusion** skill on the task below, forcing a three-model proposer wave:

Proposers = `pi/proposer_1`, `pi/proposer_2`, `pi/proposer_3` (fall back to `pi/slow`, `pi/default`, and
a third cross-family model if a role is unset; if a provider is unavailable let OMP's fallback handle it,
dropping to a two-model wave rather than failing). Aggregator = `pi/aggregator` (required — no fallback). All three answer the SAME prompt in
parallel, independently, with web + bash, none seeing the others' work, then the aggregator synthesizes
per `references/aggregator_rubric.md` and writes the final answer.

Three families, one of each — do not add lenses or a second run of the same model. Pass the task verbatim.

Task:
$ARGUMENTS
