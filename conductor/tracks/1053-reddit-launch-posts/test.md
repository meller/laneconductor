# Tests: Track 1053 — Reddit Launch Posts

## Test Commands

Since this is a content/marketing track, tests are manual quality gates rather than automated scripts. However, we can verify certain aspects programmatically.

```bash
# Validate links in drafts (requires curl)
curl -I https://github.com/asafmeller/laneconductor
curl -I https://imgur.com/<gid>  # after hosting demo GIF

# Spell-check (requires aspell or similar)
aspell -c <draft-file>.txt

# Link validator (requires linkchecker or similar)
linkchecker --check-extern <draft-file>.md
```

## Test Cases

### Feature: Phase 1 — r/LocalLLaMA Post

**TC-1**: Post clearly states the problem (managing AI agents across repos is hard)
- **Expected**: First paragraph contains explicit problem statement
- **Acceptance**: "Problem" or "Challenge" keyword appears in first 2 sentences

**TC-2**: Post emphasizes local-first / no-cloud value
- **Expected**: Post mentions "local," "air-gapped," or "no cloud" at least twice
- **Acceptance**: Value prop is clear without reading the full GitHub

**TC-3**: Post includes demo visual (GIF or screenshot)
- **Expected**: Imgur/image link in post body
- **Acceptance**: Link is not broken (returns 200 OK)

**TC-4**: Post has clear call-to-action
- **Expected**: Ends with a question or invitation to discuss
- **Acceptance**: "What," "How," "Tell us," or similar CTA present

**TC-5**: Post links to GitHub
- **Expected**: GitHub URL is included
- **Acceptance**: Link is functional (no 404)

---

### Feature: Phase 2 — r/ClaudeAI Post

**TC-6**: Post clearly states the problem (Claude Code agents are hard to track across projects)
- **Expected**: Problem statement visible in first 2 sentences
- **Acceptance**: "Difficult," "challenge," "track," or "visibility" keyword present

**TC-7**: Post emphasizes Claude Code integration
- **Expected**: "Claude Code" mentioned at least twice
- **Acceptance**: Integration benefit is explicit (not generic AI tool mention)

**TC-8**: Post includes demo visual (GIF or screenshot)
- **Expected**: Imgur/image link showing Claude Code + Kanban dashboard
- **Acceptance**: Link is not broken (returns 200 OK)

**TC-9**: Post has clear call-to-action
- **Expected**: Ends with a question relevant to Claude Code users
- **Acceptance**: "How do you currently track," "What's your workflow," etc.

**TC-10**: Post links to GitHub + quick setup
- **Expected**: GitHub URL + setup command (e.g., `lc setup`) mentioned
- **Acceptance**: Commands are copy-paste ready (no typos)

---

### Feature: Phase 3 — r/SideProject Post

**TC-11**: Post tells a compelling story (why you built it)
- **Expected**: Post opens with "I built this" or "I ran into this problem"
- **Acceptance**: Personal voice / builder story is evident

**TC-12**: Post clearly states the solution (local Kanban, syncs with terminal)
- **Expected**: Post mentions Kanban, terminal, or dashboard
- **Acceptance**: Visual/functional benefits are clear

**TC-13**: Post includes demo visual (terminal + Kanban side-by-side)
- **Expected**: Imgur/image link showing both interfaces
- **Acceptance**: Link is not broken (returns 200 OK)

**TC-14**: Post emphasizes open-source / free / no sign-up
- **Expected**: "Open source," "free," "no sign-up," or "localhost" mentioned
- **Acceptance**: Indie builder / DIY appeal is clear

**TC-15**: Post has clear call-to-action for builders
- **Expected**: Ends with a question about ideal features or use cases
- **Acceptance**: Invites discussion without sounding salesy

---

### Feature: Phase 4 — Finalize & Schedule

**TC-16**: All three posts use consistent tone and messaging
- **Expected**: Each post has similar vocabulary, problem framing, CTA style
- **Acceptance**: Blind reader can tell they're from the same product

**TC-17**: Posts are scheduled for launch week (confirmed with Track 1052)
- **Expected**: Posting dates documented in conversation.md (not earlier, not later)
- **Acceptance**: Dates are within 7 days of HN launch

**TC-18**: Response plan is documented
- **Expected**: conversation.md contains anticipated Q&A, response templates, SLA
- **Acceptance**: Response plan covers all three subreddits separately

**TC-19**: All demo links (GIFs, GitHub, setup commands) are working
- **Expected**: No 404s, no broken Imgur links, no typos in commands
- **Acceptance**: Each link tested and verified 200 OK (or command runs without error)

**TC-20**: Final proof-read is complete (zero typos, zero broken links)
- **Expected**: Human review confirms all posts are ready to publish
- **Acceptance**: Thumbs-up from co-founder in conversation.md

---

## Acceptance Criteria Summary
✅ All 20 test cases must pass before moving to Implementation (Phase 4)
✅ Each post must be approved in writing via conversation.md
✅ Demo GIFs hosted and links validated
✅ Posting schedule confirmed and SLA documented
