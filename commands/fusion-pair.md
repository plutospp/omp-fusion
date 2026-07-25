---
name: fusion-pair
description: "Fusion two-model panel — fusion_panel_1 + fusion_panel_2 (default a cross-family pair), judged by fusion_judge. One of each family, in parallel."
argument-hint: "<your question>"
---
Invoke the **fusion** skill on the task below, forcing a two-model panel:

Panel = `pi/fusion_panel_1` and `pi/fusion_panel_2` (fall back to `pi/slow` + `pi/default` if those roles
are unset). Judge = `pi/fusion_judge` (fall back to `pi/slow`). Both panelists answer the SAME prompt in
parallel, independently, with web + bash, neither seeing the other's work → judge synthesizes per
`references/judge_rubric.md` → final answer.

Use exactly two panelists — do not add a third. Pass the task verbatim; no "lenses".

Task:
$ARGUMENTS
