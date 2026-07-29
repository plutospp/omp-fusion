#!/usr/bin/env bash
# detect_panel.sh — inspect an OMP config.yml and print a suggested cross-family Fusion + Ultrafusion modelRoles block.
#
# Advisory only: it prints YAML; it never edits config. It reads existing modelRoles (slow / default /
# plan / vision / designer) to pick a cross-family panel + a strong judge, de-duplicating by provider so
# the panel spans families where possible. Dependency-light: uses awk; uses `yq` only if present.
#
# usage: detect_panel.sh [path-to-config.yml]   (default: ~/.omp/agent/config.yml)

set -euo pipefail

CONFIG="${1:-$HOME/.omp/agent/config.yml}"

# read a modelRoles value by key from the config (best-effort; awk-based, no yq required).
# Assumes ONE top-level `modelRoles:` block (reads the first match); overlay/profile configs may differ.
role_value() {
  local key="$1"
  [ -f "$CONFIG" ] || return 0
  awk -v k="$key" '
    /^modelRoles:/ { inroles=1; next }
    inroles && /^[^[:space:]]/ { inroles=0 }            # left the modelRoles block
    inroles {
      line=$0
      sub(/^[[:space:]]+/, "", line)
      if (line ~ "^" k ":") {
        sub("^" k ":[[:space:]]*", "", line)
        gsub(/["\x27]/, "", line)                       # strip quotes
        print line
        exit
      }
    }
  ' "$CONFIG"
}

provider_of() { printf '%s\n' "${1%%/*}"; }  # provider prefix before first '/' (exact: openai != openai-codex)

SLOW="$(role_value slow)";       SLOW="${SLOW:-anthropic/claude-opus-4-8:high}"
DEFAULT="$(role_value default)"; DEFAULT="${DEFAULT:-openai-codex/gpt-5.5:high}"
PLAN="$(role_value plan)"
VISION="$(role_value vision)"
DESIGNER="$(role_value designer)"

# build a cross-family panel: start from slow + default, add a third distinct provider if we can find one
PANEL=()
SEEN=""
add_panel() {
  local m="$1"; [ -n "$m" ] || return 0
  local p; p="$(provider_of "$m")"
  case " $SEEN " in *" $p "*) return 0 ;; esac          # skip duplicate provider family
  SEEN="$SEEN $p"; PANEL+=("$m")
}
add_panel "$SLOW"
add_panel "$DEFAULT"
for cand in "$PLAN" "$DESIGNER" "$VISION"; do
  [ "${#PANEL[@]}" -ge 3 ] && break
  add_panel "$cand"
done

# aggregator: REQUIRED — no implicit default. Strongest = slow. Shared by Fusion and Ultrafusion.
echo "modelRoles:"
echo "  aggregator: $SLOW"
i=1
for m in "${PANEL[@]}"; do
  printf '  proposer_%d: %s\n' "$i" "$m"
  i=$((i + 1))
done

# Ultrafusion reads the SAME aggregator/proposer_* keys above, plus its own critic_N wave.
# Add more proposer_N / critic_N lines yourself for a larger panel — numbered from 1, gaps ignored.
i=1
for m in "${PANEL[@]}"; do
  printf '  critic_%d: %s\n' "$i" "$m"
  i=$((i + 1))
done

if [ "${#PANEL[@]}" -lt 2 ]; then
  echo "  # only one usable model found — Fusion will run it twice (floor mode)."
fi
