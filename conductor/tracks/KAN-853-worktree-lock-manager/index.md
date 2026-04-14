# Track 1036: Worktree Lock Manager

**Lane**: done

**Lane Status**: success
**Progress**: 100%
**Last Run By**: gemini
**Phase**: New
**Summary**: Implement visibility and control over git worktree locks. Currently when a worker locks a track's worktree, there is no way to see which tracks are locked, release a lock, or merge partial progress back to main while staying in the current lane. Need: (1) lock status visibility in UI and CLI, (2) ability to unlock/release a lock (merging worktree progress back to main), (3) ability to force-unlock without merging (for stuck/dead workers). Future: option to bypass lock and allow parallel work on same track.
