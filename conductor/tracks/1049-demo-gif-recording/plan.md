# Track 1049: Demo GIF / Screen Recording

## Phase 1: Set up the recording environment

**Problem**: Need clean split-screen with Claude CLI + Kanban, Track 1045 staged in plan lane.
**Solution**: Start services, arrange windows, verify board.

- [ ] Task 1: Start sync worker — `lc start sync-only`
- [ ] Task 2: Start Vite dashboard — `lc ui start`, open http://localhost:8090
- [ ] Task 3: Arrange windows: Claude CLI terminal (left, ~50%) + Chrome/browser (right, ~50%)
- [ ] Task 4: Confirm Track 1045 visible in `plan` lane on Kanban
- [ ] Task 5: Open Peek → Edit → Preferences → Frame rate: 10 FPS
- [ ] Task 6: Position Peek frame to cover both windows

**Impact**: Recording environment ready.

---

## Phase 2: Record the demo

**Problem**: Need to capture human→Claude→Kanban loop in one take.
**Solution**: Follow script below. Deliberate pace — pause 2s after each Kanban transition.

**Recording script (~45–60 seconds):**

```
# 1. Open on Kanban — show Track 1045 in "plan" lane (3s pause)

# 2. Switch to Claude CLI, type:
/laneconductor brainstorm 1045
# → Claude asks a clarifying question about the bug flow
# → Kanban card shows "Waiting for reply"
# (pause 2s on the card)

# 3. Type answer to Claude's question (1–2 sentences)
# → /laneconductor plan 1045
# → Claude writes spec.md + plan.md in real-time
# → Kanban card updates to plan:success
# (pause 2s on the card)

# 4. Type:
/laneconductor implement 1045
# → Claude writes code + tests (this is the money shot)
# → Kanban card moves: plan → in-progress → review
# → Stop recording when card reaches "review"
```

- [ ] Task 1: Hit record in Peek
- [ ] Task 2: Follow the script — brainstorm → plan → implement 1045
- [ ] Task 3: Stop when implement completes and card reaches `review` lane
- [ ] Task 4: Save the file (Peek saves to `~/Videos/peek-YYYYMMDD-HHMMSS.gif`)

**Tips for a clean take:**
- Type commands slowly — viewers need to read
- 2s pause after each lane transition (that's the product selling itself)
- If implement runs long: speed up the GIF in post with ezgif.com (select "optimize" tab)
- Do a dry run first without recording to know the timing

**Impact**: Raw GIF captured — human brainstorm + Claude coding + live Kanban moves.

---

## Phase 3: Size check and compress if needed

**Problem**: GIF may exceed GitHub's 15MB inline rendering limit.
**Solution**: Check and compress with gifsicle if needed.

- [ ] Task 1: Check size: `ls -lh ~/Videos/peek-*.gif`
- [ ] Task 2: If ≤ 15MB: skip to Phase 4
- [ ] Task 3: If > 15MB — compress:
  ```bash
  sudo apt install gifsicle
  gifsicle --optimize=3 --lossy=80 ~/Videos/peek-*.gif -o docs/demo.gif
  ```
- [ ] Task 4: Or trim: re-record focusing on plan → implement only (skip brainstorm)
- [ ] Task 5: Tell Claude the file path

**Impact**: File is ≤ 15MB and ready to commit.

---

## Phase 4: Commit and embed in README

**Problem**: GIF needs to be in the repo and embedded in README.
**Solution**: Claude handles copy, commit, and README edit.

- [ ] Task 1: `cp ~/Videos/peek-YYYYMMDD.gif docs/demo.gif`
- [ ] Task 2: Add to README below hero image:
  ```markdown
  ![Demo: plan → implement in Claude CLI](docs/demo.gif)
  ```
- [ ] Task 3: Commit: `docs(track-1049): add demo GIF — Claude CLI → Kanban workflow`
- [ ] Task 4: Push to GitHub
- [ ] Task 5: Verify GIF renders on github.com/meller/laneconductor

**Impact**: README shows live workflow demo — strongest conversion asset for all launch channels.

