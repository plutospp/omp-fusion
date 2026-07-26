---
name: ultrafusion
description: >-
  Plan a hard task by fanning it out to EXPLORER models in parallel (each investigating independently,
  reporting findings), then PROPOSER models in parallel (each critiquing the explorer findings and
  committing to one complete plan), then ONE AGGREGATOR model that integrates the proposals into the
  final plan. Explorers, proposers, and aggregator are ordinary OMP subagents whose models come from
  modelRoles (fusion_explorer_1..6, fusion_proposer_1..6, fusion_aggregator) or a per-invocation
  override, falling back to legacy ultrafusion roles, then to built-in defaults. Use when the user says
  "ultrafusion", "ultra fusion", "multi-model plan", "plan this with proposers", "committee plan", or
  wants several models to plan something before committing to an approach.
---

# Ultrafusion — explorers then proposers then aggregator

Ultrafusion plans a hard task using three strict waves: **explorers** run in parallel to investigate the task independently and report findings, **proposers** run in parallel (blind to each other, each reading every explorer's findings) to critique the findings and commit to one complete plan each, and **1 aggregator** integrates the proposals into the final plan.

This is a **three-stage planning pipeline** (explorers then proposers then aggregator), *not* voting or averaging. The aggregator synthesizes from the proposals, which already carry the comparative critique.

Key properties:
- **Independence within waves.** Explorers investigate blind to each other. Proposers plan blind to each other.
- **Critique folded into proposing.** Each proposer assesses the explorer findings (consensus, contradictions, unique points) before committing to its own plan — the comparative duty that a separate critic wave once performed.
- **Synthesis, not voting.** The aggregator synthesizes proposals into one final plan; it never averages or tally-votes.
- **Strict single-pass execution.** One blind pass per wave. No debate rounds, no feedback loops.

---

## 1. Pick the models

Resolve models in this precedence for each group (explorers / proposers / aggregator) **independently** (first match wins per group):

1. **Explicit override** in the invocation:
   `--explorers <m1>,<m2>,...`, `--proposers <m1>,...`, and/or `--aggregator <m>` (OMP model strings or `pi/<role>` aliases, each optionally suffixed with a `:thinking`). List lengths govern counts.
   Alias: `--critics` maps to `--proposers` (the critic duty merged into the proposer wave).
2. **Configured roles** in `~/.omp/agent/config.yml` then `modelRoles`:
   - `fusion_explorer_1..6` (use however many are set)
   - `fusion_proposer_1..6` (use however many are set)
   - `fusion_aggregator`
3. **LEGACY fallback** (deprecated, still resolves):
   - explorers: `ultrafusion_proposer_1..6` (was wave 1), then `fusion_panel_1..N` cycled to 6 slots
   - proposers: `ultrafusion_critic_1..3` (was wave 2), then `fusion_panel_1..N` cycled to 6 slots
   - aggregator: `ultrafusion_aggregator`, then `fusion_judge`
4. **Built-in defaults**:
   - explorers: `pi/slow, pi/default` cycled to 6 slots
   - proposers: `pi/slow, pi/default` cycled to 6 slots
   - aggregator: `pi/slow`

**Floor rules:**
- Never run fewer than **two explorers** or **two proposers**. If exactly one model resolves for a wave, run it twice as two cold, independent runs.
- Aggregator: exactly 1.

**Recommended `modelRoles` block** (cross-family setup; `scripts/detect_panel.sh` prints a tailored suggestion):

```yaml
modelRoles:
  fusion_aggregator:  anthropic/claude-opus-4-8:high
  fusion_explorer_1: anthropic/claude-opus-4-8:high
  fusion_explorer_2: openai-codex/gpt-5.5:high
  fusion_explorer_3: google-antigravity/gemini-3.5-flash
  fusion_proposer_1: anthropic/claude-opus-4-8:high
  fusion_proposer_2: openai-codex/gpt-5.5:high
  fusion_proposer_3: google-antigravity/gemini-3.5-flash
```

Resolve role aliases yourself by passing the `pi/<role>` string as the subagent `model` — OMP resolves the alias against `modelRoles`. Do **not** hardcode a vendor.

---

## 2. Wave 1 — fan out the explorers

Give every explorer the **verbatim user task**. The `fusion-explorer` agent enforces independence and findings-only output (no plan, no recommendation).

Canonical `eval` mechanism (note: the option key is `agent:`, verified against the current OMP eval prelude — the older key name is stale; never use it):

```js
// task = the verbatim user task (substitute it; no edits, no added "lenses")
const task = `<<<VERBATIM USER TASK>>>`;

// resolved per section 1
const explorers = ["pi/fusion_explorer_1", "pi/fusion_explorer_2", "pi/fusion_explorer_3",
                   "pi/fusion_explorer_4", "pi/fusion_explorer_5", "pi/fusion_explorer_6"];
const proposers = ["pi/fusion_proposer_1", "pi/fusion_proposer_2", "pi/fusion_proposer_3",
                   "pi/fusion_proposer_4", "pi/fusion_proposer_5", "pi/fusion_proposer_6"];
const aggregatorModel = "pi/fusion_aggregator";

// parallel + agent are async — await them; parallel preserves input order.
const rawFindings = await parallel(
  explorers.map((m, i) => () => agent(task, { agent: "fusion-explorer", model: m, label: `explorer ${i + 1}` })),
);

// drop failures but KEEP ORIGINAL NUMBERING so proposer attributions stay traceable
const findings = rawFindings
  .map((f, i) => ({ n: i + 1, model: explorers[i], text: (f ?? "").trim() }))
  .filter(s => s.text);
```

---

## 3. Wave 2 — fan out the proposers

Every proposer receives the **identical input**: original task + ALL surviving explorer findings (truncated per robustness). Proposers run in parallel, blind to each other. Each critiques the findings, then commits to one complete plan.

```js
const findingsBlock = findings.map(s => `=== EXPLORER FINDINGS ${s.n} (model: ${s.model}) ===\n${s.text}`).join("\n\n");
const proposerInput = `=== ORIGINAL TASK ===\n${task}\n\n${findingsBlock}`;

const rawPlans = await parallel(
  proposers.map((m, i) => () => agent(proposerInput, { agent: "fusion-proposer", model: m, label: `proposer ${i + 1}` })),
);
const plans = rawPlans
  .map((p, i) => ({ n: i + 1, model: proposers[i], text: (p ?? "").trim() }))
  .filter(s => s.text);
```

If **0 explorers survived**, proposers run on the bare task (`proposerInput = task`) — ultrafusion degrades to the fusion shape rather than failing.

---

## 4. Wave 3 — aggregator then final plan

Input order: task, then proposals. Explorer findings are NOT forwarded to the aggregator (the proposals already carry them). Present the aggregator's output as the response, leading with the plan.

```js
const aggInput = [
  `=== ORIGINAL TASK ===\n${task}`,
  ...plans.map(s => `=== PROPOSAL ${s.n} (model: ${s.model}) ===\n${s.text}`),
].join("\n\n");

const finalPlan = await agent(aggInput, { agent: "fusion-aggregator", model: aggregatorModel });
display(finalPlan);
```

---

### Plugin mode — no custom agents

When Ultrafusion is installed as an OMP plugin (`omp plugin link`/`install`), only `skills/` and `commands/` are discovered — the custom subagents are not. Use the bundled **`task`** agent (`agent: "task"`) and carry the inlined briefs in every spawn:

```js
const explorerBrief = [
  "You are ONE independent explorer investigating the task below entirely on your own.",
  "You do not know whether anyone else is investigating it; never reference other explorers, proposers, or an aggregator.",
  "Your job is to INVESTIGATE and REPORT FINDINGS, not to commit to a solution.",
  "Scratch work: you may write files ONLY inside your assigned scratch root (.fusion/scratch/<run-id>/explorer-N/).",
  "Permitted: creating new files inside your scratch root, by write or bash.",
  "Forbidden: modifying or overwriting any file that already existed, by any means (edit, write, sed -i, >, >>, mv, cp).",
  "Return ONLY your findings: ## Key findings, ## Evidence, ## Open questions.",
].join("\n");

const proposerBrief = [
  "You are ONE independent proposer. You receive the task and every explorer's findings.",
  "You do not know whether anyone else is proposing; never reference other proposers or an aggregator.",
  "FIRST assess the findings: consensus, contradictions (attributed), unique single-source points.",
  "THEN commit to ONE complete plan grounded in that assessment.",
  "Scratch work: you may write files ONLY inside your assigned scratch root (.fusion/scratch/<run-id>/proposer-N/).",
  "Permitted: creating new files inside your scratch root, by write or bash.",
  "Forbidden: modifying or overwriting any file that already existed, by any means (edit, write, sed -i, >, >>, mv, cp).",
  "Structure: ## Assessment, then ## Candidate with ## Objective, ## Approach (ordered concrete steps),",
  "## Key decisions, ## Risks & mitigations, ## Verification. Return ONLY your candidate.",
].join("\n");

const aggregatorBrief = [
  "You are the aggregator. Integrate the proposals below into ONE final plan for the original task.",
  "Cross-proposer agreement = highest confidence; adjudicate disagreements by reading the proposals,",
  "not by majority. Do not vote, average, or staple plans.",
  "You have edit/write — if the task requires a working artifact rather than only a description of one,",
  "produce and verify it with bash before writing the final plan. You are the sole writer of project paths.",
  "Output: # Final plan — <title>, then ## Objective, ## Approach (ordered concrete steps), ## Key decisions,",
  "## Risks & mitigations, ## Verification, ## Synthesis notes (what was adopted from which proposer,",
  "contradiction resolutions, residual uncertainty).",
].join("\n");
```

In plugin mode, wave 1 prompts use `${explorerBrief}\n\n=== TASK ===\n${task}`, wave 2 prompts use `${proposerBrief}\n\n${proposerInput}`, and wave 3 prompts use `${aggregatorBrief}\n\n${aggInput}`, each spawned with `{ agent: "task", model: <m>, label: ... }`.

The fuller canonical prompts live in `agents/fusion-*.md` + `references/aggregator_rubric.md`.

---

### Robustness & failure handling

- **Empty finding = failure.** Blank/whitespace-only or budget-burned explorers are dropped before the proposers. Keep original explorer numbering after drops so "Explorer 3" stays traceable.
- **0 surviving explorers then proposers run on the bare task.** Ultrafusion degrades to the fusion shape rather than failing.
- **Empty proposal = failure.** Dropped before the aggregator. Keep original proposal numbering.
- **< 2 surviving proposals then skip the aggregator.** Return the single plan directly with a one-line degradation note (nothing to compare).
- **Truncation guards.** Before wave 2: truncate each finding to roughly `proposer_context_window / (2 x N_findings)` bytes, appending `[truncated for proposers]`. Before wave 3: truncate each proposal to roughly `aggregator_context_window / (2 x N_proposals)` bytes, appending `[truncated for aggregator]`.
- **Scratch-only waves.** Explorers and proposers may create files inside their assigned scratch root (`.fusion/scratch/<run-id>/<wave>-N/`) for verification work. They must never modify or overwrite any pre-existing file, by any means (edit, write, sed -i, redirection, mv, cp). The aggregator is the sole writer of project paths. Deliverables are returned as inline text, so parallel spawns cannot collide on project files.

---

## 5. Invariants (do not break these)

- Same prompt to every explorer and every proposer, **verbatim**. No personas, no "lenses".
- Explorers are **blind** to each other and run in **parallel**.
- Proposers are **blind** to each other and run in **parallel**, each evaluating ALL surviving explorer findings.
- Strict wave order: all explorers then all proposers then aggregator. No debate rounds or feedback loops.
- Never fewer than two explorers or two proposers; floor mode runs the same model twice.
- The aggregator is a separate spawn that synthesizes from proposals; it never picks a favorite proposal or averages.
- Explorer, proposer, and aggregator models are **configurable** (roles + overrides). The method is fixed; the models are the user's choice.

---

## 6. Optional provenance

On explicit request only, after presenting the final plan write a timestamped run file to `.fusion/runs/<UTC-timestamp>-ultrafusion.md` containing: the task, resolved models, every explorer finding, every proposal, and the final plan. Skip silently otherwise.
