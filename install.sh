#!/usr/bin/env bash
# install.sh — install the Fusion skill + slash commands + agents into an OMP (or vanilla pi) config dir.
#
# Copies:
#   skills/fusion   -> $AGENT_DIR/skills/fusion
#   agents/*.md     -> $AGENT_DIR/agents/
#   commands/*.md   -> $AGENT_DIR/commands/
#
# AGENT_DIR defaults to ~/.omp/agent. Override with --dir <path>, or use --pi for ~/.pi/agent.
# Idempotent: re-running overwrites the installed copies. Never deletes anything outside the three
# fusion targets.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${OMP_AGENT_DIR:-$HOME/.omp/agent}"

while [ $# -gt 0 ]; do
  case "$1" in
    --pi)   AGENT_DIR="$HOME/.pi/agent"; shift ;;
    --dir)  AGENT_DIR="${2:?--dir needs a path}"; shift 2 ;;
    -h|--help)
      echo "usage: install.sh [--pi | --dir <agent-dir>]"
      echo "  default agent dir: ~/.omp/agent (override with OMP_AGENT_DIR, --dir, or --pi)"
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# never let an empty AGENT_DIR turn the rm -rf below into an absolute-path disaster
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
  echo "Note: roles are optional. With none set, Fusion uses pi/slow + pi/default"
  echo "and /fusion-solo always works (pi/slow run twice). Edit config.yml yourself;"
  echo "this installer does not modify it."
fi

echo
echo "Done. Restart omp (or run /reload) and try:  /fusion-solo <a hard question>"
