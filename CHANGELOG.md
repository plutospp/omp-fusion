# Changelog

All notable changes to omp-fusion. Format loosely follows Keep a Changelog.

## [Unreleased] — Added `ultra_aggregator`: Ultrafusion's own dedicated aggregator key

### Added
- **`ultra_aggregator` — a new, OPTIONAL `modelRoles` key that's Ultrafusion's own dedicated
  aggregator override**, same pattern as `critic_N` (Ultrafusion's own extra wave, no fusion
  equivalent). Checked BEFORE the shared `aggregator` role; unset it and Ultrafusion falls
  through to `aggregator` exactly as before, so existing configs are unaffected. Lets
  Ultrafusion run a different (e.g. stronger) synthesizer for planning specifically, without
  changing Fusion/Fusion-fast/Fusion-samp's aggregator. `resolveRoles()` (fusion family) never
  reads `ultra_aggregator` — it's ultrafusion-only, resolved via
  `resolveRole(ULTRAFUSION_AGGREGATOR) ?? resolveRole(CANONICAL_AGGREGATOR)` in
  `extension/shared/models.ts`; the self-recursion guard applies to both tiers for free (the
  `??` chain falls through if `ultra_aggregator` resolves back to omp-fusion itself).
- `extension/ultrafusion-handler.ts`'s aggregator progress line now names which role/model
  won (`Ultrafusion: aggregator integrating (@ultra_aggregator (provider/id))...` or
  `(@aggregator (provider/id))...`) — needed to verify this feature live; previously the
  aggregator's identity wasn't logged at all.
- Docs synced: `skills/ultrafusion/SKILL.md` §1, `commands/ultrafusion.md`, `README.md`
  (configure-models section + recommended block + How-it-works diagram), `NOTICE`.
- **Verified live**: `omp -p --model omp-fusion/ultrafusion` with `ultra_aggregator` and
  `aggregator` both configured shows `aggregator integrating (@ultra_aggregator (...))` in
  the session log — `ultra_aggregator` correctly took precedence over the shared `aggregator`.

## [Unreleased] — Fixed: `omp-fusion/*` provider models unloadable in copy-mode installs

### Fixed
- **`extension/shared/prompts.ts` couldn't find `agents/*.md` after `install.sh` copy-mode
  install** — discovered by an end-to-end smoke test (`omp -p --model omp-fusion/ultrafusion`),
  which is exactly what this bug was blocking. Root cause: the file used static Bun
  `import ... with { type: "text" }` specifiers (`../../agents/fusion-aggregator.md`, etc.),
  which only resolve at the dev / `omp plugin link` nesting depth (`extension/` sits directly
  at the repo root, a sibling of `agents/`). Copy-mode installs the extension one level deeper,
  at `<agent-dir>/extensions/omp-fusion/`, while `agents/` stays a direct child of `<agent-dir>`
  — the same relative path can't reach it from both depths, so the extension threw
  `Cannot find module '../../agents/fusion-aggregator.md'` on load and every `omp-fusion/*`
  model (`fusion`, `fusion-fast`, `fusion-samp`, `ultrafusion`) was unusable after a normal
  copy install. Fixed by replacing the static imports with a runtime probe (`node:fs`
  `existsSync`/`readFileSync` against both candidate depths, picking whichever exists) that
  throws a clear, path-naming error if neither resolves — no file duplication, no `install.sh`
  changes, single source of truth preserved.
- Verified live: `omp -p --model omp-fusion/ultrafusion "<task>"` now runs the full
  proposers → critics → aggregator pipeline against the real user config end-to-end.

## [Unreleased] — Aggregator requires explicit config; all LEGACY fallback keys removed

### Changed
- **Reverted the previous entry's aggregator default-to-session-model behavior.**
  `aggregator` is once again **required** in `modelRoles` — no fallback of any kind
  (not the session's current model, not `@slow`, not `@default`). Unset it and
  Fusion/Ultrafusion throw a clear error naming the missing config. Rationale:
  "it's still better to configure aggregator in model roles settings" — an
  implicit guess is exactly the one role a silent default could quietly get wrong.
- **Removed ALL LEGACY per-pipeline fallback keys** — `fusion_aggregator`,
  `ultrafusion_aggregator`, `fusion_judge`, `fusion_panel_1..3`, `fusion_proposer_1..6`,
  `ultrafusion_proposer_1..6`, `ultrafusion_critic_1..3` no longer resolve at all.
  Only the canonical `aggregator` / `proposer_N` / `critic_N` keys are read. These
  tiers existed purely for compatibility with configs from before the flat-namespace
  unification; since the project has no release yet, no real config depends on them.
  `extension/shared/models.ts` drops `LEGACY_AGGREGATOR`, `LEGACY_FUSION_PANEL`,
  `LEGACY_FUSION_PROPOSERS`, `LEGACY_ULTRAFUSION_PROPOSERS`, `LEGACY_ULTRAFUSION_CRITICS`,
  `LEGACY_TIERS`, the `LegacyTier` interface, `SLOTS_6`, `resolveFirst`, and
  `resolveSessionModel` (dead code after the revert above).
- **Proposer/critic built-in-default floor is unchanged** — `proposer_N`/`critic_N`
  still fall back to the `@slow` + `@default` cross-family pair (cycled per shape)
  when nothing is configured; this is the zero-config floor that backs
  `/fusion-solo` and friends, not a compatibility shim, so it stays.
- `scripts/detect_panel.sh` emits an uncommented `aggregator:` line again (it is
  required config, not an optional suggestion).
- Docs synced across both `SKILL.md` files, all four commands, `README.md`,
  `NOTICE`, `package.json`, and `docs/PR-TO-OH-MY-PI.md` — every "LEGACY fallback"
  step and "defaults to the session's current model" claim removed; aggregator is
  now described as required everywhere it's mentioned.
- `extension/shared/models.test.ts` rewritten: legacy-tier tests deleted outright
  (not adapted), new coverage added for "aggregator unconfigured throws" and
  "aggregator resolving to omp-fusion itself is treated as unconfigured".

## [Unreleased] — Aggregator defaults to the session's current model

### Changed
- **Aggregator terminal fallback changed from `@slow` to the session's current
  model (`current()`), guarded against omp-fusion self-recursion, then `@default`.**
  When no `aggregator` role (or legacy `fusion_aggregator`/`ultrafusion_aggregator`/
  `fusion_judge`) is configured, the aggregator now runs on whatever model the
  session is already using — "don't set the role model of aggregator, just let it
  be the currently used model." Set `aggregator` explicitly to override.
- `scripts/detect_panel.sh` no longer emits an explicit `aggregator:` line in its
  suggested config — the aggregator is left unset so it defaults to the session
  model. (A commented-out `aggregator:` line is included for users who want to pin it.)
- Recommended `modelRoles` example in `skills/fusion/SKILL.md` no longer leads with
  an `aggregator:` line.
- Fusion SKILL's "separate model" invariant softened: the aggregator is always a
  separate *subagent/context*, but only a separate *model* when `aggregator` is set.

## [Unreleased] — Set-and-forget canonical ceiling (32/16); decouple fallback cycling; open-ended docs

### Changed
- **Canonical `proposer_*` widened to 32 slots; canonical `critic_*` widened to
  16 slots** — a large, deliberately generous ceiling meant to be set once and
  not need bumping again as real rosters grow (checking an unconfigured role
  is a free local lookup, no network call).
- **Fallback cycling DECOUPLED from the canonical range.** When nothing/little
  is configured and the resolver falls back to duplicating a small set (2
  built-in defaults, or up to 3 `fusion_panel_*` entries) to fill slots, it now
  always cycles to a fixed `FALLBACK_CYCLE_PROPOSERS`/`FALLBACK_CYCLE_CRITICS`
  (6/3, the original historical width) regardless of how wide the canonical
  range grows. Duplicating the same 2 models past ~6 times bought zero
  additional signal (Fusion's value is independent divergence, not repeat
  sampling) while still paying real API cost per call — the previous coupling
  (cycling to the full canonical width) made this worse with every widening.
- **Docs describe the pattern, not the exact ceiling.** Two prior rounds of
  "increase if needed" each required hand-syncing the exact number across
  `skills/fusion/SKILL.md`, `skills/ultrafusion/SKILL.md`, `commands/
  ultrafusion.md`, `README.md`'s Use table, and `detect_panel.sh` — and twice
  a `SWAP` on a YAML example block accidentally dropped the `modelRoles:`
  header line during that sync. Docs now say "as many `proposer_N`/`critic_N`
  as you configure, numbered from 1" instead of a literal count; the
  "recommended" YAML examples show a small illustrative pattern (3 proposers,
  2 critics) instead of exhaustively listing every slot. Raising the ceiling
  in `extension/shared/models.ts` no longer requires touching any doc.
- `scripts/detect_panel.sh`'s critic suggestion no longer hardcodes a loop
  bound — it mirrors however many distinct models `PANEL` found (same as the
  proposer suggestion), with a comment that more `proposer_N`/`critic_N` lines
  can be added by hand.

### Fixed
- Caught and fixed two more `SWAP`-dropped-a-line mistakes while editing
  `skills/ultrafusion/SKILL.md`: a duplicated "resolved per section 1" comment
  next to the eval example, and a frontmatter `description` sentence broken
  mid-clause ("...`critic_N` — `aggregator` defaults. Use when...") where a
  `SWAP` boundary didn't include the rest of the sentence. Re-read the full
  file end to end afterward to confirm no other instances.

## [Unreleased] — Widen canonical pool to proposer_1..9 / critic_1..6

### Changed
- **Canonical `proposer_*` widened from 6 to 9 slots; canonical `critic_*` widened
  from 3 to 6 slots.** A 6-model proposer roster (and a 3-model critic roster) was
  too narrow for a real multi-provider setup. `aggregator` is unaffected (always 1).
- LEGACY key ranges (`fusion_proposer_1..6`, `ultrafusion_proposer_1..6`,
  `ultrafusion_critic_1..3`, `fusion_panel_1..3`) keep their original historical
  width — only the canonical bare-name tier widened. Existing configs on the old
  LEGACY keys are unaffected.
- All "fill to N" cycling targets that mirror the canonical proposer/critic pool
  width (built-in-default cycling for fusion-fast/fusion-samp/ultrafusion,
  `fusion_panel_*` cycling for ultrafusion) now cycle to 9/6 instead of 6/3.
- `skills/fusion/SKILL.md` §1 (unaffected — always used "however many are set", no
  fixed-count claim) is unchanged; `skills/ultrafusion/SKILL.md` §1, its recommended
  `modelRoles` example, and its `eval` proposer/critic arrays now show 9/6.
  `commands/ultrafusion.md`, `README.md`'s Use table, and `scripts/detect_panel.sh`'s
  critic-suggestion loop updated to match.

### Config
- Populated `~/.omp/agent/config.yml` `modelRoles` with `aggregator` + all 9
  `proposer_*` + all 6 `critic_*`, resolved against the live `omp models` catalog
  (not just the cached `models.db` snapshot, which was stale for at least one
  entry — see Fixed). Existing roles (`default`, `advisor`, `task`, `plan`, `smol`,
  `vision`, `commit`, `slow`, `designer`, `consultant`, `tiny`) untouched.

### Fixed
- Caught mid-edit: two `SKILL.md` `modelRoles` YAML examples lost their top-level
  `modelRoles:` key during a `SWAP` that replaced the header line without retyping
  it, leaving orphaned-indent YAML. Both re-verified and repaired.
- The cached `models.db` catalog listed `gemini-3.1-pro` under `google-antigravity`;
  live `omp models find` shows it is NOT actually served there (only `cursor` and
  `google` carry it) — config uses the live-verified `cursor/gemini-3.1-pro`.
- Live `omp models` also surfaced a `commandcode` gateway provider absent from the
  cached catalog entirely; it carries `deepseek-v4-pro` and `mimo-v2.5-pro` exactly
  as requested, correcting an initial substitution guess.

### Known guess (unresolved, flagged to the user)
- `proposer_1` (`grok-4.5` via `cursor`): no bare `grok-4.5` exists under `cursor` —
  only 6 quality/speed variants (`cursor-grok-4.5-{high,high-fast,low,low-fast,
  medium,medium-fast}`). Set to `cursor/cursor-grok-4.5-medium` as a balanced
  default; unconfirmed against user intent.

## [Unreleased] — Unify role namespace: aggregator / proposer_* / critic_*

### Changed
- **One flat, canonical role namespace across all four pipelines.** `aggregator` and
  `proposer_1..6` are shared by Fusion, Fusion-fast, Fusion-samp, and Ultrafusion —
  configure them once and every pipeline picks them up. `critic_1..3` is Ultrafusion's
  own extra wave (no fusion shape has one).
- **Former per-pipeline keys demoted to LEGACY fallback**, checked only when the bare
  canonical name is unset: `fusion_proposer_1..6` / `fusion_aggregator` (fusion's
  former canonical), `fusion_panel_1..3` / `fusion_judge` (older historical names),
  `ultrafusion_proposer_1..6` / `ultrafusion_critic_1..3` / `ultrafusion_aggregator`
  (ultrafusion's former canonical). All existing configs keep resolving to the same
  models without edits.
- `extension/shared/models.ts`: `resolveRoles(shape)` and `resolveUltrafusionRoles()`
  both check the bare canonical tier first, then their respective legacy chains, then
  built-in defaults — algorithm (floor mode, cycling, fallback order) is otherwise
  unchanged from the prior revert. `fusion-handler.ts` / `fusion-fast-handler.ts` /
  `fusion-samp-handler.ts` are untouched (they still just call `resolveRoles(shape)`).

### Why
Two separate prefixed namespaces (`fusion_*` for Fusion/fast/samp, `ultrafusion_*` for
Ultrafusion) forced duplicate config for users who wanted the same model roster across
all four pipelines. One shared `aggregator`/`proposer_*` pool removes that duplication;
per-pipeline divergence is still possible via the legacy prefixed keys.

### Fixed
- `skills/fusion/SKILL.md` / `skills/ultrafusion/SKILL.md` §1 precedence, recommended
  `modelRoles` blocks, and `eval` `pi/<role>` examples updated to the canonical names.
- `commands/fusion.md` / `fusion-pair.md` / `fusion-trio.md` / `ultrafusion.md` role
  mentions updated.
- `scripts/detect_panel.sh` now suggests one `aggregator` + `proposer_1..N` block
  (previously duplicated as separate `fusion_*`/`ultrafusion_*` suggestions).
- `README.md` (configure, use table, use-as-model, all four how-it-works diagrams) and
  `NOTICE` updated to the canonical names.

## [Unreleased] — Revert: ultrafusion back to proposers → critics → aggregator

### Changed
- **Ultrafusion reverted to its original three-wave shape**: `proposers -> critics -> aggregator`
  (was `explorers -> proposers -> aggregator` from the "unify role schema" refactor below). The
  explorer wave and the "critic duty merged into proposer" idea are undone; critics are once again
  a distinct wave with their own agent, rubric, and role keys.
- **Ultrafusion's role namespace is dedicated again**: `ultrafusion_proposer_1..6`,
  `ultrafusion_critic_1..3`, `ultrafusion_aggregator` are primary keys for ultrafusion, not a
  deprecated LEGACY fallback tier. `extension/shared/models.ts` gains a standalone
  `resolveUltrafusionRoles()` (restored, not routed through the shared `resolveRoles(shape)` used
  by fusion/fusion-fast/fusion-samp).
- **Fusion, fusion-fast, and fusion-samp are unchanged** — still `proposers -> aggregator` on the
  canonical `fusion_proposer_1..6` / `fusion_aggregator` namespace from the schema-unification work;
  their handlers, role resolution, and behavior are untouched by this revert.

### Restored
- `agents/ultrafusion-{proposer,critic,aggregator}.md` (dedicated ultrafusion agents; distinct from
  `agents/fusion-{proposer,aggregator}.md`, which fusion keeps using).
- `skills/ultrafusion/references/critic_rubric.md` and `skills/ultrafusion/references/aggregator_rubric.md`
  (ultrafusion-specific rubrics, split back out of the consolidated `references/aggregator_rubric.md`).
- `extension/ultrafusion-handler.ts`'s three-wave implementation (proposer wave, then critic wave with
  each critic reading all proposals, then aggregator with critic comments as primary input and
  proposals as grounding).

### Removed
- `agents/fusion-explorer.md` and the `FUSION_EXPLORER_PROMPT` export — no pipeline uses an explorer
  wave anymore.
- Track C ("Plan: ordered synthesis") trimmed out of `references/aggregator_rubric.md` — that file is
  fusion-only again (Track A/B); ultrafusion has its own dedicated aggregator rubric.

### Fixed
- `extension/index.ts`'s `omp-fusion/ultrafusion` model registration still said
  `"Ultrafusion (explorers -> proposers -> aggregator)"` — corrected to
  `"Ultrafusion (proposers -> critics -> aggregator)"`.
- `extension/shared/models.test.ts` rewritten for the reverted shape: dropped the explorer/6-slot-
  critics-widening assertions, added coverage for `resolveUltrafusionRoles()` (canonical keys,
  fusion-panel fallback, floor mode, aggregator fallback chain, self-recursion guard, error cases).
- `README.md`'s "How it works" ultrafusion diagram and "Files" list, which had drifted out of sync
  with the "unify role schema" commit below (they still described the pre-refactor shape even after
  that commit landed) — now correct for the current (reverted) state. Also corrected the intro
  table's Fusion row, which had never been updated off `panel -> judge` wording even when Fusion's
  own terminology changed.

## [Unreleased] — Unified role schema

### Changed
- **Unified role namespace.** All pipelines now resolve from one set of canonical
  `modelRoles` keys: `fusion_aggregator`, `fusion_explorer_1..6`, `fusion_proposer_1..6`.
  The deprecated `fusion_panel_*`, `fusion_judge`, `ultrafusion_proposer_*`,
  `ultrafusion_critic_*`, and `ultrafusion_aggregator` keys remain as per-pipeline
  LEGACY fallbacks so existing configs keep working without edits.
- **Pipeline shapes.** `fusion`: proposers then aggregator (was panel then judge).
  `ultrafusion`: explorers then proposers then aggregator (was proposers then critics
  then aggregator). `fusion-fast` and `fusion-samp`: proposers then aggregator
  (unchanged shape, new role names).
- **Critic duty merged.** The comparative pass (consensus / contradictions / unique
  opinions) that critics performed is now split: proposers assess upstream explorer
  findings before committing to a candidate; the aggregator adjudicates across
  proposals. The `ultrafusion_critic_*` roles map to the proposer wave.
- **Tool grants.** Explorers and proposers gain the `write` tool for scratch and
  verification work, contained to `.fusion/scratch/<UTC-timestamp>/<wave>-<slot>/`.
  Modification of pre-existing files remains forbidden by prompt contract (bash
  included). The aggregator retains full edit+write authority and is the sole
  writer of project paths.
- **Intentional widening.** Ultrafusion proposers' `fusion_panel_*` and built-in
  fallbacks now fill 6 slots (was 3 for the critics wave). This reflects the
  wave-identity change (critics to proposers); call counts for that specific config
  increase from 3 to 6 proposers.
- **Fusion default-config call count** (clarification, not a change). With no roles
  configured, `fusion` runs 2 built-in proposers (`@slow` + `@default` as-is); the
  six-slot shapes (`fusion-fast`, `fusion-samp`, `ultrafusion`) cycle built-ins to 6.
  This matches the pre-refactor behavior for `fusion` and is unchanged.

### Deprecated
- `fusion_panel_1..3`, `fusion_judge`, `ultrafusion_proposer_1..6`,
  `ultrafusion_critic_1..3`, `ultrafusion_aggregator` — LEGACY fallback tier.
  Removal condition: one minor release after all documented configs migrate to
  canonical keys.

### Removed
- `agents/fusion-panel.md`, `agents/fusion-judge.md`,
  `agents/ultrafusion-proposer.md`, `agents/ultrafusion-critic.md`,
  `agents/ultrafusion-aggregator.md` — replaced by
  `agents/fusion-explorer.md`, `agents/fusion-proposer.md`,
  `agents/fusion-aggregator.md`.
- `skills/fusion/references/judge_rubric.md`,
  `skills/ultrafusion/references/critic_rubric.md`,
  `skills/ultrafusion/references/aggregator_rubric.md` — consolidated into
  `references/aggregator_rubric.md`.

### Fixed
- **`commands/fusion.md` YAML parse error** (Known issue, prior release). The description
  no longer contains the bare `*` (`fusion_panel_*`) or `→` arrow suspected of breaking
  plugin-mode frontmatter discovery; `/fusion` is usable again.

## [Unreleased]

### Added
- **`omp-fusion/fusion-fast`** — Ultrafusion without the critics wave, with majority-quorum early
  termination. Fans out to all configured proposers in parallel; the instant `floor(N/2)+1` succeed,
  aborts the stragglers and ships those proposals straight to the aggregator. Reuses the same
  `ultrafusion_proposer_*` / `ultrafusion_aggregator` roles. The aggregator's built-in degraded mode
  (no critic comments) does the comparative analysis itself.
- `raceToMajority` helper in `extension/shared/stream.ts` — generic majority-quorum race with
  per-task child `AbortController`, failure-aware unreachable-quorum detection, and parent-abort
  propagation.
- **`omp-fusion/fusion-samp`** — randomly samples a majority subset of proposers upfront
  (`floor(N/2)+1`), runs only those, and aggregates. Cheaper than fusion-fast (fewer API calls,
  no wasted straggler tokens). Same roles, same aggregator degraded mode.

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
- **`omp-fusion` provider**: both pipelines now also register as ordinary models —
  `omp-fusion/fusion` and `omp-fusion/ultrafusion` — via an OMP extension (`extension/`, declared in
  `package.json`'s `omp.extensions`), selectable anywhere OMP accepts a model string (`--model`,
  `/model`, `modelRoles`, a subagent `model:` field). No separate install step — the extension ships
  inside the existing plugin. Role resolution mirrors the slash commands' precedence (configured roles
  → cycled fusion-panel fallback for Ultrafusion → built-in defaults), minus the invocation-flag tier,
  which has no equivalent for a raw model call. Panelist/proposer failures, degradation notes, and
  context-window truncation all follow the same robustness rules as the skill path. A resolved role
  that would point back at `omp-fusion/*` is rejected (self-recursion guard). **Known limitation**:
  panelists and proposers reason without tools through this path (no `bash`/`web_search`) — restoring
  tool use needs either a from-scratch tool loop or a way to construct a tool-enabled session from
  extension code, neither implemented yet; use `/fusion`/`/ultrafusion` when panelists need to verify
  claims against real code or the web. Also unsupported: `omp bench` / `omp dry-balance`, which bypass
  the `session_start` event this provider's role resolution depends on.

### Changed
- `docs/PR-TO-OH-MY-PI.md` rewritten to the **verified OMP reality** — removed the Claude-Code
  marketplace-plugin framing (that provider is `claude-plugins`, disabled here); documented the real
  paths (userland install, OMP plugin, agents-only core PR) and the `agents/`-not-discovered constraint.

### Fixed
- `skills/fusion/SKILL.md`'s `eval` examples passed `agentType:` to `agent()`, a stale option key; the
  current OMP eval prelude takes `agent:`. Left uncorrected, panel/judge spawns silently mis-resolve.
  Corrected all four call sites (panel fan-out, judge call, and both plugin-mode `task`-agent spawns).

### Known issues
- `commands/fusion.md`'s YAML frontmatter fails to parse when discovered through an installed plugin
  (`YAML Parse error: Unexpected token`); `/fusion` is unusable while this stands, though the
  `omp-fusion/fusion` and `omp-fusion/ultrafusion` provider models are unaffected (they don't read
  command frontmatter). `fusion-solo.md`/`fusion-pair.md`/`fusion-trio.md`/`ultrafusion.md` all parse
  fine, narrowing the cause to something specific to `fusion.md`'s description (candidates: the bare
  `→` arrow, the `fusion_panel_*` asterisk, or the `--panel m1,m2,...` comma/ellipsis — not the
  `<your question>` angle brackets, which `fusion-solo.md` also has without issue). Discovered while
  verifying the `omp-fusion` provider; not fixed here — out of scope for that change.

## [Unreleased — review pass]

### Added
- Permanent **typecheck tooling**: `tsconfig.json` + `text-imports.d.ts` + `bun run typecheck`
  (typescript + bun-types devDeps). The extension TypeScript had never been compiled before; this
  closes that blind spot and is run as part of every future change.

### Fixed (Critical)
- **`Model.contextWindow: null` no longer destroys panelist/proposer/critic/aggregator answers.**
  780 of 3863 bundled catalog models report `contextWindow: null`; on any one set as
  `fusion_judge`/`ultrafusion_aggregator`, the truncation math produced `NaN` and `slice(0, NaN)` →
  `""`, so the judge/aggregator received correctly-formatted headers wrapping nothing. Added
  `DEFAULT_CONTEXT_WINDOW_ESTIMATE = 128_000` and a `Number.isFinite` guard in `truncateForContext`.
- **Judge/aggregator labels now reflect the actually-resolved model**, not a hardcoded role name.
  `ResolvedSlot.label` carries `@<role> (<provider>/<id>)` from the real resolution path; a run that
  silently fell back to `@slow` now reports that in progress lines and the judge/critic input headers.
- **Per-slot failures are now visible.** The bare `catch { return undefined; }` in panel/proposer/critic
  fan-out swallowed infrastructure errors (auth/network) as silently empty answers. Each catch now emits
  a `handlerStream.progress` line with the slot label and the error message before returning undefined.
  The drop-on-failure contract is unchanged — only the visibility is new.
- **Multi-turn context is now forwarded to inner calls.** `extractTask` returns
  `{ task, priorMessages }`; both handlers prepend `priorMessages` to every inner
  panelist/proposer/critic/aggregator call so the panel can reason about the full conversation, not
  just the latest turn. Thinking blocks and tool results from prior turns are filtered — only text
  content is forwarded.
- **`options.signal` is now forwarded** to every inner `completeSimple` call. Cancelling a Fusion /
  Ultrafusion run no longer leaves every in-flight inner call (2–10 of them) running to completion
  invisibly after the user gave up.

### Fixed (Medium)
- Role-resolution throws now land inside the async IIFE in both handlers, so all 5 throw paths produce
  a clean `error` event through the stream contract instead of escaping to callers that bypass it.
- `Usage.cost.total` is now summed correctly in `sumUsage` (it was never set, so displayed/recorded
  cost was always `$0` regardless of real inner-model spend).
- Self-recursion guard literal `"omp-fusion"` is now a single exported `OMP_FUSION_PROVIDER` constant
  shared between `models.ts` and `index.ts` — a rename in either file can no longer silently disable
  the guard.
- Attribution label now includes the resolved model identity (`@<role> (<provider>/<id>)`), giving the
  judge/critic the cross-model-family signal the rubrics rank highest.
- `criticInput` is no longer built (full truncation pass over every proposal) when `critics.length === 0`.
- `fail()` now writes the `reason` parameter through to `partial.stopReason` instead of hardcoding
  `"error"`, making the new abort forwarding observable.

### Documentation
- README "Known limitations of the provider path" expanded with four entries: outer `systemPrompt`/
  `tools` discarded by design (with reasoning), floor-mode divergence caveat (no `temperature` channel
  in `SimpleStreamOptions`), module-singleton model-registry caveat for Windows / multi-tenant hosts,
  and multi-turn context-cost note for long sessions.

## [0.1.0]

### Added
- Initial OMP-native port of `duolahypercho/fusion-fable`: `fusion` skill + `fusion-panel`/`fusion-judge`
  agents + `/fusion[-solo|-pair|-trio]` commands + `judge_rubric.md` + `detect_panel.sh` + `install.sh`.
  Blind parallel panel → judge synthesis (Track A merge/verify, Track B structured synthesis); panel/judge
  models configurable via `modelRoles` or per-invocation override.
