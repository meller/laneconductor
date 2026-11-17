# brainstorm: `/laneconductor brainstorm N`

An optional deepening step before implement: ask the human clarifying questions through
`conversation.md`. It is not a lane and can run at any time. `lc brainstorm N` writes the first
trigger and sets `**Waiting for reply**: yes` for you.

1. **Load context.** On `FRESH_SESSION: false` read only `conversation.md` (you need the latest
   human reply; every question-answer round after the first is normally a resumed session).
   Otherwise read `conductor/product.md`, `tech-stack.md`, `deployment-stack.md` (if present), and
   the track's `spec.md`, `plan.md`, `test.md` and `conversation.md`.
2. **Ask one question**, appended to `conversation.md`:
   ```
   > **system**: Brainstorm requested. [Your question here]
   ```
   One question per message: several at once get partial answers.
3. Set `**Waiting for reply**: yes` in `index.md`, then stop and wait for the human's reply in
   `conversation.md` (or the UI inbox).
4. On a reply, ask the next question. Repeat.
5. When the requirements are unambiguous, the acceptance criteria are clear and every phase
   implies at least one test case (or the human says "go ahead"), run the plan lane on the
   track: it reads `conversation.md` and updates `spec.md`, `plan.md` and `test.md` from the dialogue.
