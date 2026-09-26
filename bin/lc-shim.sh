#!/bin/sh
# Global 'lc' launcher, installed to /usr/local/bin/lc by `make install-cli`.
# @LC_ENTRY@ and @LC_NODE_HINT@ are substituted at install time.
#
# lc.mjs needs a Linux node binary, but nvm only puts node on PATH in
# interactive shells that source ~/.bashrc. This shim finds node itself so
# `lc` also works from non-interactive shells, `wsl.exe -e lc`, systemd,
# cron, sudo, and non-bash shells.

LC_ENTRY='@LC_ENTRY@'
LC_NODE_HINT='@LC_NODE_HINT@'

is_linux_node() {
  [ -n "$1" ] && [ -x "$1" ] && case "$1" in /mnt/*) return 1 ;; esac
}

newest_nvm_node() {
  [ -d "$1/versions/node" ] || return 1
  v=$(ls -1 "$1/versions/node" 2>/dev/null | sort -V | tail -n 1)
  [ -n "$v" ] && echo "$1/versions/node/$v/bin/node"
}

find_node() {
  # 1. Explicit override
  is_linux_node "$LC_NODE" && { echo "$LC_NODE"; return; }
  # 2. Whatever node is on PATH (respects the active nvm version)
  n=$(command -v node 2>/dev/null)
  is_linux_node "$n" && { echo "$n"; return; }
  # 3. The node that was active when `make install-cli` ran
  is_linux_node "$LC_NODE_HINT" && { echo "$LC_NODE_HINT"; return; }
  # 4. Newest nvm-installed node for the current user
  n=$(newest_nvm_node "${NVM_DIR:-$HOME/.nvm}")
  is_linux_node "$n" && { echo "$n"; return; }
  # 5. Newest nvm-installed node for the user who installed lc (e.g. under sudo/systemd)
  case "$LC_NODE_HINT" in
    */versions/node/*)
      n=$(newest_nvm_node "${LC_NODE_HINT%%/versions/node/*}")
      is_linux_node "$n" && { echo "$n"; return; }
      ;;
  esac
  return 1
}

NODE=$(find_node) || {
  echo "lc: could not find a Linux node binary." >&2
  echo "    Run 'make install-node' in the LaneConductor repo, or set LC_NODE=/path/to/node." >&2
  exit 127
}

exec "$NODE" "$LC_ENTRY" "$@"
