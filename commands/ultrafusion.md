---
name: ultrafusion
description: "Plan a task through the Ultrafusion pipeline — explorers investigate in parallel, proposers critique findings and commit to plans in parallel, then an aggregator integrates the proposals into one final plan. Configure via modelRoles fusion_explorer_1..6 / fusion_proposer_1..6 / fusion_aggregator; supports --explorers, --proposers, --aggregator. Alias: --critics maps to --proposers."
argument-hint: "<task to plan>  [--explorers m1,m2,...] [--proposers m1,m2,...] [--aggregator m]"
---
Invoke the **ultrafusion** skill on the task below.

Resolve models per the skill's section 1: honor `--explorers`/`--proposers`/`--aggregator` overrides
first (alias: `--critics` maps to `--proposers`); otherwise the configured `modelRoles`
(`fusion_explorer_1..6`, `fusion_proposer_1..6`, `fusion_aggregator`); otherwise fall back to the legacy
roles (`ultrafusion_proposer_*` for explorers, `ultrafusion_critic_*` for proposers,
`ultrafusion_aggregator` for aggregator, `fusion_panel_*` cycled to fill slots); otherwise the skill
defaults. Never run fewer than two explorers or two proposers.

Run the three waves strictly in order: (1) fan the SAME verbatim task out to every explorer in parallel —
blind, independent investigation, each returns findings only (no plan); (2) give the original task plus
ALL surviving explorer findings to each proposer in parallel — proposers are blind to each other, each
critiques the findings then commits to one complete plan; (3) give the task and every proposal to the
aggregator, which integrates the proposals into the final plan. No lenses, no debate rounds, no feedback
loops.

Present the aggregator's final plan as the response.

Task:
$ARGUMENTS
