---
name: ultrafusion
description: >-
  Plan a hard task by fanning it out to SIX proposer models in parallel — each writing a complete plan
  independently, none seeing the others' work — then having THREE critic models (in parallel, blind to
  each other) each read every proposal and write a structured comment (consensus, contradictions, unique
  opinions, recommendation), and finally ONE aggregator model integrate the critics' comments into the
  final plan. Proposers, critics, and aggregator are ordinary OMP subagents whose models come from
  modelRoles (ultrafusion_proposer_1..6, ultrafusion_critic_1..3, ultrafusion_aggregator) or a per-invocation
  override, falling back to the fusion roles, then to built-in defaults. Use when the user says
  "ultrafusion", "ultra fusion", "multi-model plan", "plan this with proposers and critics", "committee
  plan", or wants several models to plan something before committing to an approach.
---

# Ultrafusion — proposers → critics → aggregator

Ultrafusion plans a hard task using three strict waves: **6 proposers** run in parallel to write independent plans blind to each other, **3 critics** run in parallel (blind to each other, each reading every proposal) to evaluate consensus, contradictions, unique opinions, and recommendations, and **1 aggregator** integrates the critics' comments into the final plan.

This is a **three-stage planning pipeline** (proposers → critics → aggregator), *not* voting or averaging. The aggregator synthesizes from the critics' comments, using the raw proposals as grounding.

Key properties:
- **Independence within waves.** Proposers plan blind to each other. Critics review blind to each other.
- **Synthesis, not voting.** The aggregator synthesizes insights into one final plan; it never averages or tally-votes.
- **Strict single-pass execution.** One blind pass per wave. No debate rounds, no feedback loops.

---

## 1. Pick the models

Resolve models in this precedence for each group (proposers / critics / aggregator) **independently** (first match wins per group):

1. **Explicit override** in the invocation:
   `--proposers <m1>,<m2>,...`, `--critics <m1>,...`, and/or `--aggregator <m>` (OMP model strings or `pi/<role>` aliases, each optionally suffixed with a `:thinking`). List lengths govern counts.
2. **Configured ultrafusion roles** in `~/.omp/agent/config.yml` → `modelRoles`:
   - `ultrafusion_proposer_1..6` (use however many are set)
   - `ultrafusion_critic_1..3` (use however many are set)
   - `ultrafusion_aggregator`
3. **Fusion-role fallback** (reuse an existing fusion configuration if ultrafusion roles are unset and fusion roles exist):
   - proposers ← `fusion_panel_1..N` cycled to 6 slots (e.g. 3 panel roles → `[1, 2, 3, 1, 2, 3]`)
   - critics ← `fusion_panel_1..N` cycled to 3 slots
   - aggregator ← `fusion_judge`
4. **Built-in defaults**:
   - proposers: `pi/slow, pi/default, pi/slow, pi/default, pi/slow, pi/default` (6 slots)
   - critics: `pi/slow, pi/default, pi/slow` (3 slots)
   - aggregator: `pi/slow`

**Floor rules:**
- Never run fewer than **two proposers**. If exactly one proposer model resolves, run it twice as two cold, independent runs.
- Critics: minimum 1 configured (0 successful handled in robustness).
- Aggregator: exactly 1.

**Recommended `modelRoles` block** (cross-family setup; `scripts/detect_panel.sh` prints a tailored suggestion):

```yaml
modelRoles:
  ultrafusion_aggregator:  anthropic/claude-opus-4-8:high
  ultrafusion_proposer_1: anthropic/claude-opus-4-8:high
  ultrafusion_proposer_2: openai-codex/gpt-5.5:high
  ultrafusion_proposer_3: google-antigravity/gemini-3.5-flash
  ultrafusion_proposer_4: anthropic/claude-opus-4-8:high
  ultrafusion_proposer_5: openai-codex/gpt-5.5:high
  ultrafusion_proposer_6: google-antigravity/gemini-3.5-flash
  ultrafusion_critic_1:   anthropic/claude-opus-4-8:high
  ultrafusion_critic_2:   openai-codex/gpt-5.5:high
  ultrafusion_critic_3:   google-antigravity/gemini-3.5-flash
```

Resolve role aliases yourself by passing the `pi/<role>` string as the subagent `model` — OMP resolves the alias against `modelRoles`. Do **not** hardcode a vendor.

---

## 2. Wave 1 — fan out the proposers

Give every proposer the **verbatim user task**. The `ultrafusion-proposer` agent enforces independence and plan-only output.

Canonical `eval` mechanism (note: the option key is `agent:`, verified against the current OMP eval prelude — the older key name is stale; never use it):

```js
// task = the verbatim user task (substitute it; no edits, no added "lenses")
const task = `<<<VERBATIM USER TASK>>>`;

// resolved per section 1
const proposers = ["pi/ultrafusion_proposer_1", "pi/ultrafusion_proposer_2", "pi/ultrafusion_proposer_3",
                   "pi/ultrafusion_proposer_4", "pi/ultrafusion_proposer_5", "pi/ultrafusion_proposer_6"];
const criticModels = ["pi/ultrafusion_critic_1", "pi/ultrafusion_critic_2", "pi/ultrafusion_critic_3"];
const aggregatorModel = "pi/ultrafusion_aggregator";

// parallel + agent are async — await them; parallel preserves input order.
const rawPlans = await parallel(
  proposers.map((m, i) => () => agent(task, { agent: "ultrafusion-proposer", model: m, label: `proposer ${i + 1}` })),
);

// drop failures but KEEP ORIGINAL NUMBERING so critic attributions stay traceable
const plans = rawPlans
  .map((p, i) => ({ n: i + 1, model: proposers[i], text: (p ?? "").trim() }))
  .filter(s => s.text);
```

---

## 3. Wave 2 — fan out the critics

Every critic receives the **identical input**: original task + ALL surviving proposals (truncated per robustness). Critics run in parallel, blind to each other.

```js
const plansBlock = plans.map(s => `=== PROPOSAL ${s.n} (model: ${s.model}) ===\n${s.text}`).join("\n\n");
const criticInput = `=== ORIGINAL TASK ===\n${task}\n\n${plansBlock}`;

const rawComments = await parallel(
  criticModels.map((m, i) => () => agent(criticInput, { agent: "ultrafusion-critic", model: m, label: `critic ${i + 1}` })),
);
const comments = rawComments
  .map((c, i) => ({ n: i + 1, model: criticModels[i], text: (c ?? "").trim() }))
  .filter(s => s.text);
```

---

## 4. Wave 3 — aggregator → final plan

Input order: task, then critic comments (primary), then proposals (grounding appendix). Present the aggregator's output as the response, leading with the plan.

```js
const aggInput = [
  `=== ORIGINAL TASK ===\n${task}`,
  ...comments.map(s => `=== CRITIC COMMENT ${s.n} (model: ${s.model}) ===\n${s.text}`),
  ...plans.map(s => `=== PROPOSAL ${s.n} (model: ${s.model}) ===\n${s.text}`),
].join("\n\n");

const finalPlan = await agent(aggInput, { agent: "ultrafusion-aggregator", model: aggregatorModel });
display(finalPlan);
```

---

### Plugin mode — no custom agents

When Ultrafusion is installed as an OMP plugin (`omp plugin link`/`install`), only `skills/` and `commands/` are discovered — the custom subagents are not. Use the bundled **`task`** agent (`agent: "task"`) and carry the inlined briefs in every spawn:

```js
const proposerBrief = [
  "You are ONE independent proposer writing a PLAN for the task below entirely on your own.",
  "You do not know whether anyone else is planning it; never reference other proposers, critics, or an aggregator.",
  "The deliverable is a plan, not an implementation — investigate read-only (web/bash) to ground it; never modify project files.",
  "Structure: ## Objective, ## Approach (ordered concrete steps), ## Key decisions, ## Risks & mitigations, ## Verification.",
  "Return ONLY the plan.",
].join("\n");

const criticBrief = [
  "You are ONE independent critic reviewing several plans produced blind and in parallel for the same task.",
  "You did not write them; other critics may exist but you are blind to them — never reference them.",
  "Do not write your own plan. Output exactly four sections: ## Consensus (points 2+ proposers share, with counts),",
  "## Contradictions (conflicting stances attributed 'Proposer N (model)', adjudicated where evidence permits),",
  "## Unique opinions (single-proposer points, each with a keep/drop verdict), ## Recommendation (one paragraph:",
  "what the final plan should adopt, drop, and watch out for). Never invent a position; verify checkable claims.",
].join("\n");

const aggregatorBrief = [
  "You are the aggregator. Integrate the critic comments below into ONE final plan for the original task.",
  "Comments are primary; the raw proposals are appended for grounding. Cross-critic agreement = highest confidence;",
  "adjudicate critic disagreements by reading the proposals, not by majority. Do not vote, average, or staple plans.",
  "Output: # Final plan — <title>, then ## Objective, ## Approach (ordered concrete steps), ## Risks & mitigations,",
  "## Verification, ## Synthesis notes (what was adopted from which proposer/critic, contradiction resolutions, residual uncertainty).",
  "If no critic comments are present, do the comparative analysis yourself inside Synthesis notes, then write the plan.",
].join("\n");
```

In plugin mode, wave 1 prompts use `${proposerBrief}\n\n=== TASK ===\n${task}`, wave 2 prompts use `${criticBrief}\n\n${criticInput}`, and wave 3 prompts use `${aggregatorBrief}\n\n${aggInput}`, each spawned with `{ agent: "task", model: <m>, label: ... }`.

The fuller canonical prompts live in `agents/ultrafusion-*.md` + `references/*.md`.

---

### Robustness & failure handling

- **Empty proposal = failure.** Blank/whitespace-only or budget-burned proposers are dropped before the critics. Keep original proposal numbering after drops so "Proposer 3" stays traceable.
- **< 2 surviving proposals → skip critics AND aggregator.** Return the single plan directly with a one-line degradation note (nothing to compare).
- **Empty comment = failure.** Dropped before the aggregator. **0 surviving comments → still run the aggregator** with task + proposals only; its degraded mode (in its system prompt) does the comparative analysis itself. 1–2 comments → proceed normally.
- **Truncation guards.** Before wave 2: truncate each proposal to roughly `critic_context_window / (2 × N_plans)` bytes, appending `[truncated for critics]`. Before wave 3: truncate each comment and each proposal to roughly `aggregator_context_window / (2 × (N_comments + N_plans))` bytes, appending `[truncated for aggregator]`.
- **Read-only wave 1.** Proposers never write project files (their agent has no edit/write); plans are yielded text, so parallel spawns cannot collide.

---

## 5. Invariants (do not break these)

- Same prompt to every proposer, **verbatim**. No personas, no "lenses".
- Proposers are **blind** to each other and run in **parallel**.
- Critics are **blind** to each other and run in **parallel**, each evaluating ALL surviving proposals.
- Strict wave order: all proposers → all critics → aggregator. No debate rounds or feedback loops.
- Never fewer than two proposers; floor mode runs the same model twice.
- The aggregator is a separate spawn that synthesizes from comments; it never picks a favorite proposal or averages.
- Proposer, critic, and aggregator models are **configurable** (roles + overrides). The method is fixed; the models are the user's choice.

---

## 6. Optional provenance

On explicit request only, after presenting the final plan write a timestamped run file to `.fusion/runs/<UTC-timestamp>-ultrafusion.md` containing: the task, resolved models, every proposal, every critic comment, and the final plan. Skip silently otherwise.
