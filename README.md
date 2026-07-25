# omp-fusion

**Fuse a panel of frontier models into one judged answer — natively in [OMP](https://github.com/can1357/oh-my-pi) (`omp`).**

Fusion runs a hard question through a **panel → judge** pipeline. The same prompt is dispatched to
several models *in parallel* — each answering independently with web search and bash, none seeing the
others' work — then a **judge** model reads every answer and writes a final answer grounded in a
structured analysis (consensus, contradictions, partial coverage, unique insights, blind spots).

This is real information fusion (independence → synthesis), **not** "ask several models and average."

This is an OMP-native port of [duolahypercho/fusion-fable](https://github.com/duolahypercho/fusion-fable)
(a Claude Code skill). See [`NOTICE`](NOTICE) for what is preserved and what changed.

---

## Why this shape

- **Independence is the signal.** Panelists get the verbatim task, blind to each other, no personas/
  "lenses". Two cold runs of the *same* model is a valid panel — divergence comes from sampling.
- **The judge synthesizes, it doesn't vote.** It classifies the deliverable, then either merges-and-
  verifies an artifact (Track A) or writes a five-section synthesis (Track B).
- **Any provider, your choice.** Panel and judge models are ordinary OMP subagents resolved through
  `modelRoles` (or a per-invocation override) — like how `/advisor`'s model is configured. No CLI
  wrappers (`run_codex`/`run_gemini`/`agy`), no hardcoded vendor or proxy.
- **The judge is a separate subagent**, so its model is chosen independently of the session model.
- **Robust by default.** Empty/failed panelist answers are dropped before the judge, and if fewer than
  two real answers come back the judge is skipped (you get the single answer, flagged). Optional
  **`--analysis-only`** mode flips the last step: the judge only analyzes and *your* active model writes
  the final answer (the OpenRouter-Fusion shape).

## Install

Each harness has its own vanilla install path. `install.sh` just wraps them.

**OMP (recommended):**

```bash
git clone https://github.com/jms830/omp-fusion ~/github/omp-fusion
cd ~/github/omp-fusion

# vanilla OMP plugin — omp links the repo and auto-discovers skill + commands (task-agent mode)
./install.sh --plugin              # = omp plugin link "$PWD"
# published copy instead: omp plugin install git:github.com/jms830/omp-fusion

# OR full custom-agent mode (copies skill + fusion-panel/fusion-judge agents + commands):
./install.sh                       # copies into ~/.omp/agent
# ./install.sh --dir <path>        # or a custom agent dir
```

**vanilla pi** (experimental — install only; the parallel fan-out is OMP-native, see
[`docs/CROSS-COMPAT.md`](docs/CROSS-COMPAT.md)):

```bash
./install.sh --pi                  # = pi install "$PWD"  (pi loads the skill via the pi.skills manifest)
# or directly: pi install git:github.com/jms830/omp-fusion
```

Then restart the agent (or `/reload`).

## Configure the models (optional)

With no config, Fusion uses `pi/slow` + `pi/default` as the panel and `pi/slow` as the judge, and
`/fusion-solo` always works (one strong model run twice). To pick your own panel, add roles to
`~/.omp/agent/config.yml` — `scripts/detect_panel.sh` prints a suggestion tailored to your existing roles:

```yaml
modelRoles:
  fusion_judge:   anthropic/claude-opus-4-8:high
  fusion_panel_1: anthropic/claude-opus-4-8:high
  fusion_panel_2: openai-codex/gpt-5.5:high
  fusion_panel_3: google-antigravity/gemini-3.5-flash
  # Ultrafusion (6 proposers → 3 critics → aggregator). When these are unset, Ultrafusion reuses
  # fusion_panel_* (cycled to fill the slots) + fusion_judge, then built-in defaults.
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

Any OMP model string or `pi/<role>` alias works (with optional `:thinking` suffix). Unavailable providers
fall back via OMP's native provider fallback. (Note: `google-antigravity` serves `gemini-3.5-flash`, not a
Pro tier — authenticate `google-vertex` / `google-gemini-cli` if you want a Pro Gemini panelist.)

## Use

| Command | Panel |
|---|---|
| `/fusion <q>` | configured `fusion_panel_*` roles (or defaults); `--panel m1,m2,...`, `--judge m`, `--analysis-only` |
| `/fusion-solo <q>` | floor mode — `pi/slow` run **twice**, always available |
| `/fusion-pair <q>` | two-model panel (`fusion_panel_1` + `_2`) |
| `/fusion-trio <q>` | three-model panel (`fusion_panel_1..3`) |
| `/ultrafusion <task>` | 6 proposers plan in parallel → 3 critics comment (consensus/contradictions/unique opinions) → aggregator writes the final plan; `--proposers m1,...`, `--critics m1,...`, `--aggregator m` |

Or just ask in prose — the skill auto-triggers on "run it through fusion", "panel of models", "fuse the
models", "second/third opinion in parallel", etc.

```
/fusion-trio Should we use Kafka or SQS for our event bus? Constraints: 2-week ship, 10k rps, small team.
/fusion --panel pi/slow,openai-codex/gpt-5.5,google-antigravity/gemini-3.5-pro --judge pi/slow  <question>
/ultrafusion  Refactor the auth module to support per-tenant OAuth without breaking existing sessions.
```

## Use as a model (`omp-fusion` provider)

Both pipelines also register as ordinary models — `omp-fusion/fusion` and `omp-fusion/ultrafusion` — via
an OMP extension shipped inside this same plugin (`extension/`, declared in `package.json`'s
`omp.extensions`). No separate install step: if the plugin is installed, the provider is live. Use them
anywhere OMP accepts a model string:

```bash
omp -p "Should we use Kafka or SQS?" --model omp-fusion/fusion
omp --model omp-fusion/ultrafusion
```

```yaml
modelRoles:
  fusion_judge: omp-fusion/fusion   # e.g. use Fusion's judged answer as another role's model
```

`/model` and `omp models` list both. Role resolution follows the same precedence as the slash commands
(configured roles → cycled fusion-panel fallback for Ultrafusion → built-in defaults), minus the
`--panel`/`--judge`/`--proposers`/`--critics`/`--aggregator`/`--analysis-only` invocation flags, which have
no equivalent for a raw model call. A resolved role that points back at `omp-fusion/*` is always rejected
(self-recursion guard) and falls through to the next candidate.

**Known limitations of the provider path** (the slash commands are unaffected unless noted):

- **No tool use inside panelists/proposers.** Unlike `/fusion` and `/ultrafusion`, whose panelists and
  proposers have full `bash`/`web_search` access, panelists reached through `--model omp-fusion/*` reason
  prose-only. Restoring tool use inside a `streamSimple` handler needs either a from-scratch tool loop or a
  way to construct a tool-enabled session from extension code; neither is implemented yet. Use the slash
  commands when panelists need to verify claims against real code or the web.
- **Outer `systemPrompt`/`tools` are discarded by design.** When a caller routes through `--model
  omp-fusion/*`, the outer agent's system prompt and tool list are *intentionally not* forwarded to inner
  panelists. Inner panelists use their own role-specific prompts (the same `agents/*.md` the slash commands
  use). Forwarding an agentic outer system prompt into prose-only panelists would actively degrade answers
  by injecting instructions like "always use tools" into models that have no tools. Multi-turn history
  *is* preserved (see below); only the outer system prompt and tool list are dropped.
- **Floor mode may not diverge.** When only one panel/proposer role resolves, the pipeline duplicates it
  into two cold runs of the same model (documented floor mode). `SimpleStreamOptions` exposes no
  `temperature` channel, so the provider cannot force sampling variance — if the underlying model defaults
  to low temperature, the two runs may produce near-identical answers. For genuine divergence, configure
  two distinct models (e.g. `fusion_panel_1` + `fusion_panel_2`) rather than relying on floor mode.
- **Module-singleton model registry.** The provider captures one model-resolution facade per process at
  `session_start` and holds it in module-level state. This is fine for the intended single-session CLI
  deployment, but is not safe for concurrent multi-session use within one process (a pattern that has been
  observed to behave differently on Windows, where Bun's module cache-busting differs from POSIX). Don't
  embed the provider in a long-running multi-tenant host without giving each session its own process.
- **`omp bench` / `omp dry-balance` unsupported.** Those paths build a one-shot model registry and never
  fire `session_start`, so role resolution throws a clear error rather than silently resolving the wrong
  models. Normal interactive and `-p`/print-mode sessions are unaffected.
- **Multi-turn context cost.** Prior-turn user and assistant messages are forwarded to every inner
  panelist/proposer/critic/aggregator call so the panel can reason about the full conversation, not just
  the latest turn. Thinking blocks and tool results from prior turns are *not* forwarded — only text
  content. This means each inner call's token cost grows with conversation length; for very long sessions
  consider `/clear` before invoking Fusion on an unrelated topic.

## How it works

```
/fusion <task>
  → resolve panel + judge models (override → command → modelRoles → defaults; floor = same model x2)
  → fan out: parallel fusion-panel subagents, SAME verbatim prompt, blind, web + bash
  → collect every answer
  → fusion-judge subagent reads task + all answers → Track A (merge & verify) or Track B (synthesis)
  → present the judge's final answer (+ optional provenance under .fusion/runs/)
```

```
/ultrafusion <task>
  → resolve proposer (x6) + critic (x3) + aggregator models (override → ultrafusion_* roles →
    fusion_panel_*/fusion_judge cycled → defaults; floor = same model x2 for proposers)
  → wave 1: 6 ultrafusion-proposer subagents plan in parallel, SAME verbatim task, blind, read-only
  → wave 2: 3 ultrafusion-critic subagents (parallel, blind to each other) each read ALL proposals and
    return Consensus / Contradictions / Unique opinions / Recommendation
  → wave 3: 1 ultrafusion-aggregator integrates the critic comments (+ proposals as grounding) into the
    final plan, leading with the plan, Synthesis notes last
  → present the aggregator's final plan (+ optional provenance under .fusion/runs/)
```

Files:

```
skills/fusion/SKILL.md                  orchestration (panel selection, fan-out, judge)
skills/fusion/references/judge_rubric.md the judge's Track A / Track B rubric
agents/fusion-panel.md                  one independent panelist (model supplied per spawn)
agents/fusion-judge.md                  the synthesizer (separate, configurable model)
commands/fusion*.md                     slash entry points
skills/ultrafusion/SKILL.md             3-wave planning orchestration (proposers → critics → aggregator)
skills/ultrafusion/references/critic_rubric.md      the critic's four-section comment rubric
skills/ultrafusion/references/aggregator_rubric.md  the aggregator's integration + output rubric
agents/ultrafusion-{proposer,critic,aggregator}.md  the three planning subagents (models per spawn)
commands/ultrafusion.md                 /ultrafusion slash entry point
scripts/detect_panel.sh                 print a suggested modelRoles block (Fusion + Ultrafusion) from your config
extension/index.ts                      registers the omp-fusion provider (omp-fusion/fusion, omp-fusion/ultrafusion)
extension/fusion-handler.ts             streamSimple: panel -> judge, reasoning-only
extension/ultrafusion-handler.ts        streamSimple: proposers -> critics -> aggregator, reasoning-only
extension/shared/                       model-role resolution, prompt reuse, event-stream helpers
```

## Contributing upstream

This repo mirrors OMP's config-dir layout (`skills/`, `agents/`, `commands/`) so it can be proposed as a
bundled OMP skill. See [`docs/PR-TO-OH-MY-PI.md`](docs/PR-TO-OH-MY-PI.md) for the mapping and the
repo-contract checklist (e.g. prompts live in `.md` files).

## License

MIT. Method credited to duolahypercho (Fusion-Fable). See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
