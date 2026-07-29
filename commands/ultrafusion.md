---
name: ultrafusion
description: "Plan a task through the Ultrafusion pipeline — as many independent proposer plans in parallel as you configure (proposer_1, proposer_2, ...), then as many parallel critic comments (critic_1, critic_2, ... — consensus / contradictions / unique opinions / recommendation), then an aggregator integrates the comments into one final plan. Configure via modelRoles proposer_N / critic_N / aggregator (proposer_N and aggregator are shared with Fusion) / ultra_aggregator (Ultrafusion-only, overrides aggregator); supports --proposers, --critics, --aggregator."
argument-hint: "<task to plan>  [--proposers m1,m2,...] [--critics m1,m2,...] [--aggregator m]"
---
Invoke the **ultrafusion** skill on the task below.

Resolve models per the skill's section 1: honor `--proposers`/`--critics`/`--aggregator` overrides first;
otherwise the configured `modelRoles` (`proposer_N`, `critic_N`, `aggregator` — numbered from 1, use
however many you configured; `proposer_N` and `aggregator` are the same canonical keys Fusion reads;
`aggregator` is required unless `ultra_aggregator` is set — Ultrafusion's own dedicated aggregator key,
checked first, no fusion equivalent); proposers/critics otherwise fall back to the skill defaults
(`pi/slow, pi/default` cycled). Never run fewer than two proposers.

Run the three waves strictly in order: (1) fan the SAME verbatim task out to every proposer in parallel —
blind, independent, read-only investigation, each returns a complete plan; (2) give the original task plus
ALL surviving proposals to each critic in parallel — critics are blind to each other and each returns one
structured comment (Consensus / Contradictions / Unique opinions / Recommendation); (3) give the task,
every critic comment, and the proposals (appended for grounding) to the aggregator, which integrates the
comments into the final plan. No lenses, no debate rounds, no feedback loops.

Present the aggregator's final plan as the response.

Task:
$ARGUMENTS
