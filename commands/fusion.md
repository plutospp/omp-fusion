---
name: fusion
description: "Run a question through the Fusion panel -> judge pipeline using your configured panel (modelRoles fusion_panel_*/fusion_judge), or defaults. Supports --panel m1,m2,... , --judge m, and --analysis-only."
argument-hint: "<your question>  [--panel m1,m2,...] [--judge m] [--analysis-only]"
---
Invoke the **fusion** skill on the task below.

Resolve panel and judge models per the skill's section 1: honor any `--panel`/`--judge` override in the
arguments first; otherwise use the configured `modelRoles` (`fusion_panel_1..N`, `fusion_judge`);
otherwise fall back to the skill defaults (panel `pi/slow` + `pi/default`, judge `pi/slow`). Never run
fewer than two panelists.

Fan the SAME prompt out to the panel in parallel (blind, independent, full tools), then have the judge
synthesize per `references/judge_rubric.md` and write the final answer. Pass the task verbatim — no
"lenses".

If `--analysis-only` is passed, the judge returns **only** the structured analysis (consensus /
contradictions / partial coverage / unique insights / blind spots) and **you** write the final answer
grounded in it; without the flag the judge writes the final answer itself.

Task:
$ARGUMENTS
