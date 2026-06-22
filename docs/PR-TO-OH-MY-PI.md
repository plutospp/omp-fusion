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
| There is **no** `src/skills/` or `src/commands/` in OMP | package source | OMP ships **no first-party bundled skills/commands** — only bundled **agents** (`src/prompts/agents/`: task, oracle, explore, reviewer, designer, plan, librarian, init, frontmatter). |
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
Only the **two agents** have a clean first-party home: add `fusion-panel.md` + `fusion-judge.md` to
`src/prompts/agents/` (joining task/oracle/explore). The **skill + commands have no first-party home**
(no `src/skills`, no `src/commands`), and #2609 (closed *not-planned*) shows maintainers reject added
core orchestration surface. So a *full* fusion core PR is unlikely to be wanted; an **agents-only** PR is
the realistic core ask — but it delivers little without the skill, so path 2 is usually better.

## Repo-contract checklist (from PR #2610 review, verified)
- [ ] **Prompts in static `.md`** — no inline TS strings/template literals. (Skill body + `references/judge_rubric.md` + agent system prompts satisfy this; the `eval` snippets in SKILL.md are *instructional*, not committed prompt-building code.)
- [ ] **`## [Unreleased]` CHANGELOG** entry in every touched package (this repo ships `CHANGELOG.md`).
- [ ] **OMP agent frontmatter** (`name`/`description`/`model`/`tools`/`thinkingLevel`) — not Claude fields (cf. #2209).
- [ ] **No external-CLI / `command -v` assumptions** — pure OMP subagents.
- [ ] **`task`/`eval` model override is honored** (`executor.ts` `modelOverride ?? agent.model`; `eval/agent-bridge.ts` resolves `parsed.model`). Plugin mode relies on this to vary models with the single `task` agent.

## Cross-harness (vanilla pi)
This package also carries a `pi` manifest. The skill/commands install on both, but the **parallel eval
fan-out is OMP-only** — see `docs/CROSS-COMPAT.md`.
