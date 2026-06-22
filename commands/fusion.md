---
name: fusion
description: Run a question through the Fusion panel→judge pipeline using your configured panel (modelRoles fusion_panel_*/fusion_judge), or defaults. Supports --panel m1,m2,... and --judge m overrides.
argument-hint: <your question>  [--panel m1,m2,...] [--judge m]
---
Invoke the **fusion** skill on the task below.

Resolve panel and judge models per the skill's section 1: honor any `--panel`/`--judge` override in the
arguments first; otherwise use the configured `modelRoles` (`fusion_panel_1..N`, `fusion_judge`);
otherwise fall back to the skill defaults (panel `pi/slow` + `pi/default`, judge `pi/slow`). Never run
fewer than two panelists.

Fan the SAME prompt out to the panel in parallel (blind, independent, full tools), then have the judge
synthesize per `references/judge_rubric.md` and write the final answer. Pass the task verbatim — no
"lenses".

Task:
$ARGUMENTS
