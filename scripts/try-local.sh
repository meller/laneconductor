#!/usr/bin/env bash
# Try the three LaneConductor plugins together, from THIS repository, in a scratch git repository (track AM-10128, Phase 5 Task 3).
#
#   scripts/try-local.sh [--dry-run] [--allow-name-clash] <scratch-repo-path>
#
# What it does, in order, printing every command before it runs it:
#   1. makes the scratch repository if the path does not exist (git init, a minimal conductor/ folder, one commit);
#   2. adds THIS repository as a LOCAL marketplace:  claude plugin marketplace add <this repo> --scope local
#   3. installs laneconductor, laneconductor-parallel and laneconductor-board at local scope into the scratch repository;
#   4. prints what to type next, and how to undo it.
#
# Safety: it never touches a real project. The scratch path must be a git repository that is not this one and either lives under the
# system temp folder or holds the marker file .lc-scratch (which step 1 writes); anything else is refused. Everything is declared at
# LOCAL scope, so the declarations land in the scratch repository's .claude/settings.local.json. It does not push, merge or submit
# anything. --dry-run prints the commands and runs none of them (a read-only `claude plugin marketplace list` is the one exception, to
# warn about a name clash).
#
# NAME CLASH: the marketplace in .claude-plugin/marketplace.json is named `laneconductor`. If a marketplace of that name is already
# configured from another source (for example GitHub meller/laneconductor), adding this one would clash with it, so the script stops and
# prints how to remove the old one (a command it never runs) unless you pass --allow-name-clash.
set -euo pipefail

dry=0
clash_ok=0
scratch=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1 ;;
    --allow-name-clash) clash_ok=1 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) if [ -n "$scratch" ]; then echo "only one scratch path, got a second: $1" >&2; exit 2; fi; scratch="$1" ;;
  esac
  shift
done
[ -n "$scratch" ] || { echo "usage: scripts/try-local.sh [--dry-run] [--allow-name-clash] <scratch-repo-path>" >&2; exit 2; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
case "$scratch" in /*) ;; *) scratch="$PWD/$scratch" ;; esac
# Resolve the scratch path without requiring it to exist yet: the nearest existing parent, resolved, plus the rest.
parent="$scratch"; rest=""
while [ ! -e "$parent" ]; do rest="/$(basename "$parent")$rest"; parent="$(dirname "$parent")"; done
scratch="$(cd "$parent" && pwd -P)$rest"
tmproot="$(cd "${TMPDIR:-/tmp}" && pwd -P)"

# ---- refuse anything that could be a real project ----
case "$scratch/" in
  "$here"/*) echo "refused: $scratch is this repository (or inside it). Give a separate scratch path." >&2; exit 2 ;;
esac
if [ -e "$scratch" ]; then
  [ -d "$scratch" ] || { echo "refused: $scratch exists and is not a directory" >&2; exit 2; }
  git -C "$scratch" rev-parse --show-toplevel >/dev/null 2>&1 || { echo "refused: $scratch exists and is not a git repository" >&2; exit 2; }
  [ "$(git -C "$scratch" rev-parse --show-toplevel)" = "$scratch" ] || { echo "refused: $scratch is inside another repository ($(git -C "$scratch" rev-parse --show-toplevel))" >&2; exit 2; }
  case "$scratch/" in
    "$tmproot"/*) ;;
    *) [ -f "$scratch/.lc-scratch" ] || { echo "refused: $scratch is not under $tmproot and has no .lc-scratch marker, so it may be a real project. Use a path under $tmproot, or a repository this script made." >&2; exit 2; } ;;
  esac
else
  case "$scratch/" in
    "$tmproot"/*) ;;
    *) echo "refused: $scratch does not exist and is not under $tmproot; a new scratch repository is only made under the system temp folder." >&2; exit 2 ;;
  esac
fi

# ---- print every command before running it ----
quote() { local out='' a; for a in "$@"; do out+="$(printf '%q' "$a") "; done; printf '%s' "${out% }"; }
show() { printf '+ %s\n' "$(quote "$@")"; }
run() { show "$@"; if [ "$dry" -eq 0 ]; then "$@"; fi; }
in_scratch() { printf '+ (cd %s && %s)\n' "$(quote "$scratch")" "$(quote "$@")"; if [ "$dry" -eq 0 ]; then (cd "$scratch" && "$@"); fi; }

[ "$dry" -eq 1 ] && echo "DRY RUN: the commands below are printed, not run."
echo "This repository : $here"
echo "Scratch repo    : $scratch"
echo

# ---- 1. the scratch repository ----
if [ ! -e "$scratch" ]; then
  echo "# 1. make the scratch repository"
  run mkdir -p "$scratch/conductor/tracks"
  in_scratch git init -q -b main
  show write "$scratch/conductor/workflow.json" "$scratch/conductor/tracks/.gitkeep" "$scratch/.lc-scratch"
  if [ "$dry" -eq 0 ]; then
    cat > "$scratch/conductor/workflow.json" <<'JSON'
{
  "lanes": {
    "plan": { "on_success": "plan:success" },
    "implement": { "on_success": "review:queue" },
    "review": { "on_success": "quality-gate:queue" },
    "quality-gate": { "on_success": "done:queue" },
    "done": {}
  }
}
JSON
    : > "$scratch/conductor/tracks/.gitkeep"
    echo "scratch repository made by scripts/try-local.sh; safe to delete" > "$scratch/.lc-scratch"
  fi
  in_scratch git add conductor/workflow.json conductor/tracks/.gitkeep .lc-scratch
  in_scratch git -c user.name=scratch -c user.email=scratch@example.invalid commit -q -m "scratch repository for trying LaneConductor"
  echo
else
  echo "# 1. the scratch repository exists; nothing to make"
  echo
fi

# ---- name clash check (read only) ----
if listing="$(claude plugin marketplace list 2>/dev/null)"; then
  if printf '%s\n' "$listing" | grep -q 'laneconductor'; then
    if ! printf '%s\n' "$listing" | grep -A1 'laneconductor' | grep -q "$here"; then
      echo "WARNING: a marketplace named laneconductor is already configured from another source:"
      printf '%s\n' "$listing" | grep -A1 'laneconductor' | sed 's/^/    /'
      echo "  Adding this repository under the same name would clash with it. To go on, remove the old one yourself first (not run here):"
      echo "    claude plugin marketplace remove laneconductor"
      echo "  and add it back from GitHub afterwards with:  claude plugin marketplace add meller/laneconductor"
      if [ "$dry" -eq 0 ] && [ "$clash_ok" -eq 0 ]; then echo "stopping: pass --allow-name-clash to go on anyway." >&2; exit 3; fi
      echo
    fi
  fi
fi

# ---- 2. the local marketplace ----
echo "# 2. add this repository as a local marketplace, declared at local scope (the scratch repository's .claude/settings.local.json)"
in_scratch claude plugin marketplace add "$here" --scope local
echo

# ---- 3. the three plugins ----
echo "# 3. install the three plugins at local scope into the scratch repository"
in_scratch claude plugin install laneconductor@laneconductor --scope local
in_scratch claude plugin install laneconductor-parallel@laneconductor --scope local
in_scratch claude plugin install laneconductor-board@laneconductor --scope local
echo

# ---- 4. what to type ----
cat <<EOF
# 4. what to type
  cd $scratch
  claude                                  # start a NEW session (a running session keeps old plugin processes); /reload-plugins also works
In the session:
  /laneconductor:help                     lists every command with an example phrase
  /mcp                                    shows plugin:laneconductor-parallel:lc connected (its tools are mcp__plugin_laneconductor-parallel_lc__*)
  /laneconductor:new try the three plugins together
  /laneconductor:plan <the number it prints>
  /laneconductor:move <number> implement  a write through the connector is conflict-checked (a second session editing the same track is refused with CONFLICT)
  /laneconductor:board                    builds the board with the board add-on's script and offers to publish it (say no unless you want an artifact)
  with all three installed the base recommends nothing; to see the funnel, uninstall an add-on, start a new session, and ask for the board:
    claude plugin uninstall laneconductor-board --scope local
Undo (commands to run yourself; the script never runs them):
  claude plugin uninstall laneconductor-board --scope local
  claude plugin uninstall laneconductor-parallel --scope local
  claude plugin uninstall laneconductor --scope local
  claude plugin marketplace remove laneconductor
  rm -rf $scratch
EOF
