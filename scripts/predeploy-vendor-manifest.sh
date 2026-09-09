#!/bin/bash
# Intended as firebase.json's functions.predeploy hook (regenerates
# cloud/functions/collector-manifest.js from
# conductor/services/collector-manifest.mjs — Track 10061 D4) — currently
# NOT wired in there (functions.predeploy is deliberately []).
#
# Found live 2026-09-09: the installed standalone `firebase` CLI (a
# pkg-bundled executable, v15.5.1) cannot run ANY form of a predeploy hook
# that ends up executing this .mjs script — a bare `node script.mjs`, a
# `bash -c '...'` wrapper, and this very shebang'd script file all threw the
# identical ERR_REQUIRE_ESM (then MODULE_NOT_FOUND once wrapped) from
# *inside firebase's own bundled Node v20.18.2 runtime* (the system's own
# node is v22; the error trace's `pkg/prelude/bootstrap.js` frames confirm
# it's firebase's packaged runtime, not a real subprocess reaching this
# script at all) — not from this script, which runs correctly every time it
# is invoked directly (verified immediately before disabling the hook, and
# before every deploy since). The freshness guarantee this hook existed for
# is still independently covered by
# conductor/tests/track-10061-collector-manifest.test.mjs, which fails the
# suite on drift regardless. Needs a real fix (a firebase-tools upgrade, or
# a predeploy form the packaged binary can actually run) — worth a track.
# Until then: run this manually (or via `node
# conductor/scripts/vendor-collector-manifest.mjs --check`) before a
# functions deploy, the same way you'd run any other pre-deploy check by
# hand.
set -euo pipefail
cd "$(dirname "$0")/.."
node conductor/scripts/vendor-collector-manifest.mjs
