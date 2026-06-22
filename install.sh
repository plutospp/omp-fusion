#!/usr/bin/env bash
# install.sh — install Fusion into an OMP (or vanilla pi) config dir, or link it as an OMP plugin.
#
# Modes:
#   (default)   copy skill + agents + commands into $AGENT_DIR (~/.omp/agent). The custom
#               fusion-panel/fusion-judge agents are available -> SKILL.md custom-agent path.
#   --plugin    register THIS repo as an OMP plugin via `omp plugin link` (no file copies). OMP
#               auto-discovers skills/ + commands/; `agents/` is NOT discovered from a plugin, so the
#               skill uses the bundled `task` agent (SKILL.md "Plugin mode"). See docs/PR-TO-OH-MY-PI.md.
#   --pi        copy into ~/.pi/agent (vanilla pi). Install only — fan-out is OMP-native; see
#               docs/CROSS-COMPAT.md.
#   --dir <p>   copy into an explicit agent dir (OMP_AGENT_DIR also works).
#
# Idempotent. Never deletes anything outside the three fusion targets.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${OMP_AGENT_DIR:-$HOME/.omp/agent}"
MODE=copy

while [ $# -gt 0 ]; do
  case "$1" in
    --plugin) MODE=plugin; shift ;;
    --pi)     AGENT_DIR="$HOME/.pi/agent"; shift ;;
    --dir)    AGENT_DIR="${2:?--dir needs a path}"; shift 2 ;;
    -h|--help)
      echo "usage: install.sh [--plugin | --pi | --dir <agent-dir>]"
      echo "  (default)  copy skill+agents+commands into ~/.omp/agent (custom-agent mode)"
      echo "  --plugin   omp plugin link this repo (skill+commands auto-discovered; task-agent mode)"
      echo "  --pi       copy into ~/.pi/agent (vanilla pi; install only — see docs/CROSS-COMPAT.md)"
      echo "  --dir <p>  copy into an explicit agent dir (OMP_AGENT_DIR also works)"
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# --- plugin mode: link the repo so OMP auto-discovers skills/ + commands/ ---
if [ "$MODE" = plugin ]; then
  if ! command -v omp >/dev/null 2>&1; then
    echo "error: 'omp' not on PATH; cannot link plugin. Use the default copy install instead." >&2
    exit 1
  fi
  echo "Linking Fusion as an OMP plugin: $HERE"
  omp plugin link "$HERE"
  echo
  echo "Linked. OMP auto-discovers skills/fusion + commands/ from this repo."
  echo "Plugin surface does NOT register the custom agents — the skill uses the bundled 'task' agent"
  echo "(see SKILL.md 'Plugin mode'). Restart omp or /reload, then try:  /fusion-solo <a hard question>"
  exit 0
fi

# --- copy mode ---
[ -n "$AGENT_DIR" ] || { echo "error: agent dir resolved empty (check OMP_AGENT_DIR / --dir)" >&2; exit 1; }

echo "Installing Fusion into: $AGENT_DIR"
mkdir -p "$AGENT_DIR/skills" "$AGENT_DIR/agents" "$AGENT_DIR/commands"

# skill (whole dir)
rm -rf "$AGENT_DIR/skills/fusion"
cp -R "$HERE/skills/fusion" "$AGENT_DIR/skills/fusion"

# agents + commands (individual files only)
cp "$HERE/agents/fusion-panel.md"  "$AGENT_DIR/agents/fusion-panel.md"
cp "$HERE/agents/fusion-judge.md"  "$AGENT_DIR/agents/fusion-judge.md"
for f in fusion fusion-solo fusion-pair fusion-trio; do
  cp "$HERE/commands/$f.md" "$AGENT_DIR/commands/$f.md"
done

echo "Installed:"
echo "  skill    : $AGENT_DIR/skills/fusion"
echo "  agents   : fusion-panel, fusion-judge"
echo "  commands : /fusion /fusion-solo /fusion-pair /fusion-trio"
echo

# suggest modelRoles
if [ -x "$HERE/scripts/detect_panel.sh" ]; then
  echo "Suggested modelRoles (add to $AGENT_DIR/config.yml under modelRoles:):"
  echo "----------------------------------------------------------------------"
  "$HERE/scripts/detect_panel.sh" "$AGENT_DIR/config.yml" || true
  echo "----------------------------------------------------------------------"
  echo "Roles optional: with none set, Fusion uses pi/slow + pi/default; /fusion-solo always works."
  echo "This installer does not modify config.yml."
fi

echo
echo "Done. Restart omp (or run /reload) and try:  /fusion-solo <a hard question>"
