#!/usr/bin/env bash
# Deploys the public site (landing/) to Firebase Hosting, project laneconductor-site. Run it only on the owner's word "deploy".
#   bash scripts/deploy-site.sh            deploys HEAD of this checkout (a clean copy of main, not the working checkout)
#   bash scripts/deploy-site.sh <commit>   deploys that commit's landing/ from a temporary checkout (a rollback)
# It writes landing/version.json (the short commit, the full commit and the time) into the deploy copy, so `deploy status` can read the
# live version; that file is not committed. The script itself always comes from the checkout it is run in, so it also rolls back to
# commits older than the script.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
target=${1:-HEAD}
git rev-parse --verify --quiet "$target^{commit}" >/dev/null || { echo "deploy-site: $target is not a commit" >&2; exit 1; }
if [ "$target" = HEAD ]; then
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "deploy-site: this copy has uncommitted changes; deploy from a clean copy of main" >&2; exit 1; fi
  dir=$root
else
  dir=$(mktemp -d /tmp/deploy-site-XXXXXX)
  git worktree add --detach "$dir" "$target" >/dev/null
  trap 'git -C "$root" worktree remove --force "$dir" >/dev/null 2>&1 || true' EXIT
fi
cd "$dir"
commit=$(git rev-parse HEAD)
printf '{"version":"%s","commit":"%s","time":"%s"}\n' "${commit:0:8}" "$commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > landing/version.json
firebase deploy --only hosting --project laneconductor-site
