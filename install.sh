#!/usr/bin/env bash
# install.sh — install Fusion the way each harness expects, or copy it into a config dir.
#
# Vanilla install paths (preferred — these are each harness's own documented mechanism):
#   --plugin   OMP plugin:  `omp plugin link <this repo>`  (local dev). For a published copy use
#              `omp plugin install git:github.com/jms830/omp-fusion`. OMP auto-discovers skills/ +
#              commands/ from the plugin; `agents/` is NOT discovered, so the skill uses the bundled
#              `task` agent (SKILL.md "Plugin mode").
#   --pi       vanilla pi package:  `pi install <this repo>`  (adds to ~/.pi/agent/settings.json via
#              pi's own installer; pi loads the skill from the pi.skills manifest). See
#              docs/CROSS-COMPAT.md — pi has no /command system or eval fan-out; run support is experimental.
#
# Convenience (no CLI needed — manual side-load into a config dir):
#   (default)  copy skill + agents + commands into ~/.omp/agent (custom fusion-panel/fusion-judge agents
#              available -> SKILL.md custom-agent path).
#   --dir <p>  copy into an explicit agent dir (OMP_AGENT_DIR also works).
#
# Idempotent. Never deletes anything outside the three fusion targets.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${OMP_AGENT_DIR:-$HOME/.omp/agent}"
MODE=copy

while [ $# -gt 0 ]; do
  case "$1" in
    --plugin) MODE=plugin; shift ;;
    --pi)     MODE=pi; shift ;;
    --dir)    AGENT_DIR="${2:?--dir needs a path}"; shift 2 ;;
    -h|--help)
      echo "usage: install.sh [--plugin | --pi | --dir <agent-dir>]"
      echo "  --plugin   OMP plugin via 'omp plugin link <repo>' (task-agent mode)"
      echo "  --pi       vanilla pi package via 'pi install <repo>' (skill only; see docs/CROSS-COMPAT.md)"
      echo "  (default)  copy skill+agents+commands into ~/.omp/agent (custom-agent mode)"
      echo "  --dir <p>  copy into an explicit agent dir (OMP_AGENT_DIR also works)"
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# --- OMP plugin: link the repo so OMP auto-discovers skills/ + commands/ (vanilla local-plugin path) ---
if [ "$MODE" = plugin ]; then
  if ! command -v omp >/dev/null 2>&1; then
    echo "error: 'omp' not on PATH; cannot link plugin. Use the default copy install instead." >&2
    exit 1
  fi
  echo "Linking Fusion as an OMP plugin:  omp plugin link $HERE"
  omp plugin link "$HERE"
  echo
  echo "Linked. OMP auto-discovers skills/fusion + commands/ from this repo."
  echo "The plugin surface does NOT register the custom agents — the skill uses the bundled 'task' agent"
  echo "(see SKILL.md 'Plugin mode'). Restart omp or /reload, then:  /fusion-solo <a hard question>"
  exit 0
fi

# --- vanilla pi: pi's own package installer (writes ~/.pi/agent/settings.json) ---
if [ "$MODE" = pi ]; then
  if ! command -v pi >/dev/null 2>&1; then
    echo "error: 'pi' not on PATH; cannot run 'pi install'. Use the default OMP install or --dir." >&2
    exit 1
  fi
  echo "Installing Fusion as a vanilla pi package:  pi install $HERE"
  pi install "$HERE"
  echo
  echo "Installed via pi. pi loads the fusion skill from the pi.skills manifest."
  echo "Note: vanilla pi has no /command system and no eval parallel fan-out — fan-out is OMP-native."
  echo "See docs/CROSS-COMPAT.md; vanilla-pi run support is experimental."
  exit 0
fi

# --- copy mode (manual side-load; no CLI required) ---
[ -n "$AGENT_DIR" ] || { echo "error: agent dir resolved empty (check OMP_AGENT_DIR / --dir)" >&2; exit 1; }

echo "Installing Fusion into: $AGENT_DIR"
mkdir -p "$AGENT_DIR/skills" "$AGENT_DIR/agents" "$AGENT_DIR/commands" "$AGENT_DIR/extensions/omp-fusion"

# skills (fusion + ultrafusion)
rm -rf "$AGENT_DIR/skills/fusion" "$AGENT_DIR/skills/ultrafusion"
cp -R "$HERE/skills/fusion" "$AGENT_DIR/skills/fusion"
if [ -d "$HERE/skills/ultrafusion" ]; then
  cp -R "$HERE/skills/ultrafusion" "$AGENT_DIR/skills/ultrafusion"
fi

# agents + commands (all markdown files)
cp "$HERE/agents/"*.md "$AGENT_DIR/agents/"
cp "$HERE/commands/"*.md "$AGENT_DIR/commands/"
if [ -d "$HERE/extension" ]; then
  cp -R "$HERE/extension/." "$AGENT_DIR/extensions/omp-fusion/"
fi

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
