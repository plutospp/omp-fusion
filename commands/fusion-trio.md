---
name: fusion-trio
description: Fusion three-model panel — fusion_panel_1 + fusion_panel_2 + fusion_panel_3 (default three families), judged by fusion_judge. The richest panel.
argument-hint: <your question>
---
Invoke the **fusion** skill on the task below, forcing a three-model panel:

Panel = `pi/fusion_panel_1`, `pi/fusion_panel_2`, `pi/fusion_panel_3` (fall back to `pi/slow`,
`pi/default`, and a third cross-family model if a role is unset; if a provider is unavailable let OMP's
fallback handle it, dropping to a two-model panel rather than failing). Judge = `pi/fusion_judge` (fall
back to `pi/slow`). All three answer the SAME prompt in parallel, independently, with web + bash, none
seeing the others' work → judge synthesizes per `references/judge_rubric.md` → final answer.

Three families, one of each — do not add lenses or a second run of the same model. Pass the task verbatim.

Task:
$ARGUMENTS
