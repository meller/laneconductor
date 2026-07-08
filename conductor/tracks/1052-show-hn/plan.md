# Track 1052: Show HN Post

## Phase 1: Strategy (complete)

**Problem**: HN audience is technical and skeptical — needs the right angle.
**Solution**: Lead with architecture/problem, not product name or AI hype.

- [x] Task 1: Identify best HN angle (filesystem-as-API + context-driven dev)
- [x] Task 2: Define what to avoid (marketing language, AI hype, cross-links)
- [x] Task 3: Identify optimal post time (7–9am Pacific)

**Impact**: Clear brief for writing the post.

---

## Phase 2: Write the post (complete)

**Problem**: Need a title + body that passes HN's technical bar.
**Solution**: Title leads with the problem. Body explains the architecture pattern. Short, honest, no hype.

- [x] Task 1: Draft 3 title options, pick best
- [x] Task 2: Write body (2–3 paragraphs max)
- [x] Task 3: Human reviews and approves

**Impact**: Post draft ready to submit.

---

## Phase 3: Submit (complete)

**Problem**: Need to find the right time and submit correctly.
**Solution**: Submit at https://news.ycombinator.com/submit — link to GitHub, paste body as text.

- [x] Task 1: Go to https://news.ycombinator.com/submit
- [x] Task 2: Paste title and URL (https://github.com/meller/laneconductor)
- [x] Task 3: Paste body in text field
- [x] Task 4: Submit and save the HN post URL

**Impact**: Post live on HN.

---

## Phase 4: Engage with comments

- [ ] Task 1: Check comments every 30 minutes for first 2 hours
- [ ] Task 2: Reply to all technical questions with honest, direct answers
- [ ] Task 3: Don't be defensive — HN criticism is valuable signal
- [ ] Task 4: Record upvote + comment count after 24 hours

---

## Phase 5: Replan — New post with meta angle

**Problem**: First post scored 1 (threshold 50). Title violated REQ-1 (product name + marketing language).
**Solution**: New post leading with the honest failure + closed-loop architecture. The repost IS the demo.

- [ ] Task 1: Review and approve new title + body in spec.md
- [ ] Task 2: Update item_id in spec.md KPI block after posting
- [ ] Task 3: Submit new post at 7–9am Pacific (Tue–Thu)
- [ ] Task 4: Reply "done" in conversation to trigger quality-gate schedule
- [ ] Task 5: Engage with comments for first 2 hours

**Impact**: Second attempt with architecture-first angle — measures against same threshold (50).

---

## ❌ KPI MISS — 2026-05-06T21:48:56.445Z
**Target**: 100 | **Actual**: 1 | **Delta**: -99 | **Threshold**: 50 | **Window**: 48h
**Snapshot**: `{"score":1,"descendants":1,"title":"LaneConductor – Gemini conductor and Claude Code superpowers meets on Kanban"}`

**Diagnosis**: Title led with product name + "superpowers" — violated HN spec (REQ-1). Post framing was "multi-agent origin story" angle (Gemini + Claude + OpenClaw) which reads as marketing, not technical architecture. The updated positioning ("AI orchestration for whole business") wasn't used. New attempt must lead with the concrete technical problem or architecture, not the product story.

**Hypothesis for replan**: Lead with the filesystem-as-API architecture pattern. HN audiences respond to "here's an unusual technical constraint I built around." Try angle: "I built a Kanban board where the source of truth is Markdown files, not a database — here's why."
