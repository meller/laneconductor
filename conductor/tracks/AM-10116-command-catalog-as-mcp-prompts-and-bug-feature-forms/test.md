# Tests: Track 10116

- [ ] TC-1: create_track bug: spec has Problem Statement with the text unchanged, then Symptom, Steps to reproduce, Expected result, Actual result, Suspected area, Environment in that order; test.md case 1 is the regression test
- [ ] TC-2: create_track feature: spec has The need, Who it is for, Wanted outcome, Acceptance criteria, Out of scope; no kind: generic skeleton byte-identical to today
- [ ] TC-3: prompts/list returns every catalog command and `help`; prompts/get substitutes arguments; a missing required argument is an error naming the argument
- [ ] TC-4: the catalog and the skill routing table agree (coverage test); one plugin command file and one prompt per entry; no hand-written command file remains
- [ ] TC-5: no Claude-specific string (plugin prefix, subagent names) in the catalog or in prompt output
- [ ] TC-6: lean plugin directory emulation, add-on, `claude plugin validate --strict` on both plugins and the marketplace
- [ ] TC-7 (HUMAN): real client shows the prompts; a bug created from `/laneconductor:bug` has the form
- [ ] TC-8: every tool description contains at least one `Example:` line; the `help` tool lists every catalog command with an example phrase; all tools, including help, carry the four annotation hints; KC-8 estimate recorded
- [ ] TC-9: the generated plugin has commands help, show-board, refresh-board with descriptions and argument hints; show-board text forbids regenerating; refresh-board text names the stored URL and asks before creating; help text lists every command exactly once and the optional-plugin note
