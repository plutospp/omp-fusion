---
name: fusion-solo
description: Fusion floor mode — run the SAME strong model twice as two independent cold panelists, judged by the same strong model. Always available; needs no extra providers.
argument-hint: <your question>
---
Invoke the **fusion** skill on the task below, forcing the floor panel:

Run the task **twice** as two independent `pi/slow` panelists (parallel, neither seeing the other's
work — divergence comes from sampling, not personas) → judge with `pi/slow` per
`references/judge_rubric.md` → write the final answer grounded in the analysis.

Do NOT add a second model family — this command is the always-available single-model floor. Pass the task
verbatim to both runs; no "lenses".

Task:
$ARGUMENTS
