# Getting Fusion into / distributed for OMP

This repo mirrors OMP's config-dir layout (`skills/`, `agents/`, `commands/`). This doc records the
**verified** ways to ship it on OMP (`@oh-my-pi/pi-coding-agent`, the `omp` binary) — and corrects an
earlier draft that described a *Claude Code* marketplace plugin (wrong harness).

> **Verified against OMP source** (`@oh-my-pi/pi-coding-agent` v16.x `src/`), not inferred. Where the
> fusion panel cited `AGENTS.md:34`-style line numbers, those were unverifiable (the npm package ships
> **no** `AGENTS.md`); the *rules* below are real — they come from the PR #2610 review comments.

## What OMP actually does (the facts that decide the vehicle)

| Fact | Source | Consequence |
|---|---|---|
| OMP-native plugin = an npm package whose `package.json` has an **`omp`** (or `pi`) manifest field | `extensibility/plugins/loader.ts` (`manifest = pluginPkg.omp \|\| pluginPkg.pi`) | A plugin is marked by the manifest field; entry-point JS is **optional**. |
| Installed/enabled plugins become "extension roots"; their `skills/ commands/ prompts/ rules/ tools/ hooks/ .mcp.json` are **auto-discovered** | `discovery/omp-extension-roots.ts` (roots = settings `extensions:` + plugins under `<plugins>/node_modules/`) + `discovery/omp-plugins.ts` | A content-only plugin (no JS) works — skills+commands load by convention. |
| `agents/` is **NOT** in that auto-discovered set | `discovery/omp-plugins.ts` (walks skills/commands/prompts/rules/tools/hooks only) | **A plugin cannot ship the `fusion-panel`/`fusion-judge` task-subagents.** |
| Task-subagents are discovered only from `~/.omp/agent/agents`, `.omp/agents`, Claude-plugin agents (**gated on `claude-plugins`, disabled here**), or **bundled** `src/prompts/agents/*.md` | `task/discovery.ts` (precedence: project .omp, user .omp, Claude-plugin, bundled) | Custom agents must be copied into a config dir, or bundled into OMP core. |
| No bundled **`.md`** skills/commands ship in OMP, but slash commands have a core **builtin registry** (`/advisor`, `/plan`, `/loop`, `/goal`, `/fast`…) | `slash-commands/builtin-registry.ts` (`BUILTIN_SLASH_COMMAND_REGISTRY`); `src/commands/` = CLI subcommands (`omp commit`, etc.), not slash defs | A first-party `/fusion` is possible — but as a **compiled core command**, not a dropped `.md`. The skill body still has no bundled-`.md` home. |
| **OMP core already ships multi-model orchestration**: the **advisor** — a second model that watches the primary transcript, explores read-only, and injects structured advice (nit/concern/blocker) | `src/advisor/` (`AdvisorRuntime`, `advise-tool`) + `src/prompts/advisor/system.md`; gated by `advisor.enabled` + `/advisor on/off/status` + `modelRoles.advisor` | Precedent: configurable multi-model features ARE first-party. Fusion (panel→judge) is the advisor's sibling. #2609's "no" was scope-specific, not a blanket rejection. |
| `claude-plugins.ts` = *"Claude Code Marketplace Plugin Provider"* reading `~/.claude/plugins/cache/`, priority 70 | `discovery/claude-plugins.ts` | The `.claude-plugin/plugin.json` "marketplace plugin" is the **Claude** path — **not** OMP, and disabled in this config. Do not target it. |

## The three real paths

### 1. Userland install (works today — not a PR)
`install.sh` copies `skills/fusion`, `agents/fusion-*`, `commands/fusion*` into `~/.omp/agent/{skills,agents,commands}`. Custom agents are available → SKILL.md's **custom-agent** path. This is how Fusion runs right now.

### 2. OMP plugin (distributable, no core PR) — recommended for sharing
Ship as an npm/git package with an `omp` manifest (`package.json` — already in this repo). Install via
`omp plugin link <path>` (local checkout) or `omp plugin install <pkg>` (registry/git). OMP
auto-discovers `skills/fusion` + `commands/`. **Agents are not discovered**, so the skill uses the
bundled **`task`** agent — see SKILL.md *"Plugin mode — no custom agents"*. `install.sh --plugin` does
the link. This is the lowest-friction way to give Fusion to other OMP users.

### 3. First-party PR to oh-my-pi core
There are now **two** core framings, with the advisor as precedent (see the fact table):

- **Agents-only (low effort, low value).** Add `fusion-proposer.md` + `fusion-aggregator.md` to
  `src/prompts/agents/` (joining task/oracle/reviewer). Trivial PR — but two subagent *types* without an
  in-core orchestrator do little; the skill that drives the `eval` fan-out still has no bundled-`.md` home.
- **`/fusion` as an advisor-sibling feature (higher effort, the version worth merging).** OMP already
  ships the **advisor** (one watchdog model reviewing the transcript, `modelRoles.advisor`, `/advisor
  on/off`). Fusion is its generalization: a panel → aggregator run configured via `modelRoles.aggregator` /
  `proposer_N` (the idiom this repo already uses), exposed as a builtin `/fusion`. This is a
  TypeScript build in core, maintainer-gated — but the advisor proves the surface is welcome in principle.

**Recommended upstream move:** ship path 2 (plugin) publicly first as the working reference, then open an
**issue** asking maintainers which scope they'd accept — the two agents, or a real `/fusion` feature —
rather than pre-committing. This repo (skill + commands + agents) is the prototype/spec either way.

## Repo-contract checklist (from PR #2610 review, verified)
- [ ] **Prompts in static `.md`** — no inline TS strings/template literals. (Skill body + `references/judge_rubric.md` + agent system prompts satisfy this; the `eval` snippets in SKILL.md are *instructional*, not committed prompt-building code.)
- [ ] **`## [Unreleased]` CHANGELOG** entry in every touched package (this repo ships `CHANGELOG.md`).
- [ ] **OMP agent frontmatter** (`name`/`description`/`model`/`tools`/`thinkingLevel`) — not Claude fields (cf. #2209).
- [ ] **No external-CLI / `command -v` assumptions** — pure OMP subagents.
- [ ] **`task`/`eval` model override is honored** (`executor.ts` `modelOverride ?? agent.model`; `eval/agent-bridge.ts` resolves `parsed.model`). Plugin mode relies on this to vary models with the single `task` agent.

## Cross-harness (vanilla pi)
This package also carries a `pi` manifest. The skill/commands install on both, but the **parallel eval
fan-out is OMP-only** — see `docs/CROSS-COMPAT.md`.
