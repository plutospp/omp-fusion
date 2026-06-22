# fusion-omp

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
git clone https://github.com/jms830/fusion-omp ~/github/fusion-omp
cd ~/github/fusion-omp

# vanilla OMP plugin — omp links the repo and auto-discovers skill + commands (task-agent mode)
./install.sh --plugin              # = omp plugin link "$PWD"
# published copy instead: omp plugin install git:github.com/jms830/fusion-omp

# OR full custom-agent mode (copies skill + fusion-panel/fusion-judge agents + commands):
./install.sh                       # copies into ~/.omp/agent
# ./install.sh --dir <path>        # or a custom agent dir
```

**vanilla pi** (experimental — install only; the parallel fan-out is OMP-native, see
[`docs/CROSS-COMPAT.md`](docs/CROSS-COMPAT.md)):

```bash
./install.sh --pi                  # = pi install "$PWD"  (pi loads the skill via the pi.skills manifest)
# or directly: pi install git:github.com/jms830/fusion-omp
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

Or just ask in prose — the skill auto-triggers on "run it through fusion", "panel of models", "fuse the
models", "second/third opinion in parallel", etc.

```
/fusion-trio Should we use Kafka or SQS for our event bus? Constraints: 2-week ship, 10k rps, small team.
/fusion --panel pi/slow,openai-codex/gpt-5.5,google-antigravity/gemini-3.5-pro --judge pi/slow  <question>
```

## How it works

```
/fusion <task>
  → resolve panel + judge models (override → command → modelRoles → defaults; floor = same model x2)
  → fan out: parallel fusion-panel subagents, SAME verbatim prompt, blind, web + bash
  → collect every answer
  → fusion-judge subagent reads task + all answers → Track A (merge & verify) or Track B (synthesis)
  → present the judge's final answer (+ optional provenance under .fusion/runs/)
```

Files:

```
skills/fusion/SKILL.md                  orchestration (panel selection, fan-out, judge)
skills/fusion/references/judge_rubric.md the judge's Track A / Track B rubric
agents/fusion-panel.md                  one independent panelist (model supplied per spawn)
agents/fusion-judge.md                  the synthesizer (separate, configurable model)
commands/fusion*.md                     slash entry points
scripts/detect_panel.sh                 print a suggested modelRoles block from your config
```

## Contributing upstream

This repo mirrors OMP's config-dir layout (`skills/`, `agents/`, `commands/`) so it can be proposed as a
bundled OMP skill. See [`docs/PR-TO-OH-MY-PI.md`](docs/PR-TO-OH-MY-PI.md) for the mapping and the
repo-contract checklist (e.g. prompts live in `.md` files).

## License

MIT. Method credited to duolahypercho (Fusion-Fable). See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
