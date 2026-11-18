# Tests: Track 10135

In connector/test/done-lane-truth.test.mjs (and board-page.test.mjs, whose old rule "a failure in the done lane is not an attention item" was reversed).

- [x] TC-1 default list hides done:success only; done:queue, done:failure, done:waiting stay; include_done shows all
- [x] TC-2 board: attention reasons for the three done statuses, none for done:success
- [x] TC-3 merged: merged branch true, unmerged false, no branch no field; warnings; nothing written
- [x] TC-4 KC-8 (2837 of 2849) and the whole suite stay green (439); build-plugin --check clean; strict validate x4 passes
