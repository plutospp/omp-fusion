# Changelog

All notable changes to omp-fusion. Format loosely follows Keep a Changelog.

## [Unreleased]

### Added
- OMP **plugin mode**: `package.json` with dual `omp` + `pi` manifest so Fusion installs as an OMP
  plugin (`omp plugin link`/`install`) — `skills/` + `commands/` auto-discovered. In plugin mode the
  skill uses the bundled `task` agent (OMP does not discover `agents/` from a plugin), so no custom-agent
  install is required.
- `install.sh --plugin` mode (`omp plugin link`) alongside the default copy install.
- `docs/CROSS-COMPAT.md`: verified OMP-vs-vanilla-pi capability matrix (parallel eval fan-out is
  OMP-native; pi install works but fan-out is experimental).
- SKILL.md gains a "Plugin mode — no custom agents" recipe (task-agent fan-out with inlined panel/judge
  prompts).
- **Robustness** (from a review of `synthetic-recon/pi-fusion`): empty/whitespace-only or budget-capped
  panelist answers are treated as failures and excluded from the judge; if fewer than two panelists
  succeed the judge is skipped and the single answer is returned with a degradation note; panel answers
  are truncated to fit the judge's context window; Track A panelists default to read-only / isolated
  scratch dirs to avoid parallel-write collisions.
- Optional **`--analysis-only`** judge mode: the judge emits only the structured analysis JSON and the
  active/session model writes the final answer (OpenRouter-Fusion shape); default stays judge-writes-final.
- `docs/CROSS-COMPAT.md` now cites **`synthetic-recon/pi-fusion`** (npm, MIT) as the proven pi-native
  reference extension (panel→judge via pi's `ModelRegistry` + a concurrency limiter); pi users can
  `pi install npm:pi-fusion` while `omp-fusion` stays the OMP-native skill.
- **Ultrafusion**: a companion three-wave planning pipeline — 6 proposers plan the verbatim task
  independently in parallel, 3 critics (blind to each other) each read every proposal and return a
  structured comment (Consensus / Contradictions / Unique opinions / Recommendation), then 1 aggregator
  integrates the comments into one final plan. Ships `skills/ultrafusion/SKILL.md` + `critic_rubric.md` +
  `aggregator_rubric.md`, `agents/ultrafusion-{proposer,critic,aggregator}.md`, and `/ultrafusion`.
  Models resolve via `ultrafusion_proposer_1..6`/`ultrafusion_critic_1..3`/`ultrafusion_aggregator`
  `modelRoles`, falling back to the existing `fusion_panel_*`/`fusion_judge` roles cycled to fill the
  slots, then to built-in defaults. Same robustness posture as Fusion: empty proposals/comments are
  dropped before the next wave, fewer than two surviving proposals skips straight to returning the
  single plan, and the aggregator runs a degraded self-analysis mode if every critic fails.
- `scripts/detect_panel.sh` now also prints the suggested `ultrafusion_*` roles, cycling the detected
  cross-family panel into the 6 proposer + 3 critic slots.

### Changed
- `docs/PR-TO-OH-MY-PI.md` rewritten to the **verified OMP reality** — removed the Claude-Code
  marketplace-plugin framing (that provider is `claude-plugins`, disabled here); documented the real
  paths (userland install, OMP plugin, agents-only core PR) and the `agents/`-not-discovered constraint.

### Fixed
- `skills/fusion/SKILL.md`'s `eval` examples passed `agentType:` to `agent()`, a stale option key; the
  current OMP eval prelude takes `agent:`. Left uncorrected, panel/judge spawns silently mis-resolve.
  Corrected all four call sites (panel fan-out, judge call, and both plugin-mode `task`-agent spawns).

## [0.1.0]

### Added
- Initial OMP-native port of `duolahypercho/fusion-fable`: `fusion` skill + `fusion-panel`/`fusion-judge`
  agents + `/fusion[-solo|-pair|-trio]` commands + `judge_rubric.md` + `detect_panel.sh` + `install.sh`.
  Blind parallel panel → judge synthesis (Track A merge/verify, Track B structured synthesis); panel/judge
  models configurable via `modelRoles` or per-invocation override.
