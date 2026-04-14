# Tests: Track 1050 — Gemini CLI Discussion Repost

## Test Cases

### Phase 1: Post Quality
- [ ] TC-1: First paragraph contains no feature list — expected: story/problem hook only
- [ ] TC-2: Demo GIF URL is valid — expected: `curl -I` on the raw URL returns 200
- [ ] TC-3: Install block has exactly 3 commands — expected: git clone, lc setup, lc start && lc ui
- [ ] TC-4: Gemini CLI conductor format mentioned — expected: phrase present in post body
- [ ] TC-5: GitHub link present — expected: github.com/meller/laneconductor in post

### Phase 2: Post Live
- [ ] TC-6: Post is in "Show and tell" category (not "Ideas") — expected: category label visible
- [ ] TC-7: GIF renders inline in post preview — expected: animated image visible before submitting
- [ ] TC-8: Post URL is accessible — expected: discussion URL returns 200

### Phase 3: Engagement
- [ ] TC-9: At least 1 reaction or reply within 24 hours — success signal
- [ ] TC-10: All replies answered within 2 hours — expected: no unanswered comments

## Acceptance Criteria
- [ ] Post live in correct category
- [ ] GIF visible inline
- [ ] Story hook in first paragraph (no feature list)
- [ ] 3-command install block correct
- [ ] GitHub link present
