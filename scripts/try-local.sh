#!/usr/bin/env bash
# Try the three LaneConductor plugins together, from THIS repository, in a scratch git repository (track AM-10128, Phase 5 Task 3).
#
#   scripts/try-local.sh [--dry-run] [--allow-name-clash] <scratch-repo-path>
#
# What it does, in order, printing every command before it runs it:
#   1. makes the scratch repository if the path does not exist (git init, a minimal conductor/ folder, one commit);
#   2. exports a copy of THIS repository at HEAD, renames its marketplace to laneconductor-try, and adds that copy as a LOCAL marketplace
#   3. installs laneconductor, laneconductor-parallel and laneconductor-board (@laneconductor-try) at local scope into the scratch repository;
#   4. disables, at LOCAL scope in the scratch repository only, any enabled plugin of the same names that comes from another marketplace
#      (your real all-in-one laneconductor@laneconductor, for one): two plugins named alike would be two /laneconductor: namespaces and two connectors;
#   5. prints what to type next, and how to undo it.
#
# Safety: it never touches a real project. The scratch path must be a git repository that is not this one and either lives under the
# system temp folder or holds the marker file .lc-scratch (which step 1 writes); anything else is refused. Everything is declared at
# LOCAL scope, so the declarations land in the scratch repository's .claude/settings.local.json. It does not push, merge or submit
# anything. The disable of step 4 is `claude plugin disable <id> --scope local`, run inside the scratch repository: it writes only the
# scratch repository's .claude/settings.local.json, never your user settings, and it goes away when the scratch repository is deleted.
# --dry-run prints the commands and runs none of them (the read-only `claude plugin marketplace list` and `claude plugin list --json`
# are the exceptions: the first warns about a name clash, the second finds what step 4 would disable).
#
# THE REAL MARKETPLACE IS NEVER TOUCHED. This repository's marketplace is named `laneconductor`, and you probably have a marketplace of that
# name configured from GitHub (meller/laneconductor). So step 2 exports a COPY of this repository at HEAD (git archive) into a temp folder,
# changes only the marketplace `name` in the copy's .claude-plugin/marketplace.json to `laneconductor-try`, and adds THAT folder as the
# local marketplace; the plugins are installed as <plugin>@laneconductor-try. Uncommitted changes in this repository are not in the copy.
# If a marketplace named laneconductor-try is already configured (from an earlier try), the script stops unless you pass --allow-name-clash.
set -euo pipefail

dry=0
clash_ok=0
scratch=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1 ;;
    --allow-name-clash) clash_ok=1 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
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

# ---- the copy's marketplace name must be free (read only) ----
try_name="laneconductor-try"
if listing="$(claude plugin marketplace list 2>/dev/null)"; then
  if printf '%s\n' "$listing" | grep -q "$try_name"; then
    echo "WARNING: a marketplace named $try_name is already configured (from an earlier try):"
    printf '%s\n' "$listing" | grep -A1 "$try_name" | sed 's/^/    /'
    echo "  Remove it yourself first (not run here):  claude plugin marketplace remove $try_name"
    if [ "$dry" -eq 0 ] && [ "$clash_ok" -eq 0 ]; then echo "stopping: pass --allow-name-clash to go on anyway." >&2; exit 3; fi
    echo
  fi
fi

# ---- 2. the local marketplace: a renamed COPY, so the real laneconductor marketplace is never touched ----
copy="$tmproot/lc-try-marketplace-$(basename "$scratch")"
echo "# 2. export a copy of this repository at HEAD, rename ITS marketplace to $try_name, and add the copy as a local marketplace (declared at local scope)"
if [ -e "$copy" ]; then
  [ -f "$copy/.lc-try-marketplace" ] || { echo "refused: $copy exists and was not made by this script" >&2; exit 2; }
  run rm -rf "$copy"
fi
run mkdir -p "$copy"
printf '+ %s\n' "git -C $(quote "$here") archive HEAD | tar -x -C $(quote "$copy")"
if [ "$dry" -eq 0 ]; then git -C "$here" archive HEAD | tar -x -C "$copy"; fi
run touch "$copy/.lc-try-marketplace"
run sed -i "0,/^  \"name\": \"laneconductor\",/s//  \"name\": \"$try_name\",/" "$copy/.claude-plugin/marketplace.json"
in_scratch claude plugin marketplace add "$copy" --scope local
echo

# ---- 3. the three plugins ----
echo "# 3. install the three plugins from $try_name at local scope into the scratch repository"
in_scratch claude plugin install "laneconductor@$try_name" --scope local
in_scratch claude plugin install "laneconductor-parallel@$try_name" --scope local
in_scratch claude plugin install "laneconductor-board@$try_name" --scope local
echo

# ---- 4. disable same-named plugins from other marketplaces, in the scratch repository only ----
# The owner's real laneconductor@laneconductor (user scope) stays enabled in every project, and next to the base installed above it would be the same
# plugin name twice: two /laneconductor: namespaces and two connectors. `claude plugin disable <id> --scope local`, run INSIDE the scratch
# repository, records the disable in the scratch repository's .claude/settings.local.json only. User settings are never written.
echo "# 4. disable the same-named plugins of other marketplaces, at local scope in the scratch repository only"
list_dir="$scratch"; [ -d "$list_dir" ] || list_dir="$tmproot"
clash_ids=""
if plugin_json="$(cd "$list_dir" && claude plugin list --json 2>/dev/null)" && [ -n "$plugin_json" ]; then
  if clash_ids="$(printf '%s' "$plugin_json" | node -e '
    let d = ""; process.stdin.on("data", (c) => { d += c; }).on("end", () => {
      let list; try { list = JSON.parse(d); } catch { process.exit(3); }
      const names = new Set(["laneconductor", "laneconductor-parallel", "laneconductor-board"]);
      const ids = new Set();
      for (const p of list) {
        const [name, market] = String(p.id).split("@");
        if (!names.has(name) || !market || market === process.argv[1] || p.enabled !== true) continue;
        if (p.scope === "user" || p.projectPath === process.argv[2]) ids.add(p.id);
      }
      console.log([...ids].sort().join("\n"));
    });' "$try_name" "$scratch" 2>/dev/null)"; then
    :
  else
    clash_ids=""; echo "WARNING: could not read the output of claude plugin list --json; disable any other enabled laneconductor plugin yourself:  claude plugin disable laneconductor@<marketplace> --scope local   (run inside $scratch)"
  fi
else
  echo "WARNING: claude plugin list --json failed; disable any other enabled laneconductor plugin yourself:  claude plugin disable laneconductor@<marketplace> --scope local   (run inside $scratch)"
fi
disabled_any=0
for id in $clash_ids; do
  in_scratch claude plugin disable "$id" --scope local
  disabled_any=1
done
[ "$disabled_any" -eq 1 ] || echo "no other enabled plugin named laneconductor, laneconductor-parallel or laneconductor-board was found; nothing to disable"
echo

# ---- 5. what to type ----
cat <<EOF
# 5. what to type
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
    claude plugin uninstall laneconductor-board@$try_name --scope local
The disable of your own laneconductor plugin (step 4, if any was needed) is recorded only in $scratch/.claude/settings.local.json. It applies to the
scratch repository alone; your user settings were not written, and the plugin stays enabled everywhere else. Deleting the scratch repository (the last
command below) undoes it, so nothing needs to be enabled again.
Undo (commands to run yourself; the script never runs them):
  claude plugin uninstall laneconductor-board@$try_name --scope local
  claude plugin uninstall laneconductor-parallel@$try_name --scope local
  claude plugin uninstall laneconductor@$try_name --scope local
  claude plugin marketplace remove $try_name
  rm -rf $copy $scratch
Your real laneconductor marketplace and installed plugins were not touched.
EOF
