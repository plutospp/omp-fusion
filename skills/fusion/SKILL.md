---
name: fusion
description: >-
  Answer a hard question by fanning it out to independent PROPOSER models running in parallel, each
  answering the SAME prompt with web search and bash, none seeing the others' work, then having an
  AGGREGATOR model read every candidate and write a final answer grounded in a structured analysis
  (consensus, contradictions, partial coverage, unique insights, blind spots). Proposers and aggregator
  are ordinary OMP subagents whose models come from modelRoles (or a per-invocation override), so it
  runs on whatever providers the user has configured. Floor mode runs the same model twice as two cold,
  independent proposers. Use when the user says "run it through fusion", "panel of models", "fuse the
  models", "get a second/third opinion in parallel", or asks a hard question that benefits from
  independent cross-model corroboration before an answer is committed.
---

# Fusion — independence, then synthesis

Fusion answers one hard question by running **proposers** in **parallel**, each answering the
**same prompt independently** (web + bash, none seeing the others' work), then having an **aggregator**
model read every candidate and write a final answer grounded in a structured analysis.

This is an **information-fusion** pipeline (fan-out then aggregator), *not* "ask several models and average."
The value comes from two things and you must preserve both:

1. **Independence.** Proposers answer the verbatim task with no awareness of each other, no assigned
   "lenses"/personas, no shared scratchpad. Independent agreement is the highest-confidence signal;
   honest disagreement is the most useful thing a proposer wave produces. Two cold runs of the *same*
   model are a valid wave — divergence comes from sampling, not from prompt-engineered roles.
2. **Synthesis, not voting.** The aggregator does not tally or average. It classifies the deliverable,
   then either merges-and-verifies an artifact (Track A) or writes a structured synthesis (Track B).

The aggregator is a **separate subagent**, so its model is chosen independently of the session model.
The proposers never see the aggregator; the aggregator sees every proposer after all have returned.

---

## 1. Pick the proposer and aggregator models

Resolve models in this precedence (first that applies wins):

1. **Explicit override** in the invocation:
   `--proposers <m1>,<m2>,...` and/or `--aggregator <m>` (models are OMP model strings or `pi/<role>`
   aliases, each optionally suffixed with a thinking level, e.g. `:high`).
   Aliases: `--panel` maps to `--proposers`; `--judge` maps to `--aggregator`.
2. **Pinned command** — if invoked via `/fusion-solo|pair|trio`, use that command's fixed proposers
   (see those command files).
3. **Configured roles** in `~/.omp/agent/config.yml` then `modelRoles`:
   - aggregator: `pi/fusion_aggregator`
   - proposers: `pi/fusion_proposer_1`, `pi/fusion_proposer_2`, `pi/fusion_proposer_3` (use however many are set)
4. **LEGACY fallback** (deprecated, still resolves):
   - aggregator: `fusion_judge`
   - proposers: `fusion_panel_1..3`
5. **Defaults** when no roles are set:
   - aggregator: `pi/slow`
   - proposers: `pi/slow` + `pi/default` (a 2-model cross-family wave using built-in roles)

**Floor / always-available mode:** if only one usable model exists, run that model **twice** as two
independent cold proposers (`/fusion-solo` does this with `pi/slow`). Never fall below two proposers.

**Recommended `modelRoles` block** (cross-family proposers; adjust to the providers the user actually has —
`scripts/detect_panel.sh` prints a tailored suggestion):

```yaml
modelRoles:
  fusion_aggregator:  anthropic/claude-opus-4-8:high
  fusion_proposer_1: anthropic/claude-opus-4-8:high
  fusion_proposer_2: openai-codex/gpt-5.5:high
  fusion_proposer_3: google-antigravity/gemini-3.5-flash   # antigravity serves flash; a Pro tier needs google-vertex / google-gemini-cli auth
```

Resolve role aliases yourself by passing the `pi/<role>` string as the subagent `model` — OMP resolves
the alias against `modelRoles` (and applies provider fallback if a provider is down). Do **not** hardcode
a vendor or a proxy; whatever the user configured is the proposer wave.

---

## 2. Fan out the proposers (parallel, independent)

Give every proposer the **verbatim user task**. The `fusion-proposer` agent's own system prompt already
enforces independence (no awareness of other proposers, no personas/lenses), so you only supply the task.
Spawn all proposers in ONE wave so they run at once.

Canonical mechanism — the `eval` tool (deterministic fan-out via `parallel` + `agent`):

```js
// task = the verbatim user question/instruction (substitute it; no edits, no added "lenses")
const task = `<<<VERBATIM USER TASK>>>`;

// models resolved per section 1 (override then command then roles then defaults); >= 2 entries
const proposers = ["pi/fusion_proposer_1", "pi/fusion_proposer_2", "pi/fusion_proposer_3"];
const aggregatorModel = "pi/fusion_aggregator";

// `parallel` and `agent` are ASYNC — await them. agent() resolves to the subagent's final text.
// The fusion-proposer agent supplies the "independent proposer" framing; pass it the verbatim task.
const answers = await parallel(
  proposers.map((m, i) => () => agent(task, { agent: "fusion-proposer", model: m, label: `proposer ${i + 1}` })),
);
```

Notes:
- `parallel` and `agent` are **async — `await` them** (as above). `agent()` resolves to the subagent's
  final text; `parallel` preserves input order.
- The `model` passed to `agent()` is authoritative for that proposer (`modelOverride ?? agent.model`),
  so a single `fusion-proposer` agent yields a cross-model wave.
- If `eval` is unavailable, define per-slot agent variants that pin different models in their frontmatter
  and run them in parallel via the `task` tool — the `task` tool fixes one model per agent *type*, so it
  cannot vary models within a single call.
- Never inject proposer answers back into other proposers. No debate rounds. One blind pass.

### Plugin mode — no custom agents (`omp plugin` installs)

When Fusion is installed as an OMP **plugin** (`omp plugin link`/`install`), only `skills/` and
`commands/` are discovered — the `fusion-proposer`/`fusion-aggregator` agents are **not** (OMP doesn't
discover `agents/` from a plugin surface). Use the bundled **`task`** agent and carry the proposer brief
+ aggregator rubric in the prompt. Same independence + synthesis; zero custom-agent dependency.

```js
const task = `<<<VERBATIM USER TASK>>>`;
const proposers = ["pi/fusion_proposer_1", "pi/fusion_proposer_2", "pi/fusion_proposer_3"];
const aggregatorModel = "pi/fusion_aggregator";

const proposerBrief = [
  "You are ONE independent proposer answering the task below entirely on your own.",
  "You do not know whether anyone else is answering it; never reference other proposers or an aggregator.",
  "Answer completely and self-containedly; use web search + bash to verify. No personas/lenses.",
  "Scratch work: you may write files ONLY inside your assigned scratch root (.fusion/scratch/<run-id>/proposer-N/).",
  "Permitted: creating new files inside your scratch root, by write or bash.",
  "Forbidden: modifying or overwriting any file that already existed, by any means (edit, write, sed -i, >, >>, mv, cp).",
  "Deliverable: return your candidate as complete inline text (fenced code blocks for artifacts).",
  "Return ONLY your final answer (for artifacts, include how you verified them).",
].join("\n");

const aggregatorRubric = [
  "You are the Fusion aggregator. You did not write these candidates; do not vote or average.",
  "First classify the deliverable. Artifact/code -> Track A: proposers returned code as text (verified",
  "via ephemeral bash, scratch writes only) — materialize each candidate to its own scratch path, run each",
  "with bash, keep the working parts, merge into one artifact, run+fix it, give a brief merge rationale.",
  "Research/analysis -> Track B: write Consensus / Contradictions / Partial coverage / Unique insights /",
  "Blind spots, then the Final answer grounded in them. Lead with the answer, not a preamble.",
].join("\n");

// parallel + agent are async — await. The bundled `task` agent has full tools; model override wins.
const answers = await parallel(
  proposers.map((m, i) => () => agent(`${proposerBrief}\n\n=== TASK ===\n${task}`,
    { agent: "task", model: m, label: `proposer ${i + 1}` })),
);
const aggregatorInput = [
  aggregatorRubric,
  `=== ORIGINAL TASK ===\n${task}`,
  ...answers.map((a, i) => `=== PROPOSER ${i + 1} (model: ${proposers[i]}) ===\n${a}`),
].join("\n\n");
const verdict = await agent(aggregatorInput, { agent: "task", model: aggregatorModel });
display(verdict);
```

The fuller canonical prompts live in `agents/fusion-proposer.md` + `references/aggregator_rubric.md`; the
inlined briefs above are the self-contained no-agent path. Cross-harness notes: `docs/CROSS-COMPAT.md`.

---

## 3. Aggregator (separate subagent) then final answer

After all proposers return, hand the **original task** and **every proposer candidate** to the aggregator.
You do not need to pass the rubric text: the `fusion-aggregator` agent already carries the Track A / Track B
rubric in its system prompt (`references/aggregator_rubric.md` is its canonical spec). Give it the task and
each candidate:

```js
// the fusion-aggregator agent carries the rubric; it only needs the task + every proposer candidate.
const aggregatorInput = [
  `=== ORIGINAL TASK ===\n${task}`,
  ...answers.map((a, i) => `=== PROPOSER ${i + 1} (model: ${proposers[i]}) ===\n${a}`),
].join("\n\n");

const verdict = await agent(aggregatorInput, { agent: "fusion-aggregator", model: aggregatorModel });
display(verdict);
```

The aggregator:
- **does not vote or average.**
- **first classifies the deliverable** then Track A (artifact: run, merge, verify) or Track B (research:
  structured synthesis).
- writes the **final answer** the user receives.

Present the aggregator's final answer as the response. Lead with the answer/artifact; the structured
analysis (consensus / contradictions / partial coverage / unique insights / blind spots) is the audit
trail behind it, not a preamble.

### Robustness & failure handling

Apply these to every proposer wave (default and plugin modes):

- **Empty answer = failure.** A proposer whose text is blank/whitespace-only — or that burned its
  tool-call / loop budget without producing a final answer — is a **failure**, not a blank success.
  Drop it; never pass an empty "answer" to the aggregator.
- **< 2 real answers then skip the aggregator.** If fewer than two proposers succeed there is nothing to
  compare: return the single answer directly with a one-line note that the wave degraded (the aggregator
  only adds value across 2 or more independent answers). This is distinct from `/fusion-solo`, which is
  two cold runs of the *same* model — a real 2-proposer comparison.
- **Guard the aggregator's context.** Before the aggregator, truncate each proposer candidate to roughly
  `aggregator_context_window / (2 x N_successful)` bytes (append a `[truncated for aggregator]` marker).
  A large wave of long answers can otherwise overflow the aggregator.
- **Proposers write scratch only.** Proposers may create files inside their assigned scratch root
  (`.fusion/scratch/<run-id>/proposer-N/`) for verification work. They must never modify or overwrite
  any pre-existing file, by any means (edit, write, sed -i, redirection, mv, cp). The aggregator is the
  sole writer of project paths. Artifact/code proposers return their candidate as inline text (fenced
  code blocks); the aggregator materializes each to its own scratch path and merges from there (see
  `references/aggregator_rubric.md` Track A).

### Analysis-only mode (optional)

Default Fusion has the **aggregator write the final answer** (it is the independent synthesizer — the
DARPA-faithful path). Some users prefer the OpenRouter-Fusion shape: the aggregator only *analyzes*, and
the **user's own active/session model writes the final answer** from that analysis. Enable it with
`/fusion --analysis-only` (or prose: "analysis only", "let my model write the final answer").

In this mode the aggregator returns **only** this JSON (no `final_answer`, no prose, no code fences):

```json
{
  "consensus": ["points all/most proposers agree on — higher-confidence"],
  "contradictions": [{ "topic": "...", "stances": [{ "model": "provider/id", "stance": "..." }] }],
  "partial_coverage": [{ "models": ["provider/id"], "point": "..." }],
  "unique_insights": [{ "model": "provider/id", "insight": "..." }],
  "blind_spots": ["topics no proposer addressed"]
}
```

Then **you (the orchestrator / session model) write the final answer** grounded in that analysis —
prefer consensus, resolve contradictions on the evidence, fold in unique insights, and note blind spots.
When the flag is absent, the default (separate aggregator writes the answer) is unchanged.

---

## 4. Invariants (do not break these)

- Same prompt to every proposer, **verbatim**. No personas, no "you are the optimist/pessimist", no
  per-proposer lenses — unless the user explicitly asks for lensing.
- Proposers are **blind** to each other and run in **parallel**.
- The **aggregator is a separate model/subagent** from the proposers and synthesizes; it never just picks
  a favorite or averages.
- Never fewer than two proposers; the floor is the same model run twice.
- Proposer/aggregator models are **configurable** (roles + override). The fusion *method* is fixed; the
  *models* are the user's choice.

## 5. Optional provenance

If the user wants a record, after presenting the answer write a timestamped run file to
`.fusion/runs/<UTC-timestamp>.md` containing: the task, the proposer + aggregator models used, each
proposer candidate, and the aggregator's synthesis. Skip silently otherwise.
