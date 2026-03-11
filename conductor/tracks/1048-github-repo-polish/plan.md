# Track 1048: GitHub Repo Polish

## Phase 1: Copy hero image and commit to docs/

**Problem**: README has no visual. hero.png exists at ui/public/hero.png but needs to be at a stable, publicly accessible path in the repo.
**Solution**: Copy hero.png to docs/hero.png, commit it, so it can be referenced in the README via a relative path that GitHub renders.

- [x] Task 1: Create `docs/` directory at repo root
- [x] Task 2: Copy `ui/public/hero.png` → `docs/hero.png`
- [x] Task 3: Commit with `docs(track-1048): add hero image for README`

**Impact**: Hero image is available at a stable path for README embedding.

---

## Phase 2: Update README — hero image + Quick Start rewrite

**Problem**: README is pure text; Quick Start is 4 steps with sub-bullets making it feel heavy.
**Solution**: Embed hero image below H1, rewrite Quick Start to 3 commands, move optional scaffold step to its own section.

- [x] Task 1: Add hero image below the H1 heading
- [x] Task 2: Rewrite Quick Start to 3 commands
- [x] Task 3: Move `/laneconductor setup scaffold` to optional "AI Context" section after Quick Start
- [x] Task 4: Rename "Ralph Wiggum Loop" → plain pipeline description
- [x] Task 5: Added "Works with Claude Code" + "Works with Gemini CLI" badges
- [x] Task 6: Commit pushed

**Impact**: README now converts — first impression is visual, install path is clear.

---

## Phase 3: GitHub repo metadata (manual step)

**Problem**: Repo shows no description, no website, no topics on github.com/meller/laneconductor.
**Solution**: Update via GitHub UI — Settings gear on the repo page.

- [ ] Task 1: Go to github.com/meller/laneconductor → click gear icon (About section, top right)
- [ ] Task 2: Set Description: `Local-first control plane for multi-agent AI development — Claude + Gemini with a live Kanban dashboard`
- [ ] Task 3: Set Website: `https://laneconductor.com`
- [ ] Task 4: Add Topics: `claude`, `gemini`, `ai-agents`, `developer-tools`, `kanban`, `local-first`, `llm`, `cli`
- [ ] Task 5: Verify the repo page shows description + website + topics

## ✅ COMPLETE

**Impact**: GitHub repo page communicates value on first glance. Topics make it discoverable in GitHub search.
