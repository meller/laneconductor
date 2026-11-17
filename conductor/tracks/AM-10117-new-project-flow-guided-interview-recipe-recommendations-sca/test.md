# Tests: Track 10117

- [ ] TC-1: The scaffold fixture: from a recorded set of interview answers the generator writes product.md, tech-stack.md, workflow.json, quality-gate.md (only existing commands), .laneconductor.json (no database key), .gitignore (conversation.md ignored), tracks/, and the first tracks (one per chosen recipe plus the walking skeleton)
- [ ] TC-2: Recipe matching: fixture recipes with different `metadata.stack` rank in the expected order for a given set of answers; at most five are shown; a recipe with a changed reference carries a freshness warning
- [ ] TC-3: Both libraries are read in the documented order; with no library the flow reports it and completes
- [ ] TC-4: Privacy gate: a fixture recipe with a fake secret, an email, a phone number, or a denied private name is refused; a clean one passes
- [ ] TC-5: Two fixture recipes writing the same path produce a conflict report, never a silent merge
- [ ] TC-6: `add-recipe` fixture: the checker result is shown, nothing is saved without approval, the save is a local commit and is never pushed
- [ ] TC-7: The recipes folder inside the skill is not registered as separate skills (plugin details inventory unchanged) and the always-on token estimate does not grow
- [ ] TC-8: `claude plugin validate --strict`, size limits, lean profile test still pass
- [ ] TC-9 (HUMAN): a real new-project run on a scratch project; recommendations judged right or wrong; recorded in plan Phase 4
