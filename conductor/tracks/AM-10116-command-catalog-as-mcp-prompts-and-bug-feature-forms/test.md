# Tests: Track 10116

- [x] TC-1: create_track bug: spec has Problem Statement with the text unchanged, then Symptom, Steps to reproduce, Expected result, Actual result, Suspected area, Environment in that order; test.md case 1 is the regression test
- [x] TC-2: create_track feature: spec has The need, Who it is for, Wanted outcome, Acceptance criteria, Out of scope; no kind: generic skeleton byte-identical to today
- [x] TC-3: prompts/list returns every catalog command and `help`; prompts/get substitutes arguments; a missing required argument is an error naming the argument
- [x] TC-4: the catalog and the skill routing table agree (coverage test); one plugin command file and one prompt per entry; no hand-written command file remains
- [x] TC-5: no Claude-specific string (plugin prefix, subagent names) in the catalog or in prompt output
- [x] TC-6: lean profile directory emulation (built into a temp dir), full-plugin test, `claude plugin validate --strict` on the plugin and the marketplace
- [ ] TC-7 (HUMAN): real client shows the prompts; a bug created from `/laneconductor:bug` has the form
- [x] TC-8: every tool description contains at least one `Example:` line; the `help` tool lists every catalog command with an example phrase; all tools, including help, carry the four annotation hints; KC-8 estimate recorded (2478 -> 2803 tokens, +13.1%, limit 15%)
- [x] TC-9: the generated plugin has commands help, show-board, refresh-board with descriptions; show-board text forbids regenerating; refresh-board text names the stored URL and asks before creating; help text lists every command once and the note on `lc` (show-board and refresh-board have no argument, so no argument-hint)

Verified 2026-11-17 by the lead: npm test 251/251, build-plugin --check, claude plugin validate --strict (plugin and marketplace), stdio client: 21 prompts, missing-argument error names the arguments, help tool works in a non-LaneConductor folder and writes nothing, 9 tools all with Example and annotations.
