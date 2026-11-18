# Tests: Track 10135

- [ ] TC-1 default list hides done:success only; done:queue, done:failure, done:waiting stay; include_done shows all
- [ ] TC-2 board: attention reasons for the three done statuses, none for done:success; the page data carries them
- [ ] TC-3 check_merged: merged branch true, unmerged false, no branch no field; warning for done:success with an unmerged branch
- [ ] TC-4 KC-8 and the whole suite stay green; build-plugin --check clean
