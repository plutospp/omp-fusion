---
name: ultrafusion
description: Plan a task through the Ultrafusion pipeline — six independent proposer plans in parallel, three parallel critic comments (consensus / contradictions / unique opinions / recommendation), then an aggregator integrates the comments into one final plan. Configure via modelRoles ultrafusion_proposer_1..6 / ultrafusion_critic_1..3 / ultrafusion_aggregator; supports --proposers, --critics, --aggregator.
argument-hint: <task to plan>  [--proposers m1,m2,...] [--critics m1,m2,...] [--aggregator m]
---
Invoke the **ultrafusion** skill on the task below.

Resolve models per the skill's section 1: honor `--proposers`/`--critics`/`--aggregator` overrides first;
otherwise the configured `modelRoles` (`ultrafusion_proposer_1..6`, `ultrafusion_critic_1..3`,
`ultrafusion_aggregator`); otherwise fall back to the fusion roles (`fusion_panel_*` cycled to fill the
slots, `fusion_judge` as aggregator); otherwise the skill defaults. Never run fewer than two proposers.

Run the three waves strictly in order: (1) fan the SAME verbatim task out to every proposer in parallel —
blind, independent, read-only investigation, each returns a complete plan; (2) give the original task plus
ALL surviving proposals to each critic in parallel — critics are blind to each other and each returns one
structured comment (Consensus / Contradictions / Unique opinions / Recommendation); (3) give the task,
every critic comment, and the proposals (appended for grounding) to the aggregator, which integrates the
comments into the final plan. No lenses, no debate rounds, no feedback loops.

Present the aggregator's final plan as the response.

Task:
$ARGUMENTS
