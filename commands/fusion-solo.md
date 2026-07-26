---
name: fusion-solo
description: "Fusion floor mode — run the SAME strong model twice as two independent cold proposers, aggregated by the same strong model. Always available; needs no extra providers."
argument-hint: "<your question>"
---
Invoke the **fusion** skill on the task below, forcing the floor proposer wave:

Run the task **twice** as two independent `pi/slow` proposers (parallel, neither seeing the other's
work — divergence comes from sampling, not personas) then aggregate with `pi/slow` per
`references/aggregator_rubric.md` and write the final answer grounded in the analysis.

Do NOT add a second model family — this command is the always-available single-model floor. Pass the task
verbatim to both runs; no "lenses".

Task:
$ARGUMENTS
