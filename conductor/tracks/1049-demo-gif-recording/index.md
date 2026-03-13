# Track 1049: Demo GIF / Screen Recording

**Lane**: done
**Lane Status**: success
**Progress**: 0%
**Phase**: Complete
**Summary**: demo.gif recorded, compressed 14MB→8.5MB, committed and pushed. Embedded in README.
**Waiting for reply**: no

## Problem
Every post underperforms without a visual. A demo GIF is the single highest-leverage asset for this launch. Screenshots exist but don't show the "split-screen magic" of live sync.

## Solution
Record a 20–30 second screen recording showing:
1. A terminal running an agent (Claude or Gemini) or `lc status`
2. The Kanban dashboard at localhost:8090 updating in real-time
3. A track moving from in-progress → review (or showing progress update)

Export as GIF (for README embed) and optionally MP4 (for social/Product Hunt).

## Phases
- [x] Phase 1: Set up a demo scenario (one running track, clean board state)
- [ ] Phase 2: Record with Peek — terminal + Kanban side by side
- [ ] Phase 3: Export GIF + commit to /docs/demo.gif
- [ ] Phase 4: Embed GIF in README below the hero screenshot
