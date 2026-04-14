# Tests: Track 1049 — Demo GIF Recording

## Test Commands
```bash
# Verify GIF exists and is non-zero
ls -lh docs/demo.gif

# Check file size is under 15MB
du -sh docs/demo.gif

# Verify README references the GIF
grep -n "demo.gif" README.md
```

## Test Cases

### Phase 3: File Export
- [ ] TC-1: `docs/demo.gif` exists at repo root — expected: file present, non-zero size
- [ ] TC-2: File size ≤ 15MB — expected: GitHub renders GIFs up to 15MB inline
- [ ] TC-3: GIF is playable — expected: opens in image viewer and animates

### Phase 4: README Embed
- [ ] TC-4: README contains `docs/demo.gif` reference — expected: grep returns a match
- [ ] TC-5: GIF renders on GitHub — expected: visible animated image on repo page

## Acceptance Criteria
- [ ] `docs/demo.gif` committed and pushed
- [ ] README embeds the GIF below the hero image
- [ ] GIF shows at minimum: terminal + Kanban side by side, some state change visible
- [ ] File is ≤ 15MB
