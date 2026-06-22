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
| Custom task-subagent *types* (`fusion-panel`/`fusion-judge`) | ✅ from `~/.omp/agent/agents` / bundled — **not** from a plugin | ❌ no agent-type concept; pi-native fan-out is done in extension code (see `pi-fusion`) or via `createAgentSession` |
| **Parallel eval fan-out** (`parallel()` + `agent({model})`) | ✅ native (`eval/agent-bridge.ts`) — Fusion's core mechanism | ❌ **not present** — pi has no `eval` `agent()`/`parallel()` helpers |
| Per-subagent model override | ✅ `modelOverride ?? agent.model` | n/a (different spawn API) |

## What this means

- **Install** is cross-compatible: one package, dual `omp` + `pi` manifest. Both load the `fusion` skill
  (via OMP auto-discovery / pi's `pi.skills`). The `/fusion-*` slash commands are **OMP-native** — pi has
  no equivalent `/command` system, so pi users invoke the skill directly (`/skill:fusion` or by prose).
- **Running the panel** is **OMP-native**. Fusion's value is the blind parallel panel → judge synthesis,
  and the parallel fan-out uses OMP's `eval` `parallel()`/`agent({model})`. Vanilla pi lacks those.
- On **vanilla pi**, Fusion degrades to: the skill *describes the method*, but pi has no `eval`
  `parallel()`/`agent()` to execute the fan-out. The proven pi-native implementation is a separate
  published extension — **[`synthetic-recon/pi-fusion`](https://github.com/synthetic-recon/pi-fusion)**
  (npm, MIT) — which drives the same panel→judge pipeline by calling pi's `ModelRegistry`
  (`@earendil-works/pi-ai`) directly with its own concurrency limiter (no subagents). So on pi the method
  and prompts port via this skill, but the automatic parallel execution comes from that extension.

## Recommendation

- **Primary target: OMP.** Use `install.sh` (custom-agent mode) or `install.sh --plugin` (task-agent
  mode). Both give the full parallel panel → judge pipeline.
- **vanilla pi: use the dedicated extension.** This package installs the skill (method + prompts) on pi,
  but the parallel fan-out is OMP-native. For a turnkey pi experience, install
  **`pi install npm:pi-fusion`** ([`synthetic-recon/pi-fusion`](https://github.com/synthetic-recon/pi-fusion)) —
  a pi extension that implements the fan-out in TypeScript. `fusion-omp` stays the **OMP-native** skill;
  the two are complementary (same method, different harness).

## Why not a single `.ts` extension that works on both?

OMP and pi both read a `package.json` `omp`/`pi` `extensions` array of JS entry points, so a dual-adapter
extension is *possible* (see `pi-omp-session-sync`'s `adapters/omp` + `adapters/pi`). But Fusion needs no
custom runtime code on OMP (it's pure skill + the native `eval` fan-out), and a pi adapter would have to
reimplement parallel spawning on pi's different subagent API — which is exactly what the standalone
**`synthetic-recon/pi-fusion`** extension already does. Rather than duplicate it, this repo keeps Fusion
as a content package (skill + commands + agents) plus the dual manifest, stays OMP-native for execution,
points pi users at `pi-fusion` for the pi runtime, and documents the gap honestly rather than shipping an
unverified pi fan-out.
