# omp-fusion

**Fuse a panel of frontier models into one judged answer — natively in [OMP](https://github.com/can1357/oh-my-pi) (`omp`).**

omp-fusion ships four multi-model pipelines, each trading depth for speed:

| Pipeline | Shape | Tradeoff |
|---|---|---|
| **Fusion** | N proposers → aggregator | Full synthesis; slowest |
| **Ultrafusion** | N proposers → M critics → aggregator | Deepest planning; most tokens |
| **Fusion-fast** | N proposers → aggregator (majority quorum, abort stragglers) | Skips critics; stops at ⌊N/2⌋+1 |
| **Fusion-samp** | ⌊N/2⌋+1 sampled proposers → aggregator | Cheapest; random subset, nothing wasted |

All four dispatch the same prompt to several models *in parallel* — each answering independently,
none seeing the others' work — then a synthesizer (aggregator) reads the results and writes
a final answer grounded in structured analysis. This is real information fusion (independence →
synthesis), **not** "ask several models and average."

This is an OMP-native port of [duolahypercho/fusion-fable](https://github.com/duolahypercho/fusion-fable)
(a Claude Code skill). See [`NOTICE`](NOTICE) for what is preserved and what changed.

---

## Why this shape

- **Independence is the signal.** Proposers get the verbatim task, blind to each other, no personas/
  "lenses". Two cold runs of the *same* model is a valid wave — divergence comes from sampling.
- **The aggregator synthesizes, it doesn't vote.** It classifies the deliverable, then either merges-and-
  verifies an artifact (Track A) or writes a five-section synthesis (Track B).
- **Any provider, your choice.** Proposer and aggregator models are ordinary OMP subagents resolved through
  `modelRoles` (or a per-invocation override) — like how `/advisor`'s model is configured. No CLI
  wrappers (`run_codex`/`run_gemini`/`agy`), no hardcoded vendor or proxy.
- **The aggregator is a separate subagent with its own required model** — configure `aggregator`; there
  is no implicit default.
- **Robust by default.** Empty/failed proposer answers are dropped before the aggregator, and if fewer than
  two real answers come back the aggregator is skipped (you get the single answer, flagged). Optional
  **`--analysis-only`** mode flips the last step: the aggregator only analyzes and *your* active model writes
  the final answer (the OpenRouter-Fusion shape).

## Install

Each harness has its own vanilla install path. `install.sh` just wraps them.

**OMP (recommended):**

```bash
git clone https://github.com/jms830/omp-fusion ~/github/omp-fusion
cd ~/github/omp-fusion

# vanilla OMP plugin — omp links the repo and auto-discovers skills + commands + extension
./install.sh --plugin              # = omp plugin link "$PWD"
# published copy instead: omp plugin install git:github.com/jms830/omp-fusion

# OR copy mode (no CLI needed — copies skills, agents, commands, and the extension
# into ~/.omp/agent for custom-agent mode):
./install.sh                       # copies into ~/.omp/agent
# ./install.sh --dir <path>        # or a custom agent dir
```

Copy mode installs:
- `skills/fusion` + `skills/ultrafusion` (both orchestration skills)
- `agents/*.md` (fusion-proposer, fusion-aggregator, ultrafusion-proposer/critic/aggregator)
- `commands/*.md` (all slash entry points)
- `extension/` → `~/.omp/agent/extensions/omp-fusion/` (the `omp-fusion` provider —
  `omp-fusion/fusion`, `fusion-fast`, `fusion-samp`, `ultrafusion` as ordinary models)

**vanilla pi** (experimental — install only; the parallel fan-out is OMP-native, see
[`docs/CROSS-COMPAT.md`](docs/CROSS-COMPAT.md)):

```bash
./install.sh --pi                  # = pi install "$PWD"  (pi loads the skill via the pi.skills manifest)
# or directly: pi install git:github.com/jms830/omp-fusion
```

Then restart the agent (or `/reload`).

**Windows note:** `omp plugin link` creates a symlink, which needs Developer Mode enabled or an
elevated shell — without it, linking fails with `EPERM: operation not permitted, symlink`. Copy
mode (no flag) needs no symlink permissions and works everywhere; fall back to it if `--plugin` fails.

## Configure the models (aggregator required)

With no config, Fusion uses `pi/slow` + `pi/default` as the proposers; the aggregator has **no default**
and must be configured (or use `/fusion-solo`, which always works — one strong model run twice). To
configure your own models, add roles to
~/.omp/agent/config.yml — `scripts/detect_panel.sh` prints a suggestion tailored to your existing roles:

```yaml
modelRoles:
  aggregator:  anthropic/claude-opus-4-8:high
  # ultra_aggregator: anthropic/claude-opus-4-9:high   # optional — overrides aggregator for Ultrafusion only
  proposer_1: anthropic/claude-opus-4-8:high
  proposer_2: openai-codex/gpt-5.5:high
  proposer_3: google-antigravity/gemini-3.5-flash
  # ...add proposer_4, proposer_5, ... for a wider panel; numbered from 1, gaps ignored
  critic_1:   anthropic/claude-opus-4-8:high
  critic_2:   openai-codex/gpt-5.5:high
  # ...add critic_3, critic_4, ... for more reviewers (Ultrafusion's own extra wave, no fusion equivalent)
```

`aggregator` and `proposer_N` are shared across all four pipelines — configure them once and Fusion,
Fusion-fast, Fusion-samp, and Ultrafusion all pick them up. `critic_N` is Ultrafusion's own extra wave.
`ultra_aggregator` is Ultrafusion's own optional aggregator override — checked before the shared
`aggregator`, with no effect on Fusion/Fusion-fast/Fusion-samp. All are numbered from 1 where applicable;
add as many as your roster needs.

Any OMP model string or `pi/<role>` alias works (with optional `:thinking` suffix). Unavailable providers
fall back via OMP's native provider fallback. (Note: `google-antigravity` serves `gemini-3.5-flash`, not a
Pro tier — authenticate `google-vertex` / `google-gemini-cli` if you want a Pro Gemini panelist.)

## Use

| Command | Models |
|---|---|
| `/fusion <q>` | configured `proposer_*`/`aggregator` roles (or defaults); `--proposers m1,m2,...` (alias: `--panel`), `--aggregator m` (alias: `--judge`), `--analysis-only` |
| `/fusion-solo <q>` | floor mode — `pi/slow` run **twice**, always available |
| `/fusion-pair <q>` | two-model proposer wave (`proposer_1` + `_2`) |
| `/fusion-trio <q>` | three-model proposer wave (`proposer_1..3`) |
| `/ultrafusion <task>` | as many proposers as you configure plan in parallel, then as many critics (blind to each other) each comment on every proposal, then the aggregator integrates the comments into the final plan; `--proposers m1,...`, `--critics m1,...`, `--aggregator m` |

Or just ask in prose — the skill auto-triggers on "run it through fusion", "panel of models", "fuse the
models", "second/third opinion in parallel", etc.

```
/fusion-trio Should we use Kafka or SQS for our event bus? Constraints: 2-week ship, 10k rps, small team.
/fusion --panel pi/slow,openai-codex/gpt-5.5,google-antigravity/gemini-3.5-pro --judge pi/slow  <question>
/ultrafusion  Refactor the auth module to support per-tenant OAuth without breaking existing sessions.
```

## Use as a model (`omp-fusion` provider)

All four pipelines also register as ordinary models — `omp-fusion/fusion`, `omp-fusion/fusion-fast`,
`omp-fusion/fusion-samp`, and `omp-fusion/ultrafusion` — via an OMP extension shipped inside this
repo (`extension/`). In plugin mode it's declared in `package.json`'s `omp.extensions`; in copy mode
`install.sh` places it at `~/.omp/agent/extensions/omp-fusion/`. Either way, no separate install step.
Use them anywhere OMP accepts a model string:

```bash
omp -p "Should we use Kafka or SQS?" --model omp-fusion/fusion
omp --model omp-fusion/ultrafusion
omp -p "Plan a migration strategy" --model omp-fusion/fusion-fast
omp -p "Plan a migration strategy" --model omp-fusion/fusion-samp
```

```yaml
modelRoles:
  aggregator: omp-fusion/fusion   # e.g. use Fusion's aggregated answer as another role's model
```

`/model` and `omp models` list all four. Role resolution follows the same precedence as the slash
commands: bare `aggregator`/`proposer_*` (shared across all four pipelines; `aggregator` is required, no
fallback) then built-in defaults for proposers, plus `critic_*` for Ultrafusion's extra wave — minus the
`--proposers`/`--critics`/`--aggregator`/`--analysis-only` invocation flags, which have no equivalent
for a raw model call. A resolved role that points back at `omp-fusion/*` is always rejected
(self-recursion guard) — proposers/critics fall through to the built-in default, aggregator has no
fallback and errors out.

**Known limitations of the provider path** (the slash commands are unaffected unless noted):

- **No tool use inside proposers/critics.** Unlike `/fusion` and `/ultrafusion`, whose proposers have full
  `bash`/`web_search`/`write` access (critics get read-only tools), models reached through `--model
  omp-fusion/*` reason prose-only. Restoring tool use inside a `streamSimple` handler needs either a
  from-scratch tool loop or a way to construct a tool-enabled session from extension code; neither is
  implemented yet. Use the slash commands when panelists need to verify claims against real code or the web.
- **Outer `systemPrompt`/`tools` are discarded by design.** When a caller routes through `--model
  omp-fusion/*`, the outer agent's system prompt and tool list are *intentionally not* forwarded to inner
  proposers/critics. Inner proposers/critics use their own role-specific prompts (the same `agents/*.md` the
  slash commands use). Forwarding an agentic outer system prompt into prose-only proposers would actively
  degrade answers by injecting instructions like "always use tools" into models that have no tools.
  Multi-turn history *is* preserved (see below); only the outer system prompt and tool list are dropped.
- **Floor mode may not diverge.** When only one proposer role resolves, the pipeline duplicates it
  into two cold runs of the same model (documented floor mode). `SimpleStreamOptions` exposes no
  `temperature` channel, so the provider cannot force sampling variance — if the underlying model defaults
  to low temperature, the two runs may produce near-identical answers. For genuine divergence, configure
  two distinct models (e.g. `proposer_1` + `proposer_2`) rather than relying on floor mode.
- **Module-singleton model registry.** The provider captures one model-resolution facade per process at
  `session_start` and holds it in module-level state. This is fine for the intended single-session CLI
  deployment, but is not safe for concurrent multi-session use within one process (a pattern that has been
  observed to behave differently on Windows, where Bun's module cache-busting differs from POSIX). Don't
  embed the provider in a long-running multi-tenant host without giving each session its own process.
- **`omp bench` / `omp dry-balance` unsupported.** Those paths build a one-shot model registry and never
  fire `session_start`, so role resolution throws a clear error rather than silently resolving the wrong
  models. Normal interactive and `-p`/print-mode sessions are unaffected.
- **Multi-turn context cost.** Prior-turn user and assistant messages are forwarded to every inner
  proposer/critic/aggregator call so the wave can reason about the full conversation, not just
  the latest turn. Thinking blocks and tool results from prior turns are *not* forwarded — only text
  content. This means each inner call's token cost grows with conversation length; for very long sessions
  consider `/clear` before invoking Fusion on an unrelated topic.

## How it works

```
/fusion <task>
  → resolve proposer + aggregator models (override → command → modelRoles; aggregator required, proposers fall back to defaults; floor = same model x2)
  → fan out: parallel fusion-proposer subagents, SAME verbatim prompt, blind, web + bash
  → collect every answer
  → fusion-aggregator subagent reads task + all answers → Track A (merge & verify) or Track B (synthesis)
  → present the aggregator's final answer (+ optional provenance under .fusion/runs/)
```

```
/ultrafusion <task>
  → resolve proposer (xN) + critic (xM) + aggregator models (override → canonical proposer_*/critic_*/
    aggregator (proposer_*/aggregator shared with Fusion; aggregator required unless ultra_aggregator
    set — Ultrafusion-only, checked first); proposers/critics fall back to defaults; floor = same model x2)
  → wave 1: N ultrafusion-proposer subagents plan in parallel, SAME verbatim task, blind, read-only
  → wave 2: M ultrafusion-critic subagents (parallel, blind to each other) each read ALL proposals and
    return Consensus / Contradictions / Unique opinions / Recommendation
  → wave 3: 1 ultrafusion-aggregator integrates the critic comments (+ proposals as grounding) into the
    final plan, leading with the plan, Synthesis notes last
  → present the aggregator's final plan (+ optional provenance under .fusion/runs/)

```
omp-fusion/fusion-fast (provider-only)
  → resolve proposers + aggregator (proposer_*/aggregator, canonical & shared with Ultrafusion, via resolveRoles)
  → fan out ALL proposers; the instant ⌊N/2⌋+1 succeed, abort the stragglers
  → aggregator integrates the majority's proposals
```

```
omp-fusion/fusion-samp (provider-only)
  → resolve proposers + aggregator (proposer_*/aggregator, canonical & shared with Ultrafusion, via resolveRoles)
  → randomly sample ⌊N/2⌋+1 proposers (Fisher-Yates); run only those
  → aggregator integrates the sample's proposals
```

Files:

```
skills/fusion/SKILL.md                  orchestration (proposer selection, fan-out, aggregator)
agents/fusion-proposer.md               one independent proposer (model supplied per spawn)
agents/fusion-aggregator.md             the synthesizer (separate, configurable model)
references/aggregator_rubric.md         the aggregator's Track A / Track B rubric
commands/fusion*.md                     slash entry points
skills/ultrafusion/SKILL.md             3-wave planning orchestration (proposers → critics → aggregator)
skills/ultrafusion/references/critic_rubric.md      the critic's four-section comment rubric
skills/ultrafusion/references/aggregator_rubric.md  the ultrafusion aggregator's integration + output rubric
agents/ultrafusion-{proposer,critic,aggregator}.md  the three planning subagents (models per spawn)
commands/ultrafusion.md                 /ultrafusion slash entry point
scripts/detect_panel.sh                 print a suggested modelRoles block (Fusion + Ultrafusion) from your config
extension/index.ts                      registers the omp-fusion provider (fusion, fusion-fast, fusion-samp, ultrafusion)
extension/fusion-handler.ts             streamSimple: proposers -> aggregator, reasoning-only
extension/ultrafusion-handler.ts        streamSimple: proposers -> critics -> aggregator, reasoning-only
extension/fusion-fast-handler.ts        streamSimple: proposers -> aggregator (majority quorum)
extension/fusion-samp-handler.ts        streamSimple: sampled proposers -> aggregator (random majority subset)
extension/shared/                       model-role resolution, prompt reuse, event-stream helpers
```

## Contributing upstream

This repo mirrors OMP's config-dir layout (`skills/`, `agents/`, `commands/`) so it can be proposed as a
bundled OMP skill. See [`docs/PR-TO-OH-MY-PI.md`](docs/PR-TO-OH-MY-PI.md) for the mapping and the
repo-contract checklist (e.g. prompts live in `.md` files).

## License

MIT. Method credited to duolahypercho (Fusion-Fable). See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
