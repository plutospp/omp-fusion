# Cross-harness compatibility: OMP vs vanilla pi

Fusion targets **OMP** (`@oh-my-pi/pi-coding-agent`, `omp`). It can also *install* on **vanilla pi**
(`@earendil-works/pi-coding-agent`, `pi`) via the shared `package.json` `pi` manifest — but the two
harnesses have **diverged** (OMP v16.x vs pi v0.79.x), and the orchestration primitive Fusion relies on
is OMP-native. Verified against both packages' source/docs.

## Capability matrix

| Capability | OMP (`omp`) | vanilla pi (`pi`) |
|---|---|---|
| Skills (`SKILL.md`) | ✅ auto-discovered (incl. from plugin roots) | ✅ via `pi.skills` manifest / `~/.pi/agent/skills/` / `.agents/skills/` (`docs/skills.md`) |
| Slash commands | ✅ `commands/*.md` (plugin root + `~/.omp/agent/commands`) | ❌ OMP-native; pi has no `/command` system (it uses prompt templates with a different format). Not shipped for pi. |
| Custom task-subagent *types* (`fusion-panel`/`fusion-judge`) | ✅ from `~/.omp/agent/agents` / bundled — **not** from a plugin | ❌ no agent-type concept; subagents via `@tintinweb/pi-subagents` or `createAgentSession` |
| **Parallel eval fan-out** (`parallel()` + `agent({model})`) | ✅ native (`eval/agent-bridge.ts`) — Fusion's core mechanism | ❌ **not present** — pi has no `eval` `agent()`/`parallel()` helpers |
| Per-subagent model override | ✅ `modelOverride ?? agent.model` | n/a (different spawn API) |

## What this means

- **Install** is cross-compatible: one package, dual `omp` + `pi` manifest. Both load the `fusion` skill
  (via OMP auto-discovery / pi's `pi.skills`). The `/fusion-*` slash commands are **OMP-native** — pi has
  no equivalent `/command` system, so pi users invoke the skill directly (`/skill:fusion` or by prose).
- **Running the panel** is **OMP-native**. Fusion's value is the blind parallel panel → judge synthesis,
  and the parallel fan-out uses OMP's `eval` `parallel()`/`agent({model})`. Vanilla pi lacks those.
- On **vanilla pi**, Fusion degrades to: the skill *describes the method*, and the orchestrator would have
  to drive a subagent extension (e.g. `@tintinweb/pi-subagents`' `Agent` tool) to spawn panelists — which
  is **not implemented or verified here**. Treat pi support as *experimental*: the method and prompts
  port; the automatic parallel execution does not.

## Recommendation

- **Primary target: OMP.** Use `install.sh` (custom-agent mode) or `install.sh --plugin` (task-agent
  mode). Both give the full parallel panel → judge pipeline.
- **vanilla pi: experimental.** The skill installs and the method is sound, but wiring the fan-out to a
  pi subagent extension is future work. If you need it on pi today, drive the panel manually (run the
  same prompt against N models, paste the answers to a judge prompt) — the `judge_rubric.md` still
  applies.

## Why not a single `.ts` extension that works on both?

OMP and pi both read a `package.json` `omp`/`pi` `extensions` array of JS entry points, so a dual-adapter
extension is *possible* (see `pi-omp-session-sync`'s `adapters/omp` + `adapters/pi`). But Fusion needs no
custom runtime code on OMP (it's pure skill + the native `eval` fan-out), and a pi adapter would have to
reimplement parallel spawning on pi's different subagent API. That's a separate project; this repo keeps
Fusion as a content package (skill + commands + agents) plus the dual manifest, and documents the gap
honestly rather than shipping an unverified pi fan-out.
