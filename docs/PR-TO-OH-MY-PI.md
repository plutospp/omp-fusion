# Proposing Fusion as a bundled OMP skill (PR to can1357/oh-my-pi)

This repo is structured so the skill can be lifted into oh-my-pi with minimal reshaping. This doc records
the mapping and the repo-contract checklist gathered from oh-my-pi issues/PRs research.

## Why a skill (not an extension package)

Fusion is **orchestration over existing primitives**, not new runtime machinery. It needs:
- parallel subagents with per-call models  → the `task` tool / `eval` `agent()` + `parallel()` (exist)
- model resolution by string / role alias  → `ctx.models.resolve` landed in `main` (#2406)
- a separate judge subagent                → ordinary subagent

So it ships as instructions (a `SKILL.md`) + two bundled agents + slash commands + a rubric `.md`. No new
core code is required. (Contrast with the closed-not-planned #2609 / open PR #2610, which tried to add
synthetic "blended models" as a *core* feature — heavier, and rejected. Fusion deliberately stays in
userland-skill territory.)

## File mapping (this repo → oh-my-pi)

| This repo | Likely oh-my-pi home | Notes |
|---|---|---|
| `skills/fusion/SKILL.md` | bundled skills dir (alongside the other bundled `SKILL.md`s) | the orchestration prompt |
| `skills/fusion/references/judge_rubric.md` | next to the skill | prompt text, kept in `.md` (see contract) |
| `agents/fusion-panel.md` | bundled agents dir (with `task.md`, `reviewer.md`, …) | panelist |
| `agents/fusion-judge.md` | bundled agents dir | judge |
| `commands/fusion*.md` | bundled commands dir | slash entry points |
| `scripts/detect_panel.sh` | skill `scripts/` (optional) | advisory, not required at runtime |

Confirm exact bundled directories against the repo layout at PR time (they have moved before).

## Repo-contract checklist (from oh-my-pi conventions)

- [ ] **Prompts live in static `.md` files**, not built from inline strings/template-literals in TS. The
      reviewers enforced this on PR #2610 ("move these strings into `.md` templates imported with
      `{ type: "text" }`"). Fusion already keeps the judge rubric and panelist brief as prose in `.md`;
      the `eval` snippet in `SKILL.md` is *instructional* (a skill is itself a prompt), not committed
      prompt-building code. If any panel/judge text becomes core TS, move it to a `.md` imported with
      `{ type: "text" }`.
- [ ] **Custom `modelRoles` keys** (`fusion_judge`, `fusion_panel_*`) resolve via `pi/<key>` — confirmed
      supported. Document them in `docs/` (the repo asks for doc entries for new config surface; cf.
      #2447 on documenting settings).
- [ ] **Don't pin model versions** in command/skill text — reference roles, so it doesn't rot. (Done.)
- [ ] **CHANGELOG**: add an `## [Unreleased]` entry in each touched package (reviewers flagged a missing
      changelog on #2610).
- [ ] **Agent schema**: frontmatter uses OMP fields (`name`, `description`, `model`, `tools`,
      `thinkingLevel`), not Claude Code fields. (Done — and #2209 is the cautionary tale of mixing the
      two schemas.)
- [ ] **No external CLI assumptions** (`codex`/`gemini`/`agy`, `command -v`). (Done — pure OMP subagents.)
- [ ] **`task`/`eval` model override** is honored by core (caller `model` wins for the subagent). Verify
      on the target build; if a build makes agent-frontmatter authoritative, split `fusion-panel` into
      per-slot agents (`fusion-panel-1/2/3`) each pinning `model: [pi/fusion_panel_N]`.
- [ ] Default install must **not** change behavior for users who don't invoke it (skills are inert until
      triggered — satisfied).

## Possible future tie-ins (not required for v1)

- **#2574 `ctx.agents.spawn`** (open proposal): if it lands, an extension could expose Fusion as a
  hub-visible, steerable panel with live panes instead of a skill-driven `eval` fan-out. The skill form
  works today and needs no core change; the extension form is a nicer UX once the primitive exists.
- **#2912 / PR #2915 provider-failure fallback chains**: makes panel degradation (a dead provider) clean
  — Fusion already assumes OMP handles provider fallback under the chosen role.
