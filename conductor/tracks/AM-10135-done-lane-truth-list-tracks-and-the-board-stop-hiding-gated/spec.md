# Spec: Done lane truth: list_tracks and the board stop hiding gated-but-unmerged work

## Problem Statement

From the 2026-11-18 audit of daemon-era fixes versus the plugin (finding B6, severity high). In the plugin world `done:queue` means "gated, not merged", `done:success` means shipped. Today `list_tracks` hides the whole done lane by default (connector/src/tools/list-tracks.mjs:48), so `done:queue`, `done:failure` and `done:waiting` (PR open) vanish; the board's attention rule excludes `done` (connector/src/board.mjs:76); and nothing checks that a track marked done is reachable from the state branch. otralingo's `quality-gate.on_success` is the bare `done`, so its gated tracks land in `done:queue` and disappear.

Scope: default list hides only `done:success`; attention rules for `done:queue`, `done:failure`, `done:waiting`; an optional `merged` check using `git merge-base --is-ancestor` of the track branch; board and tests. Reference: the daemon's services/done-lane-bucket.mjs and resting-state.mjs (tag v1-legacy), tracks 10035 and 10076.

## Symptom

(To be filled in.)

## Steps to reproduce

(To be filled in.)

## Expected result

(To be filled in.)

## Actual result

(To be filled in.)

## Suspected area

(To be filled in.)

## Environment

(To be filled in.)
