# Tests: Track 1048 — GitHub Repo Polish

## Test Commands
```bash
# Verify hero image file exists at correct path
ls -la docs/hero.png

# Verify README references the hero image
grep -n "hero.png" README.md

# Verify Quick Start has 3 commands (rough check — count code blocks in Quick Start)
grep -A 20 "## Quick Start" README.md
```

## Test Cases

### Phase 1: Hero image committed
- [ ] TC-1: `docs/hero.png` exists in repo root — expected: file present, non-zero size
- [ ] TC-2: `git log --oneline docs/hero.png` shows a commit — expected: commit message visible

### Phase 2: README updated
- [ ] TC-3: README.md contains `![` within first 10 lines — expected: image tag present near top
- [ ] TC-4: README.md Quick Start section contains exactly 3 command lines — expected: `git clone`, `lc setup`, `lc start && lc ui`
- [ ] TC-5: `lc install` is NOT in the Quick Start critical path — expected: either removed or in optional section
- [ ] TC-6: `/laneconductor setup scaffold` appears in a separate optional section — expected: not in main Quick Start
- [ ] TC-7: README renders hero image when viewed on GitHub — expected: visual visible at github.com/meller/laneconductor

### Phase 3: GitHub metadata (manual verification)
- [ ] TC-8: github.com/meller/laneconductor shows description text below repo name
- [ ] TC-9: Website link shows laneconductor.com on the repo page
- [ ] TC-10: At least 5 topic badges visible on the repo page

## Acceptance Criteria
- [ ] Hero image visible on GitHub README without clicking anything
- [ ] Quick Start is scannable in under 10 seconds
- [ ] GitHub repo page communicates value at a glance (description + website + topics)
