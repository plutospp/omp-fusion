---
name: fusion
description: "Run a question through the Fusion proposers then aggregator pipeline using your configured proposers (modelRoles proposer_1..N / aggregator — shared with Ultrafusion), or defaults. Supports --proposers m1 m2 ..., --aggregator m, and --analysis-only. Aliases: --panel, --judge."
argument-hint: "<your question>  [--proposers m1,m2,...] [--aggregator m] [--analysis-only]"
---
Invoke the **fusion** skill on the task below.

Resolve proposer and aggregator models per the skill's section 1: honor any `--proposers`/`--aggregator`
override in the arguments first (aliases: `--panel` maps to `--proposers`, `--judge` maps to
`--aggregator`); otherwise use the configured `modelRoles` (`proposer_1..N`, `aggregator` — the same
canonical keys Ultrafusion reads; `aggregator` is required, no fallback); proposers otherwise fall back
to the skill default (`pi/slow` + `pi/default`).
Never run fewer than two proposers.

Fan the SAME prompt out to the proposers in parallel (blind, independent, full tools), then have the
aggregator synthesize per `references/aggregator_rubric.md` and write the final answer. Pass the task
verbatim — no "lenses".

If `--analysis-only` is passed, the aggregator returns **only** the structured analysis (consensus /
contradictions / partial coverage / unique insights / blind spots) and **you** write the final answer
grounded in it; without the flag the aggregator writes the final answer itself.

Task:
$ARGUMENTS
