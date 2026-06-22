---
name: fusion
description: >-
  Answer a hard question by fanning it out to a PANEL of models running in parallel — each answering
  the SAME prompt independently with web search and bash, none seeing the others' work — then having a
  JUDGE model read every answer and write a final answer grounded in a structured analysis (consensus,
  contradictions, partial coverage, unique insights, blind spots). The panel and judge are ordinary OMP
  subagents whose models are chosen from `modelRoles` (or a per-invocation override), so it runs on
  whatever providers the user has configured. Floor mode runs the same model twice as two cold,
  independent panelists. Use when the user says "run it through fusion", "panel of models", "fuse the
  models", "get a second/third opinion in parallel", or asks a hard question that benefits from
  independent cross-model corroboration before an answer is committed.
---

# Fusion — independence, then synthesis

Fusion answers one hard question by running a **panel** of models in **parallel**, each answering the
**same prompt independently** (web + bash, none seeing the others' work), then having a **judge** model
read every answer and write a final answer grounded in a structured analysis.

This is an **information-fusion** pipeline (fan-out → judge), *not* "ask several models and average."
The value comes from two things and you must preserve both:

1. **Independence.** Panelists answer the verbatim task with no awareness of each other, no assigned
   "lenses"/personas, no shared scratchpad. Independent agreement is the highest-confidence signal;
   honest disagreement is the most useful thing a panel produces. Two cold runs of the *same* model
   are a valid panel — divergence comes from sampling, not from prompt-engineered roles.
2. **Synthesis, not voting.** The judge does not tally or average. It classifies the deliverable, then
   either merges-and-verifies an artifact (Track A) or writes a structured synthesis (Track B).

The judge is a **separate subagent**, so its model is chosen independently of the session model — like
`/advisor`, the judge model is configurable. The panel never sees the judge; the judge sees every
panelist after all have returned.

---

## 1. Pick the panel and judge models

Resolve models in this precedence (first that applies wins):

1. **Explicit override** in the invocation:
   `--panel <m1>,<m2>,...` and/or `--judge <m>` (models are OMP model strings or `pi/<role>` aliases,
   each optionally suffixed with a thinking level, e.g. `:high`).
2. **Pinned command** — if invoked via `/fusion-solo|pair|trio`, use that command's fixed panel
   (see those command files).
3. **Configured roles** in `~/.omp/agent/config.yml` → `modelRoles`:
   - judge: `pi/fusion_judge`
   - panel: `pi/fusion_panel_1`, `pi/fusion_panel_2`, `pi/fusion_panel_3` (use however many are set)
4. **Defaults** when no roles are set:
   - judge: `pi/slow`
   - panel: `pi/slow` + `pi/default` (a 2-model cross-family panel using built-in roles)

**Floor / always-available mode:** if only one usable model exists, run that model **twice** as two
independent cold panelists (`/fusion-solo` does this with `pi/slow`). Never fall below two panelists.

**Recommended `modelRoles` block** (cross-family panel; adjust to the providers the user actually has —
`scripts/detect_panel.sh` prints a tailored suggestion):

```yaml
modelRoles:
  fusion_judge:   anthropic/claude-opus-4-8:high
  fusion_panel_1: anthropic/claude-opus-4-8:high
  fusion_panel_2: openai-codex/gpt-5.5:high
  fusion_panel_3: google-antigravity/gemini-3.5-flash   # antigravity serves flash; a Pro tier needs google-vertex / google-gemini-cli auth
```

Resolve role aliases yourself by passing the `pi/<role>` string as the subagent `model` — OMP resolves
the alias against `modelRoles` (and applies provider fallback if a provider is down). Do **not** hardcode
a vendor or a proxy; whatever the user configured is the panel.

---

## 2. Fan out the panel (parallel, independent)

Give every panelist the **verbatim user task**. The `fusion-panel` agent's own system prompt already
enforces independence (no awareness of other panelists, no personas/lenses), so you only supply the task.
Spawn all panelists in ONE wave so they run at once.

Canonical mechanism — the `eval` tool (deterministic fan-out via `parallel` + `agent`):

```js
// task = the verbatim user question/instruction (substitute it; no edits, no added "lenses")
const task = `<<<VERBATIM USER TASK>>>`;

// models resolved per section 1 (override → command → roles → defaults); >= 2 entries
const panel = ["pi/fusion_panel_1", "pi/fusion_panel_2", "pi/fusion_panel_3"];
const judgeModel = "pi/fusion_judge";

// `parallel` and `agent` are ASYNC — await them. agent() resolves to the subagent's final text.
// The fusion-panel agent supplies the "independent panelist" framing; pass it the verbatim task.
const answers = await parallel(
  panel.map((m, i) => () => agent(task, { agentType: "fusion-panel", model: m, label: `panel ${i + 1}` })),
);
```

Notes:
- `parallel` and `agent` are **async — `await` them** (as above). `agent()` resolves to the subagent's
  final text; `parallel` preserves input order.
- The `model` passed to `agent()` is authoritative for that panelist (`modelOverride ?? agent.model`),
  so a single `fusion-panel` agent yields a cross-model panel.
- If `eval` is unavailable, define per-slot agent variants (e.g. `fusion-panel-b` / `-c`) that pin
  different models in their frontmatter and run them in parallel via the `task` tool — the `task` tool
  fixes one model per agent *type*, so it cannot vary models within a single call.
- Never inject panelist answers back into other panelists. No debate rounds. One blind pass.

### Plugin mode — no custom agents (`omp plugin` installs)

When Fusion is installed as an OMP **plugin** (`omp plugin link`/`install`), only `skills/` and
`commands/` are discovered — the `fusion-panel`/`fusion-judge` agents are **not** (OMP doesn't discover
`agents/` from a plugin surface). Use the bundled **`task`** agent and carry the panelist brief + judge
rubric in the prompt. Same independence + synthesis; zero custom-agent dependency.

```js
const task = `<<<VERBATIM USER TASK>>>`;
const panel = ["pi/fusion_panel_1", "pi/fusion_panel_2", "pi/fusion_panel_3"];
const judgeModel = "pi/fusion_judge";

const panelBrief = [
  "You are ONE independent panelist answering the task below entirely on your own.",
  "You do not know whether anyone else is answering it; never reference other panelists or a synthesizer.",
  "Answer completely and self-containedly; use web search + bash to verify. No personas/lenses.",
  "Return ONLY your final answer (for artifacts, include how you verified them).",
].join("\n");

const judgeRubric = [
  "You are the Fusion judge. You did not write these answers; do not vote or average.",
  "First classify the deliverable. Artifact/code -> Track A: run each candidate with bash, keep the",
  "working parts, merge into one artifact, run+fix it, give a brief merge rationale.",
  "Research/analysis -> Track B: write Consensus / Contradictions / Partial coverage / Unique insights /",
  "Blind spots, then the Final answer grounded in them. Lead with the answer, not a preamble.",
].join("\n");

// parallel + agent are async — await. The bundled `task` agent has full tools; model override wins.
const answers = await parallel(
  panel.map((m, i) => () => agent(`${panelBrief}\n\n=== TASK ===\n${task}`,
    { agentType: "task", model: m, label: `panel ${i + 1}` })),
);
const judgeInput = [
  judgeRubric,
  `=== ORIGINAL TASK ===\n${task}`,
  ...answers.map((a, i) => `=== PANELIST ${i + 1} (model: ${panel[i]}) ===\n${a}`),
].join("\n\n");
const verdict = await agent(judgeInput, { agentType: "task", model: judgeModel });
display(verdict);
```

The fuller canonical prompts live in `agents/fusion-panel.md` + `references/judge_rubric.md`; the inlined
briefs above are the self-contained no-agent path. Cross-harness notes: `docs/CROSS-COMPAT.md`.

---

## 3. Judge (separate subagent) → final answer

After all panelists return, hand the **original task** and **every panelist answer** to the judge. You do
not need to pass the rubric text: the `fusion-judge` agent already carries the Track A / Track B rubric in
its system prompt (`references/judge_rubric.md` is its canonical spec). Give it the task and each answer:

```js
// the fusion-judge agent carries the rubric; it only needs the task + every panelist answer.
const judgeInput = [
  `=== ORIGINAL TASK ===\n${task}`,
  ...answers.map((a, i) => `=== PANELIST ${i + 1} (model: ${panel[i]}) ===\n${a}`),
].join("\n\n");

const verdict = await agent(judgeInput, { agentType: "fusion-judge", model: judgeModel });
display(verdict);
```

The judge:
- **does not vote or average.**
- **first classifies the deliverable** → Track A (artifact: run, merge, verify) or Track B (research:
  structured synthesis).
- writes the **final answer** the user receives.

Present the judge's final answer as the response. Lead with the answer/artifact; the structured analysis
(consensus / contradictions / partial coverage / unique insights / blind spots) is the audit trail behind
it, not a preamble.

---

## 4. Invariants (do not break these)

- Same prompt to every panelist, **verbatim**. No personas, no "you are the optimist/pessimist", no
  per-panelist lenses — unless the user explicitly asks for lensing.
- Panelists are **blind** to each other and run in **parallel**.
- The **judge is a separate model/subagent** from the panelists and synthesizes; it never just picks a
  favorite or averages.
- Never fewer than two panelists; the floor is the same model run twice.
- Panel/judge models are **configurable** (roles + override). The fusion *method* is fixed; the *models*
  are the user's choice.

## 5. Optional provenance

If the user wants a record, after presenting the answer write a timestamped run file to
`.fusion/runs/<UTC-timestamp>.md` containing: the task, the panel + judge models used, each panelist
answer, and the judge's synthesis. Skip silently otherwise.
