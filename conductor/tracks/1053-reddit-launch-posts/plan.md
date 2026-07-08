# Plan: Track 1053 — Reddit Launch Posts

## Phase 1: Spec & Drafts (complete)

**Problem**: Three subreddits, three different audiences — need tailored posts with correct angles.
**Solution**: Lead with LLM crash recovery (universal hook) + tailor by community.

- [x] Identify angles per subreddit (LocalLLaMA=privacy+local, ClaudeAI=skill-file+context resets, SideProject=meta story)
- [x] Update positioning: whole-business scope, Karpathy autoresearch, skill-only mode
- [x] Draft r/LocalLLaMA post — filesystem-as-state + local-only angle
- [x] Draft r/ClaudeAI post — skill-file setup + context persistence angle
- [x] Draft r/SideProject post — meta story (HN scored 1, system replanned, this is the repost)
- [x] Write publish instructions for each post

**Impact**: Three publish-ready posts in spec.md.

---

## Phase 2: Publish (human-supervised)

**Problem**: Need to post all three in the same week as the HN launch.
**Solution**: Post sequentially on Day 1, 3, 5 of launch week.

- [ ] Post r/LocalLLaMA (Day 1 of HN launch week)
- [ ] Post r/ClaudeAI (Day 3)
- [ ] Post r/SideProject (Day 5)
- [ ] Reply "done" in conversation to start 72h KPI window

---

## Phase 3: Engage

- [ ] Monitor all three threads for first 24h each
- [ ] Reply to all substantive comments within 2 hours during peak hours
- [ ] Record upvote counts for each post after 72h

---

## Phase 4: KPI Measurement

- [ ] Enter best post score manually (quality gate will prompt)
- [ ] Quality gate runs at 72h, compares against threshold (25)
- [ ] If pass: track moves to done
- [ ] If miss: replanning with new community or angle
