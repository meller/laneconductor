# Track AM-10037: Worker Strip — Running/Last Track + Chat With Worker

**Lane**: done
**Lane Status**: success
**Progress**: 100%
**Last Run**: claude/claude-haiku-4-5-20251001 (primary)
**Phase**: Merged to main
**Type**: dev
**Track Kind**: feature
**Merge Mode**: direct
**Auto Run**: yes
**Author**: AM
**Created By**: asaf.meller@gmail.com
**Summary**: Worker strip on the lanes view shows each worker's running track (active workers sorted first) and its last-context track; clicking deep-dives into the track or opens a chat with the worker (reusing…

## Problem
The worker strip shows workers but not what they're doing at a glance; there is no way to talk to a worker from the UI, and no visibility into which track a worker still has warm session context for.

## Solution
Sort active workers first in the strip, render running-track and last-track chips per worker, and add a worker chat panel (live transcript + message input that posts into the relevant track's conversation, waking the worker via the existing session-resume path) reachable from both the strip and the Machine Workers view.
