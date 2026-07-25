# Changelog

All notable changes to omp-fusion. Format loosely follows Keep a Changelog.

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
