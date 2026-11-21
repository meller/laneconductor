# Tests: AM-10155

## Test Commands
- 
> lc-connector@1.9.16 test
> node --test "test/*.test.mjs"

TAP version 13
# Subtest: laneconductor-parallel ships the connector, the scaffold script, the guides and the track-runner; every import resolves inside it; no slash commands
ok 1 - laneconductor-parallel ships the connector, the scaffold script, the guides and the track-runner; every import resolves inside it; no slash commands
  ---
  duration_ms: 5.041229
  type: 'test'
  ...
# Subtest: laneconductor-board ships the script and its page, imports no npm package, and has no package files or connector
ok 2 - laneconductor-board ships the script and its page, imports no npm package, and has no package files or connector
  ---
  duration_ms: 2.101684
  type: 'test'
  ...
# Subtest: the board script runs from a temp copy of the board add-on ALONE (no node_modules, no connector) and produces board.html and board.json
ok 3 - the board script runs from a temp copy of the board add-on ALONE (no node_modules, no connector) and produces board.html and board.json
  ---
  duration_ms: 272.443208
  type: 'test'
  ...
# Subtest: every call appends a call line, get_context lane appends a serve line, and all lines are valid v1 lines
ok 4 - every call appends a call line, get_context lane appends a serve line, and all lines are valid v1 lines
  ---
  duration_ms: 508.776814
  type: 'test'
  ...
# Subtest: failures: CONFLICT is a conflict line (not a tool_error), other errors are tool_error with the code only; stale reads and empty results are logged
ok 5 - failures: CONFLICT is a conflict line (not a tool_error), other errors are tool_error with the code only; stale reads and empty results are logged
  ---
  duration_ms: 945.106063
  type: 'test'
  ...
# Subtest: log lines contain no file contents or error text: a sentinel in spec.md and in a bad argument never reaches the log
ok 6 - log lines contain no file contents or error text: a sentinel in spec.md and in a bad argument never reaches the log
  ---
  duration_ms: 561.838776
  type: 'test'
  ...
# Subtest: report_outcome: deviated and failed need a reason, followed does not; an unknown serve_id is recorded as an orphan with a warning
ok 7 - report_outcome: deviated and failed need a reason, followed does not; an unknown serve_id is recorded as an orphan with a warning
  ---
  duration_ms: 579.780423
  type: 'test'
  ...
# Subtest: local batching (D3-a): log lines appear in the working tree at once, no commit is made for them alone, and the next connector commit carries them
ok 8 - local batching (D3-a): log lines appear in the working tree at once, no commit is made for them alone, and the next connector commit carries them
  ---
  duration_ms: 629.592391
  type: 'test'
  ...
# Subtest: a repo without conductor/tracks gets no advice-log directory
ok 9 - a repo without conductor/tracks gets no advice-log directory
  ---
  duration_ms: 400.246862
  type: 'test'
  ...
# Subtest: health_report on a synthetic log: KC-2 6% breach with conflicts excluded, KC-3 75% insufficient (n=8) with the item flagged, KC-4 80%
ok 10 - health_report on a synthetic log: KC-2 6% breach with conflicts excluded, KC-3 75% insufficient (n=8) with the item flagged, KC-4 80%
  ---
  duration_ms: 395.012874
  type: 'test'
  ...
# Subtest: health_report with an empty log: nothing fails, every log-based criterion is insufficient_data, KC-8 is measured from the static tool list
ok 11 - health_report with an empty log: nothing fails, every log-based criterion is insufficient_data, KC-8 is measured from the static tool list
  ---
  duration_ms: 392.185888
  type: 'test'
  ...
# Subtest: health_report: the window starts at beta_start, errors above 3 in one session breach KC-2 regardless of volume, a closed window with no remote sessions breaches KC-6
ok 12 - health_report: the window starts at beta_start, errors above 3 in one session breach KC-2 regardless of volume, a closed window with no remote sessions breaches KC-6
  ---
  duration_ms: 361.652331
  type: 'test'
  ...
# Subtest: health_report: a malformed beta.json and log lines are reported as warnings, not failures
ok 13 - health_report: a malformed beta.json and log lines are reported as warnings, not failures
  ---
  duration_ms: 372.400088
  type: 'test'
  ...
# Subtest: health_report lists tracks needing attention from the summary lint
ok 14 - health_report lists tracks needing attention from the summary lint
  ---
  duration_ms: 378.846824
  type: 'test'
  ...
# Subtest: kill criteria: thresholds as data, remote sessions and remote stale reads, KC-3 breach and warn, per-item flag boundary
ok 15 - kill criteria: thresholds as data, remote sessions and remote stale reads, KC-3 breach and warn, per-item flag boundary
  ---
  duration_ms: 3.223749
  type: 'test'
  ...
# Subtest: computeHealth: remote reads and sessions come from backend=github lines; outcomes for unknown serves land under (orphan)
ok 16 - computeHealth: remote reads and sessions come from backend=github lines; outcomes for unknown serves land under (orphan)
  ---
  duration_ms: 0.919516
  type: 'test'
  ...
# Subtest: parseBeta: valid, absent, bad JSON, bad times and an end before the start
ok 17 - parseBeta: valid, absent, bad JSON, bad times and an end before the start
  ---
  duration_ms: 2.771911
  type: 'test'
  ...
# Subtest: no file of the committed base plugin mentions make install, the rc file, a worker, collection or the daemon
ok 18 - no file of the committed base plugin mentions make install, the rc file, a worker, collection or the daemon
  ---
  duration_ms: 8.602491
  type: 'test'
  ...
# Subtest: the same holds for what the generator builds in memory
ok 19 - the same holds for what the generator builds in memory
  ---
  duration_ms: 38.048601
  type: 'test'
  ...
# Subtest: the daemon-era setup text lives only under legacy/, which the plugin does not ship
ok 20 - the daemon-era setup text lives only under legacy/, which the plugin does not ship
  ---
  duration_ms: 1.517918
  type: 'test'
  ...
# Subtest: the generated /laneconductor:setup command carries the file rules of new-project; `scaffold` goes straight to scaffold.md; the starter set is in new-project only (release 1.9.5: setup ends with the board and the first track)
ok 21 - the generated /laneconductor:setup command carries the file rules of new-project; `scaffold` goes straight to scaffold.md; the starter set is in new-project only (release 1.9.5: setup ends with the board and the first track)
  ---
  duration_ms: 0.41035
  type: 'test'
  ...
# Subtest: B-c: two local state commits that were never pushed make a read say possibly_stale with unpushed_local_commits
ok 22 - B-c: two local state commits that were never pushed make a read say possibly_stale with unpushed_local_commits
  ---
  duration_ms: 1126.493701
  type: 'test'
  ...
# Subtest: B-d: two sessions edit plan.md from the same base; the second gets CONFLICT and the file holds the first edit byte for byte
ok 23 - B-d: two sessions edit plan.md from the same base; the second gets CONFLICT and the file holds the first edit byte for byte
  ---
  duration_ms: 1104.481822
  type: 'test'
  ...
# Subtest: B-d: simultaneous writers from one base, repeated: exactly one wins every round and the file is the winner's
ok 24 - B-d: simultaneous writers from one base, repeated: exactly one wins every round and the file is the winner's
  ---
  duration_ms: 1912.849105
  type: 'test'
  ...
# Subtest: B-e: the whole local flow works with no database and no daemon: unreachable Postgres settings, no sockets, no DB or network code in the connector
ok 25 - B-e: the whole local flow works with no database and no daemon: unreachable Postgres settings, no sockets, no DB or network code in the connector
  ---
  duration_ms: 858.519571
  type: 'test'
  ...
# Subtest: blobSha equals git hash-object for ascii
ok 26 - blobSha equals git hash-object for ascii
  ---
  duration_ms: 8.970551
  type: 'test'
  ...
# Subtest: blobSha equals git hash-object for utf-8 multibyte
ok 27 - blobSha equals git hash-object for utf-8 multibyte
  ---
  duration_ms: 2.975924
  type: 'test'
  ...
# Subtest: blobSha equals git hash-object for empty
ok 28 - blobSha equals git hash-object for empty
  ---
  duration_ms: 3.619221
  type: 'test'
  ...
# Subtest: blobSha equals git hash-object for crlf
ok 29 - blobSha equals git hash-object for crlf
  ---
  duration_ms: 4.7753
  type: 'test'
  ...
# Subtest: blobSha accepts a Buffer and hashes its bytes
ok 30 - blobSha accepts a Buffer and hashes its bytes
  ---
  duration_ms: 4.252509
  type: 'test'
  ...
# Subtest: the lane commands: queue and success go to the next lane command, with a short reason
ok 31 - the lane commands: queue and success go to the next lane command, with a short reason
  ---
  duration_ms: 8.001954
  type: 'test'
  ...
# Subtest: the resolver names the next lane: a workflow that moves plan straight to review makes plan:success a review step
ok 32 - the resolver names the next lane: a workflow that moves plan straight to review makes plan:success a review step
  ---
  duration_ms: 1.286174
  type: 'test'
  ...
# Subtest: the project lane names are used: planning and in-progress map to the plan and implement commands
ok 33 - the project lane names are used: planning and in-progress map to the plan and implement commands
  ---
  duration_ms: 1.759882
  type: 'test'
  ...
# Subtest: running: nothing to do; a stale claim says how to release it with the project lane name
ok 34 - running: nothing to do; a stale claim says how to release it with the project lane name
  ---
  duration_ms: 4.2
  type: 'test'
  ...
# Subtest: a human reply is waiting: any lane, the comment command with a placeholder
ok 35 - a human reply is waiting: any lane, the comment command with a placeholder
  ---
  duration_ms: 1.584312
  type: 'test'
  ...
# Subtest: dependencies: blocked names the numbers and has no command; ready to resume is a move to queue
ok 36 - dependencies: blocked names the numbers and has no command; ready to resume is a move to queue
  ---
  duration_ms: 1.532726
  type: 'test'
  ...
# Subtest: failure: the build is retried, a failed plan or gate is replanned, a failed merge is merged again
ok 37 - failure: the build is retried, a failed plan or gate is replanned, a failed merge is merged again
  ---
  duration_ms: 1.319155
  type: 'test'
  ...
# Subtest: backlog is parked with no command; a PR waiting in done is recorded once merged; an unknown lane says nothing
ok 38 - backlog is parked with no command; a PR waiting in done is recorded once merged; an unknown lane says nothing
  ---
  duration_ms: 1.725919
  type: 'test'
  ...
# Subtest: actionOf is pure and tolerates odd rows
ok 39 - actionOf is pure and tolerates odd rows
  ---
  duration_ms: 0.488195
  type: 'test'
  ...
# Subtest: buildBoard: the action is on live tracks and their attention rows, never on archived copies; boardPageData carries it as x
ok 40 - buildBoard: the action is on live tracks and their attention rows, never on archived copies; boardPageData carries it as x
  ---
  duration_ms: 2.50538
  type: 'test'
  ...
# Subtest: the action comes from the track's own markers only: no Problem, Summary or title text reaches it
ok 41 - the action comes from the track's own markers only: no Problem, Summary or title text reaches it
  ---
  duration_ms: 5.682302
  type: 'test'
  ...
# Subtest: running: a track with a Phase says it (cut at a word, 140 characters at most); no Phase, or the placeholder New, keeps the plain wording; a stale claim is unchanged
ok 42 - running: a track with a Phase says it (cut at a word, 140 characters at most); no Phase, or the placeholder New, keeps the plain wording; a stale claim is unchanged
  ---
  duration_ms: 2.841761
  type: 'test'
  ...
# Subtest: the catalog has board and no show-board or refresh-board; board takes the one argument refresh
ok 43 - the catalog has board and no show-board or refresh-board; board takes the one argument refresh
  ---
  duration_ms: 4.318162
  type: 'test'
  ...
# Subtest: help lists the board command once and the old names nowhere, in the catalog help and the help tool data
ok 44 - help lists the board command once and the old names nowhere, in the catalog help and the help tool data
  ---
  duration_ms: 0.632467
  type: 'test'
  ...
# Subtest: the base plugin ships board.md only: no command file for the old names, none of their text anywhere in the shipped plugins
ok 45 - the base plugin ships board.md only: no command file for the old names, none of their text anywhere in the shipped plugins
  ---
  duration_ms: 19.300594
  type: 'test'
  ...
# Subtest: the board command text: opens by default, refreshes with the argument, suggests refresh after an hour, asks before creating, only Claude publishes
ok 46 - the board command text: opens by default, refreshes with the argument, suggests refresh after an hour, asks before creating, only Claude publishes
  ---
  duration_ms: 0.512872
  type: 'test'
  ...
# Subtest: the shipped skill and help say the same: board opens, board refresh rebuilds; the routing table keeps the plain-words names
ok 47 - the shipped skill and help say the same: board opens, board refresh rebuilds; the routing table keeps the plain-words names
  ---
  duration_ms: 2.308131
  type: 'test'
  ...
# Subtest: the MCP prompts: one board prompt that fills the argument, none for the old names
ok 48 - the MCP prompts: one board prompt that fills the argument, none for the old names
  ---
  duration_ms: 332.448897
  type: 'test'
  ...
# Subtest: docs: written for live tracks that are not done, with the documented shape
ok 49 - docs: written for live tracks that are not done, with the documented shape
  ---
  duration_ms: 260.64973
  type: 'test'
  ...
# Subtest: docs: a missing file is an empty string, not an error
ok 50 - docs: a missing file is an empty string, not an error
  ---
  duration_ms: 252.88922
  type: 'test'
  ...
# Subtest: conversation: absent by default, present only with board.include_conversation: true
ok 51 - conversation: absent by default, present only with board.include_conversation: true
  ---
  duration_ms: 851.127579
  type: 'test'
  ...
# Subtest: conversation: goes through the scan; a match withholds just that conversation
ok 52 - conversation: goes through the scan; a match withholds just that conversation
  ---
  duration_ms: 265.721079
  type: 'test'
  ...
# Subtest: board.include_docs: false writes no docs/ and every d is false
ok 53 - board.include_docs: false writes no docs/ and every d is false
  ---
  duration_ms: 299.310627
  type: 'test'
  ...
# Subtest: privacy: a spec with a fake secret is withheld (field omitted, reason recorded); the plan is still embedded; the secret is written nowhere
ok 54 - privacy: a spec with a fake secret is withheld (field omitted, reason recorded); the plan is still embedded; the secret is written nowhere
  ---
  duration_ms: 254.548477
  type: 'test'
  ...
# Subtest: truncation: a file over 60,000 characters is cut with a visible note
ok 55 - truncation: a file over 60,000 characters is cut with a visible note
  ---
  duration_ms: 316.596961
  type: 'test'
  ...
# Subtest: cap: at most 200 docs files; the oldest backlog tracks are dropped first and counted in board.json
ok 56 - cap: at most 200 docs files; the oldest backlog tracks are dropped first and counted in board.json
  ---
  duration_ms: 758.771474
  type: 'test'
  ...
# Subtest: numbers shared by two live folders get no docs (docs/<n>.json could not tell them apart); legacy folder names work
ok 57 - numbers shared by two live folders get no docs (docs/<n>.json could not tell them apart); legacy folder names work
  ---
  duration_ms: 276.416762
  type: 'test'
  ...
# Subtest: githubBase: ssh and https remotes are normalised; anything else is null
ok 58 - githubBase: ssh and https remotes are normalised; anything else is null
  ---
  duration_ms: 1.102689
  type: 'test'
  ...
# Subtest: gh: done tracks get a GitHub folder URL from an ssh or https origin; none without a github remote
ok 59 - gh: done tracks get a GitHub folder URL from an ssh or https origin; none without a github remote
  ---
  duration_ms: 1442.709285
  type: 'test'
  ...
# Subtest: --json: stdout is exactly one { page, root, files } object; the plain two-line output is unchanged without it
ok 60 - --json: stdout is exactly one { page, root, files } object; the plain two-line output is unchanged without it
  ---
  duration_ms: 375.900776
  type: 'test'
  ...
# Subtest: --site reused: a docs file of a track that is no longer published does not survive
ok 61 - --site reused: a docs file of a track that is no longer published does not survive
  ---
  duration_ms: 497.705719
  type: 'test'
  ...
# Subtest: buildDoc: pure; a missing conversation file adds no key even when the flag is on
ok 62 - buildDoc: pure; a missing conversation file adds no key even when the flag is on
  ---
  duration_ms: 0.489108
  type: 'test'
  ...
# Subtest: chip, no connector: the age in words, never a claim of exactness, "may be out of date" only after an hour
ok 63 - chip, no connector: the age in words, never a claim of exactness, "may be out of date" only after an hour
  ---
  duration_ms: 59.492686
  type: 'test'
  ...
# Subtest: chip, connector present but the board has no commit (an older board.json): no Check now, age only, nothing read
ok 64 - chip, connector present but the board has no commit (an older board.json): no Check now, age only, nothing read
  ---
  duration_ms: 12.660955
  type: 'test'
  ...
# Subtest: connector, same commit: Check now reads list_tracks with limit 1 and the chip says Up to date
ok 65 - connector, same commit: Check now reads list_tracks with limit 1 and the chip says Up to date
  ---
  duration_ms: 12.83914
  type: 'test'
  ...
# Subtest: connector, different commit: Out of date, the repository has moved on, and Press Refresh board; no commit count is invented
ok 66 - connector, different commit: Out of date, the repository has moved on, and Press Refresh board; no commit count is invented
  ---
  duration_ms: 15.940289
  type: 'test'
  ...
# Subtest: a short or prefixed commit still compares; a later check that finds the same commit flips the chip back
ok 67 - a short or prefixed commit still compares; a later check that finds the same commit flips the chip back
  ---
  duration_ms: 24.574259
  type: 'test'
  ...
# Subtest: the first interaction checks once, automatically, and never again by itself; Check now only ever calls list_tracks
ok 68 - the first interaction checks once, automatically, and never again by itself; Check now only ever calls list_tracks
  ---
  duration_ms: 27.352572
  type: 'test'
  ...
# Subtest: the keyboard is an interaction too
ok 69 - the keyboard is an interaction too
  ---
  duration_ms: 12.562782
  type: 'test'
  ...
# Subtest: probe failure: every way the connector is unreachable falls back to the age only, silently
ok 70 - probe failure: every way the connector is unreachable falls back to the age only, silently
  ---
  duration_ms: 68.331822
  type: 'test'
  ...
# Subtest: a check that fails after the probe keeps the age and says so in a neutral line; so does a provenance it cannot compare
ok 71 - a check that fails after the probe keeps the age and says so in a neutral line; so does a provenance it cannot compare
  ---
  duration_ms: 72.569352
  type: 'test'
  ...
# Subtest: Refresh board: header and footer buttons copy /laneconductor:board refresh inside the click; the footer says only Claude can rebuild and publish
ok 72 - Refresh board: header and footer buttons copy /laneconductor:board refresh inside the click; the footer says only Claude can rebuild and publish
  ---
  duration_ms: 12.622234
  type: 'test'
  ...
# Subtest: Refresh board: a refused clipboard falls back to selecting the command; no clipboard API at all says to press Ctrl+C
ok 73 - Refresh board: a refused clipboard falls back to selecting the command; no clipboard API at all says to press Ctrl+C
  ---
  duration_ms: 28.085417
  type: 'test'
  ...
# Subtest: the Refresh button never touches the connector
ok 74 - the Refresh button never touches the connector
  ---
  duration_ms: 13.155333
  type: 'test'
  ...
# Subtest: hostile strings stay text: a hostile commit, generated_at or provenance never reaches markup or the chip
ok 75 - hostile strings stay text: a hostile commit, generated_at or provenance never reaches markup or the chip
  ---
  duration_ms: 25.505897
  type: 'test'
  ...
# Subtest: page source: no innerHTML; the page calls only get_track, update_track (Move) and list_tracks (Check now); the old refresh phrase is gone
ok 76 - page source: no innerHTML; the page calls only get_track, update_track (Move) and list_tracks (Check now); the old refresh phrase is gone
  ---
  duration_ms: 0.92172
  type: 'test'
  ...
# Subtest: board.json carries the state branch head it was built from, in full and short, next to generated_at
ok 77 - board.json carries the state branch head it was built from, in full and short, next to generated_at
  ---
  duration_ms: 218.538096
  type: 'test'
  ...
# Subtest: the commit is the state branch head even when the checkout is elsewhere, and it moves with the repository
ok 78 - the commit is the state branch head even when the checkout is elsewhere, and it moves with the repository
  ---
  duration_ms: 497.505578
  type: 'test'
  ...
# Subtest: boardPageData leaves the commit out unless it is a full hash; never copies other text
ok 79 - boardPageData leaves the commit out unless it is a full hash; never copies other text
  ---
  duration_ms: 0.854403
  type: 'test'
  ...
# Subtest: H2 a lane change by the connector sets the marker, in the plugin data directory and nowhere in the project; it prints nothing
ok 80 - H2 a lane change by the connector sets the marker, in the plugin data directory and nowhere in the project; it prints nothing
  ---
  duration_ms: 63.929893
  type: 'test'
  ...
# Subtest: H2 create_track and an outcome both set it; an update_track that changes nothing, a failed one and an unrelated tool do not
ok 81 - H2 create_track and an outcome both set it; an update_track that changes nothing, a failed one and an unrelated tool do not
  ---
  duration_ms: 432.213919
  type: 'test'
  ...
# Subtest: H2 Edit and Write of a track document set it (absolute and relative path); README, the project files, other files and no-op edits do not
ok 82 - H2 Edit and Write of a track document set it (absolute and relative path); README, the project files, other files and no-op edits do not
  ---
  duration_ms: 801.634244
  type: 'test'
  ...
# Subtest: H2 silent in a project with no conductor/tracks/ (and writes nothing, not even the data directory); garbage or empty input is silent too
ok 83 - H2 silent in a project with no conductor/tracks/ (and writes nothing, not even the data directory); garbage or empty input is silent too
  ---
  duration_ms: 674.394656
  type: 'test'
  ...
# Subtest: H3 default on, explicit off: with no auto_update key and a stored board Stop asks Claude to refresh; only an explicit false (or the string "false") keeps it silent and leaves the marker
ok 84 - H3 default on, explicit off: with no auto_update key and a stored board Stop asks Claude to refresh; only an explicit false (or the string "false") keeps it silent and leaves the marker
  ---
  duration_ms: 872.908831
  type: 'test'
  ...
# Subtest: H3 option on with the marker and a stored board: Stop asks Claude to continue once with one short instruction naming the refresh command, and clears the marker
ok 85 - H3 option on with the marker and a stored board: Stop asks Claude to continue once with one short instruction naming the refresh command, and clears the marker
  ---
  duration_ms: 182.268087
  type: 'test'
  ...
# Subtest: H3 loop guard: with stop_hook_active true the hook does nothing and keeps the marker for the next turn
ok 86 - H3 loop guard: with stop_hook_active true the hook does nothing and keeps the marker for the next turn
  ---
  duration_ms: 189.020768
  type: 'test'
  ...
# Subtest: H3 no stored board: there is nothing to refresh, so Stop is silent whatever the option says, and the marker stays; no marker is silent too
ok 87 - H3 no stored board: there is nothing to refresh, so Stop is silent whatever the option says, and the marker stays; no marker is silent too
  ---
  duration_ms: 566.676702
  type: 'test'
  ...
# Subtest: H3 .laneconductor.json missing, invalid or without a board key: silent, no crash, marker untouched
ok 88 - H3 .laneconductor.json missing, invalid or without a board key: silent, no crash, marker untouched
  ---
  duration_ms: 606.354044
  type: 'test'
  ...
# Subtest: the marker is per project (hash of the path), and without CLAUDE_PLUGIN_DATA the fallback is the system temp directory, still outside the project
ok 89 - the marker is per project (hash of the path), and without CLAUDE_PLUGIN_DATA the fallback is the system temp directory, still outside the project
  ---
  duration_ms: 164.816354
  type: 'test'
  ...
# Subtest: speed: one hook run is far under a second (the budget is 100 ms of work; node start-up is included here)
ok 90 - speed: one hook run is far under a second (the budget is 100 ms of work; node start-up is included here)
  ---
  duration_ms: 151.281589
  type: 'test'
  ...
# Subtest: the board add-on's hooks.json: the documented shape, the two events, every command path through ${CLAUDE_PLUGIN_ROOT} only, the script it names exists
ok 91 - the board add-on's hooks.json: the documented shape, the two events, every command path through ${CLAUDE_PLUGIN_ROOT} only, the script it names exists
  ---
  duration_ms: 0.817134
  type: 'test'
  ...
# Subtest: the hook script: no network, no write inside a project, and the only child process is a read-only git (rev-parse, status); the stop instruction names a command of the base plugin
ok 92 - the hook script: no network, no write inside a project, and the only child process is a read-only git (rev-parse, status); the stop instruction names a command of the base plugin
  ---
  duration_ms: 0.475492
  type: 'test'
  ...
# Subtest: the base board refresh: reads the live manifest, passes it to --previous, publishes only the publish map, full publish on first publish, conflict or failure, keeps the privacy handling
ok 93 - the base board refresh: reads the live manifest, passes it to --previous, publishes only the publish map, full publish on first publish, conflict or failure, keeps the privacy handling
  ---
  duration_ms: 0.262582
  type: 'test'
  ...
# Subtest: the BASE plugin still has no hooks: no hooks folder, no hooks key in its manifest, no hook script, and no command or file of the board add-on
ok 94 - the BASE plugin still has no hooks: no hooks folder, no hooks key in its manifest, no hook script, and no command or file of the board add-on
  ---
  duration_ms: 0.91138
  type: 'test'
  ...
# Subtest: H4 the first Stop only remembers the tracks (silent, state in the plugin data directory); a later push of a track change asks for one refresh, then stays silent
ok 95 - H4 the first Stop only remembers the tracks (silent, state in the plugin data directory); a later push of a track change asks for one refresh, then stays silent
  ---
  duration_ms: 282.468273
  type: 'test'
  ...
# Subtest: H4 an uncommitted edit of a track made without Edit or Write (a shell command) is caught; a change outside the tracks is not
ok 96 - H4 an uncommitted edit of a track made without Edit or Write (a shell command) is caught; a change outside the tracks is not
  ---
  duration_ms: 249.347898
  type: 'test'
  ...
# Subtest: H4 board.auto_update false, no stored board, a Stop that is already continuing, and a project that is not a git repository: all silent, nothing breaks
ok 97 - H4 board.auto_update false, no stored board, a Stop that is already continuing, and a project that is not a git repository: all silent, nothing breaks
  ---
  duration_ms: 937.873267
  type: 'test'
  ...
# Subtest: H4 the state branch from connector.state_branch is the one watched
ok 98 - H4 the state branch from connector.state_branch is the one watched
  ---
  duration_ms: 262.932038
  type: 'test'
  ...
# Subtest: H5 after a change was pushed, `seen` records it: the next Stop is silent, and a later change asks again
ok 99 - H5 after a change was pushed, `seen` records it: the next Stop is silent, and a later change asks again
  ---
  duration_ms: 336.348498
  type: 'test'
  ...
# Subtest: H5 `seen` clears the marker an Edit left, so the refresh that follows it is not asked for again
ok 100 - H5 `seen` clears the marker an Edit left, so the refresh that follows it is not asked for again
  ---
  duration_ms: 270.47258
  type: 'test'
  ...
# Subtest: H5 `seen` run from a shell without CLAUDE_PLUGIN_DATA still counts: the hook reads the temp fallback too, and the newest record wins
ok 101 - H5 `seen` run from a shell without CLAUDE_PLUGIN_DATA still counts: the hook reads the temp fallback too, and the newest record wins
  ---
  duration_ms: 319.229327
  type: 'test'
  ...
# Subtest: H5 `seen` in a project that is not a git repository, or with no tracks folder, prints nothing and breaks nothing
ok 102 - H5 `seen` in a project that is not a git repository, or with no tracks folder, prints nothing and breaks nothing
  ---
  duration_ms: 145.21575
  type: 'test'
  ...
# Subtest: H5 the base board refresh ends with the `seen` step, found by Glob, after a successful publish
ok 103 - H5 the base board refresh ends with the `seen` step, found by Glob, after a successful publish
  ---
  duration_ms: 0.489188
  type: 'test'
  ...
# Subtest: H6 setting a track to running in plan, implement, review or quality-gate asks for one quiet refresh at once, once per claim; the marker is still set
ok 104 - H6 setting a track to running in plan, implement, review or quality-gate asks for one quiet refresh at once, once per claim; the marker is still set
  ---
  duration_ms: 989.916462
  type: 'test'
  ...
# Subtest: H6 other lanes and statuses, an older lane name, and the connector's update_track
ok 105 - H6 other lanes and statuses, an older lane name, and the connector's update_track
  ---
  duration_ms: 461.328618
  type: 'test'
  ...
# Subtest: H6 a sub-agent, board.auto_update false and no stored board are never asked; a claim is still remembered so it does not ask later
ok 106 - H6 a sub-agent, board.auto_update false and no stored board are never asked; a claim is still remembered so it does not ask later
  ---
  duration_ms: 194.860156
  type: 'test'
  ...
# Subtest: H6 the end-of-turn instruction is quiet too, and the base board refresh reports nothing when asked quietly unless a step failed
ok 107 - H6 the end-of-turn instruction is quiet too, and the base board refresh reports nothing when asked quietly unless a step failed
  ---
  duration_ms: 171.65868
  type: 'test'
  ...
# Subtest: H7 in a git worktree the hook uses the main checkout's settings file (stored board, auto_update); with no file anywhere it stays silent
ok 108 - H7 in a git worktree the hook uses the main checkout's settings file (stored board, auto_update); with no file anywhere it stays silent
  ---
  duration_ms: 230.580973
  type: 'test'
  ...
# Subtest: the default output is unchanged: { page, root, files } with no partial-publish fields and no manifest in files; manifest.json is on disk
ok 109 - the default output is unchanged: { page, root, files } with no partial-publish fields and no manifest in files; manifest.json is on disk
  ---
  duration_ms: 447.442782
  type: 'test'
  ...
# Subtest: an unchanged board: only board.json (its generated time), manifest.json and version.json are sent; the page is unchanged
ok 110 - an unchanged board: only board.json (its generated time), manifest.json and version.json are sent; the page is unchanged
  ---
  duration_ms: 497.547288
  type: 'test'
  ...
# Subtest: one track edited: board.json, that track's document, manifest.json and version.json, nothing else
ok 111 - one track edited: board.json, that track's document, manifest.json and version.json, nothing else
  ---
  duration_ms: 508.447451
  type: 'test'
  ...
# Subtest: a track that became done: its document is removed with null, and board.json changes
ok 112 - a track that became done: its document is removed with null, and board.json changes
  ---
  duration_ms: 463.967837
  type: 'test'
  ...
# Subtest: a new track and a changed project file are changed; the page changing is reported
ok 113 - a new track and a changed project file are changed; the page changing is reported
  ---
  duration_ms: 732.664303
  type: 'test'
  ...
# Subtest: no previous manifest, a missing, corrupt, wrong-version or foreign one: mode full, every file, and the manifest in publish
ok 114 - no previous manifest, a missing, corrupt, wrong-version or foreign one: mode full, every file, and the manifest in publish
  ---
  duration_ms: 2060.545231
  type: 'test'
  ...
# Subtest: --live-board: a live board.json that is not the one the manifest describes (published by something else since) gives full; a matching one stays partial
ok 115 - --live-board: a live board.json that is not the one the manifest describes (published by something else since) gives full; a matching one stays partial
  ---
  duration_ms: 790.709798
  type: 'test'
  ...
# Subtest: privacy: a withheld document is absent from the manifest (so every later publish retries it), is still sent with its placeholder, and the secret is in no output
ok 116 - privacy: a withheld document is absent from the manifest (so every later publish retries it), is still sent with its placeholder, and the secret is in no output
  ---
  duration_ms: 964.36609
  type: 'test'
  ...
# Subtest: unit: buildManifest leaves withheld files out; parseManifest checks version, hashes and paths; planPublish rules
ok 117 - unit: buildManifest leaves withheld files out; parseManifest checks version, hashes and paths; planPublish rules
  ---
  duration_ms: 1.370602
  type: 'test'
  ...
# Subtest: version.json: a tiny index with the board's generated time, written with every site, equal to board.json's generated_at and never listed in files
ok 118 - version.json: a tiny index with the board's generated time, written with every site, equal to board.json's generated_at and never listed in files
  ---
  duration_ms: 243.380674
  type: 'test'
  ...
# Subtest: next.mjs is one implementation: it imports nothing from the test folder, writes nothing, and the old test-only classifier is gone
ok 119 - next.mjs is one implementation: it imports nothing from the test folder, writes nothing, and the old test-only classifier is gone
  ---
  duration_ms: 2.44075
  type: 'test'
  ...
# Subtest: the add-ons offered by the front door are the ones of the plugin catalog
ok 120 - the add-ons offered by the front door are the ones of the plugin catalog
  ---
  duration_ms: 1.390038
  type: 'test'
  ...
# Subtest: the primer is the six bullets of the explain primer of ops/next.md, word for word
ok 121 - the primer is the six bullets of the explain primer of ops/next.md, word for word
  ---
  duration_ms: 0.551204
  type: 'test'
  ...
# Subtest: board.json next equals the classifier output: empty folder, no conductor
ok 122 - board.json next equals the classifier output: empty folder, no conductor
  ---
  duration_ms: 212.014535
  type: 'test'
  ...
# Subtest: board.json next equals the classifier output: a folder that is not a repository
ok 123 - board.json next equals the classifier output: a folder that is not a repository
  ---
  duration_ms: 146.88422
  type: 'test'
  ...
# Subtest: board.json next equals the classifier output: a repository with history and no conductor
ok 124 - board.json next equals the classifier output: a repository with history and no conductor
  ---
  duration_ms: 897.988854
  type: 'test'
  ...
# Subtest: board.json next equals the classifier output: set up, no tracks
ok 125 - board.json next equals the classifier output: set up, no tracks
  ---
  duration_ms: 257.153703
  type: 'test'
  ...
# Subtest: board.json next equals the classifier output: a plan waits
ok 126 - board.json next equals the classifier output: a plan waits
  ---
  duration_ms: 293.835534
  type: 'test'
  ...
# Subtest: board.json next equals the classifier output: implement with a real plan
ok 127 - board.json next equals the classifier output: implement with a real plan
  ---
  duration_ms: 295.760495
  type: 'test'
  ...
# Subtest: board.json next equals the classifier output: implement with a stub plan
ok 128 - board.json next equals the classifier output: implement with a stub plan
  ---
  duration_ms: 361.561179
  type: 'test'
  ...
# Subtest: board.json next equals the classifier output: a human reply comes first
ok 129 - board.json next equals the classifier output: a human reply comes first
  ---
  duration_ms: 254.885382
  type: 'test'
  ...
# Subtest: board.json next equals the classifier output: a track is blocked, the other is next
ok 130 - board.json next equals the classifier output: a track is blocked, the other is next
  ---
  duration_ms: 318.855362
  type: 'test'
  ...
# Subtest: board.json next equals the classifier output: done:queue with an unmerged branch (merge)
ok 131 - board.json next equals the classifier output: done:queue with an unmerged branch (merge)
  ---
  duration_ms: 341.857792
  type: 'test'
  ...
# Subtest: board.json next equals the classifier output: done:queue already merged (record it)
ok 132 - board.json next equals the classifier output: done:queue already merged (record it)
  ---
  duration_ms: 394.965033
  type: 'test'
  ...
# Subtest: board.json next equals the classifier output: a stale running claim
ok 133 - board.json next equals the classifier output: a stale running claim
  ---
  duration_ms: 305.140331
  type: 'test'
  ...
# Subtest: board.json next equals the classifier output: a recent running claim is skipped
ok 134 - board.json next equals the classifier output: a recent running claim is skipped
  ---
  duration_ms: 301.766931
  type: 'test'
  ...
# Subtest: board.json next equals the classifier output: everything shipped
ok 135 - board.json next equals the classifier output: everything shipped
  ---
  duration_ms: 309.544246
  type: 'test'
  ...
# Subtest: board.json next equals the classifier output: an unreadable track
ok 136 - board.json next equals the classifier output: an unreadable track
  ---
  duration_ms: 278.502181
  type: 'test'
  ...
# Subtest: every fixture of next.test.mjs gives a board.json card with the fixture's state and command
ok 137 - every fixture of next.test.mjs gives a board.json card with the fixture's state and command
  ---
  duration_ms: 10482.544245
  type: 'test'
  ...
# Subtest: the card of the ranking fixture: the human reply first, then the rest in order, at most five, the count of the rest
ok 138 - the card of the ranking fixture: the human reply first, then the rest in order, at most five, the count of the rest
  ---
  duration_ms: 228.966689
  type: 'test'
  ...
# Subtest: a project with no tracks and no conductor folder still gets a card (the first run)
ok 139 - a project with no tracks and no conductor folder still gets a card (the first run)
  ---
  duration_ms: 88.252674
  type: 'test'
  ...
# Subtest: size caps: a project with many tracks gives at most five others and strings inside their caps
ok 140 - size caps: a project with many tracks gives at most five others and strings inside their caps
  ---
  duration_ms: 610.967684
  type: 'test'
  ...
# Subtest: the card holds commands and ids, never track titles, markers or document text
ok 141 - the card holds commands and ids, never track titles, markers or document text
  ---
  duration_ms: 154.303947
  type: 'test'
  ...
# Subtest: board.include_docs false: no documents, and the card stays
ok 142 - board.include_docs false: no documents, and the card stays
  ---
  duration_ms: 131.780243
  type: 'test'
  ...
# Subtest: a failure to work out the next step leaves the panel out and never stops the board
ok 143 - a failure to work out the next step leaves the panel out and never stops the board
  ---
  duration_ms: 73.054556
  type: 'test'
  ...
# Subtest: the card text: no daemon or lc command words, no unshipped work, no track number but the one the card is about
ok 144 - the card text: no daemon or lc command words, no unshipped work, no track number but the one the card is about
  ---
  duration_ms: 3185.245527
  type: 'test'
  ...
# Subtest: the board add-on carries the ranking and runs: its own lc-board.mjs produces the same card as the source script
ok 145 - the board add-on carries the ranking and runs: its own lc-board.mjs produces the same card as the source script
  ---
  duration_ms: 287.453359
  type: 'test'
  ...
# Subtest: page: the What's next button is hidden in the markup and with no next in board.json; shown with one, before the Project button
ok 146 - page: the What's next button is hidden in the markup and with no next in board.json; shown with one, before the Project button
  ---
  duration_ms: 26.242504
  type: 'test'
  ...
# Subtest: page: the panel shows the headline, the exact command with Copy, what, why, the other tracks and the closed primer, and says the page cannot run work
ok 147 - page: the panel shows the headline, the exact command with Copy, what, why, the other tracks and the closed primer, and says the page cannot run work
  ---
  duration_ms: 8.021482
  type: 'test'
  ...
# Subtest: page: Copy writes the command in the click, says Copied; a refused write falls back to selecting the text; no clipboard API names the keys
ok 148 - page: Copy writes the command in the click, says Copied; a refused write falls back to selecting the text; no clipboard API names the keys
  ---
  duration_ms: 31.266241
  type: 'test'
  ...
# Subtest: page: a row of Also waiting opens that track's detail drawer, and closing it returns focus to the What's next button
ok 149 - page: a row of Also waiting opens that track's detail drawer, and closing it returns focus to the What's next button
  ---
  duration_ms: 6.430076
  type: 'test'
  ...
# Subtest: page: a row for a track the board does not list shows a plain id, still with its Copy
ok 150 - page: a row for a track the board does not list shows a plain id, still with its Copy
  ---
  duration_ms: 6.113823
  type: 'test'
  ...
# Subtest: page: with no command (nothing to do or blocked) the reason is shown instead, no command and no Copy for it, and the page still says it cannot run work
ok 151 - page: with no command (nothing to do or blocked) the reason is shown instead, no command and no Copy for it, and the page still says it cannot run work
  ---
  duration_ms: 6.936978
  type: 'test'
  ...
# Subtest: page: the primer toggle opens and closes it and keeps aria-expanded true to what is shown
ok 152 - page: the primer toggle opens and closes it and keeps aria-expanded true to what is shown
  ---
  duration_ms: 7.120431
  type: 'test'
  ...
# Subtest: page: Escape closes the panel and returns focus; Tab and Shift+Tab stay inside, in reading order
ok 153 - page: Escape closes the panel and returns focus; Tab and Shift+Tab stay inside, in reading order
  ---
  duration_ms: 7.167369
  type: 'test'
  ...
# Subtest: page: hostile text in the card and in titles stays text: no element but plain ones is made, nothing is parsed
ok 154 - page: hostile text in the card and in titles stays text: no element but plain ones is made, nothing is parsed
  ---
  duration_ms: 12.855984
  type: 'test'
  ...
# Subtest: page: the panel CSS uses theme variables only, wraps at phone width and keeps keyboard focus visible; the page keeps its safe-DOM rule
ok 155 - page: the panel CSS uses theme variables only, wraps at phone width and keeps keyboard focus visible; the page keeps its safe-DOM rule
  ---
  duration_ms: 0.994797
  type: 'test'
  ...
# Subtest: next ranking: an active-KPI track first, then tracks naming no KPI (or none listed), then tracks serving only non-active KPIs; without kpis.md the order is the old one
ok 156 - next ranking: an active-KPI track first, then tracks naming no KPI (or none listed), then tracks serving only non-active KPIs; without kpis.md the order is the old one
  ---
  duration_ms: 317.229406
  type: 'test'
  ...
# Subtest: TC-12 data: board.json carries oa, od, rs, kc only for the tracks that have them, and an old project has none of the keys
ok 157 - TC-12 data: board.json carries oa, od, rs, kc only for the tracks that have them, and an old project has none of the keys
  ---
  duration_ms: 8.123382
  type: 'test'
  ...
# Subtest: TC-12 data: the due date is published as written (a stray space stays, so the page can say why it is not a date); the texts are one line and short
ok 158 - TC-12 data: the due date is published as written (a stray space stays, so the page can say why it is not a date); the texts are one line and short
  ---
  duration_ms: 1.981638
  type: 'test'
  ...
# Subtest: TC-13 data: a malformed date is listed in needs attention with the reason in words, whatever the lane status (also stale-running)
ok 159 - TC-13 data: a malformed date is listed in needs attention with the reason in words, whatever the lane status (also stale-running)
  ---
  duration_ms: 1.284409
  type: 'test'
  ...
# Subtest: TC-13 data: outcome_missing needs spec.md; lc-board reads it only for a done:success marketing or sales track with no outcome
ok 160 - TC-13 data: outcome_missing needs spec.md; lc-board reads it only for a done:success marketing or sales track with no outcome
  ---
  duration_ms: 141.85283
  type: 'test'
  ...
# Subtest: TC-12 data: a waiting track with an owner action gets an owner-action card step, not the reply one (the board card and the next command agree)
ok 161 - TC-12 data: a waiting track with an owner action gets an owner-action card step, not the reply one (the board card and the next command agree)
  ---
  duration_ms: 1.203909
  type: 'test'
  ...
# Subtest: TC-12 page: an old board.json (no owner keys) renders as before: no owner block, no UTC line
ok 162 - TC-12 page: an old board.json (no owner keys) renders as before: no owner block, no UTC line
  ---
  duration_ms: 32.224063
  type: 'test'
  ...
# Subtest: TC-12 page: overdue is worked out at render from the UTC date: due tomorrow, due today (not overdue), then overdue the next UTC day
ok 163 - TC-12 page: overdue is worked out at render from the UTC date: due tomorrow, due today (not overdue), then overdue the next UTC day
  ---
  duration_ms: 27.545163
  type: 'test'
  ...
# Subtest: TC-12 page: no due date, a malformed one and a future one all show, with the reason; none is overdue
ok 164 - TC-12 page: no due date, a malformed one and a future one all show, with the reason; none is overdue
  ---
  duration_ms: 10.108237
  type: 'test'
  ...
# Subtest: TC-12 page: the page agrees with the shared rule (ownerFlags and dueText of owner-steps.mjs) on a table of dates and clocks
ok 165 - TC-12 page: the page agrees with the shared rule (ownerFlags and dueText of owner-steps.mjs) on a table of dates and clocks
  ---
  duration_ms: 423.667654
  type: 'test'
  ...
# Subtest: TC-12 page: only a waiting track is overdue (a running one is not), and the drawer header shows the action, its due date and the result
ok 166 - TC-12 page: only a waiting track is overdue (a running one is not), and the drawer header shows the action, its due date and the result
  ---
  duration_ms: 7.817699
  type: 'test'
  ...
# Subtest: TC-12 page: a window ready to measure (KPI Check After today or earlier on a waiting track) shows on the card and in needs attention
ok 167 - TC-12 page: a window ready to measure (KPI Check After today or earlier on a waiting track) shows on the card and in needs attention
  ---
  duration_ms: 13.750841
  type: 'test'
  ...
# Subtest: TC-13 page: an overdue action is listed beside the track's other reasons; a stale-running track with a bad date lists both; the cause chips name them
ok 168 - TC-13 page: an overdue action is listed beside the track's other reasons; a stale-running track with a bad date lists both; the cause chips name them
  ---
  duration_ms: 7.687805
  type: 'test'
  ...
# Subtest: TC-14 page: the free text of Owner Action and Result is escaped everywhere: a script tag in it is text, never an element
ok 169 - TC-14 page: the free text of Owner Action and Result is escaped everywhere: a script tag in it is text, never an element
  ---
  duration_ms: 11.680045
  type: 'test'
  ...
# Subtest: TC-12 page: What's next shows the owner-action card with the due date worked out now, and never says it adds an answer
ok 170 - TC-12 page: What's next shows the owner-action card with the due date worked out now, and never says it adds an answer
  ---
  duration_ms: 161.192179
  type: 'test'
  ...
# Subtest: TC-12 page: more than two open owner actions add the one line of advice, and the "also waiting" rows show their due dates
ok 171 - TC-12 page: more than two open owner actions add the one line of advice, and the "also waiting" rows show their due dates
  ---
  duration_ms: 288.121038
  type: 'test'
  ...
# Subtest: TC-12 page: the "ready to measure" card (S23) reads as a measurement with its command
ok 172 - TC-12 page: the "ready to measure" card (S23) reads as a measurement with its command
  ---
  duration_ms: 105.904631
  type: 'test'
  ...
# Subtest: TC-12 page: the priority order of the lanes and the type chips still work with owner steps on the cards
ok 173 - TC-12 page: the priority order of the lanes and the type chips still work with owner steps on the cards
  ---
  duration_ms: 10.780818
  type: 'test'
  ...
# Subtest: TC-14: the new styles use the existing colour tokens only, the page file carries no project data, and the UTC line says it in one sentence
ok 174 - TC-14: the new styles use the existing colour tokens only, the page file carries no project data, and the UTC line says it in one sentence
  ---
  duration_ms: 0.77799
  type: 'test'
  ...
# Subtest: lc-board --site writes the owner-step keys into board.json and the page file stays byte-identical for every project
ok 175 - lc-board --site writes the owner-step keys into board.json and the page file stays byte-identical for every project
  ---
  duration_ms: 278.879408
  type: 'test'
  ...
# Subtest: --site writes board.html, board.json and docs/, prints their absolute paths and nothing else
ok 176 - --site writes board.html, board.json and docs/, prints their absolute paths and nothing else
  ---
  duration_ms: 323.003034
  type: 'test'
  ...
# Subtest: board.html is byte-identical across runs and carries no data; board.json holds the data
ok 177 - board.html is byte-identical across runs and carries no data; board.json holds the data
  ---
  duration_ms: 482.200482
  type: 'test'
  ...
# Subtest: boardPageData: short keys, live tracks only, phase cut at 130 chars, prefix from the folder
ok 178 - boardPageData: short keys, live tracks only, phase cut at 130 chars, prefix from the folder
  ---
  duration_ms: 6.145
  type: 'test'
  ...
# Subtest: --site inside the repo conductor/ folder is refused and writes nothing
ok 179 - --site inside the repo conductor/ folder is refused and writes nothing
  ---
  duration_ms: 361.358354
  type: 'test'
  ...
# Subtest: existing behaviours are unchanged: stdout JSON, --out, --check
ok 180 - existing behaviours are unchanged: stdout JSON, --out, --check
  ---
  duration_ms: 337.348355
  type: 'test'
  ...
# Subtest: page: renders 5 lane columns, the done list and the attention list from a generated board.json
ok 181 - page: renders 5 lane columns, the done list and the attention list from a generated board.json
  ---
  duration_ms: 347.061082
  type: 'test'
  ...
# Subtest: page: a failed fetch (network error, HTTP error, bad format) shows the error state and no board
ok 182 - page: a failed fetch (network error, HTTP error, bad format) shows the error state and no board
  ---
  duration_ms: 28.28433
  type: 'test'
  ...
# Subtest: page: the loading state is in the markup and shown until the data arrives
ok 183 - page: the loading state is in the markup and shown until the data arrives
  ---
  duration_ms: 7.03527
  type: 'test'
  ...
# Subtest: page: a status filter whose matches are all in Done explains where they are and opens the Done list
ok 184 - page: a status filter whose matches are all in Done explains where they are and opens the Done list
  ---
  duration_ms: 345.05105
  type: 'test'
  ...
# Subtest: detail: clicking a card opens the drawer with the header, Overview from docs/<n>.json, and moves focus into it
ok 185 - detail: clicking a card opens the drawer with the header, Overview from docs/<n>.json, and moves focus into it
  ---
  duration_ms: 341.079069
  type: 'test'
  ...
# Subtest: detail: Enter and Space on a card open it; done rows and attention rows are buttons too
ok 186 - detail: Enter and Space on a card open it; done rows and attention rows are buttons too
  ---
  duration_ms: 324.374538
  type: 'test'
  ...
# Subtest: detail: tabs switch, each shows its document, and docs/<n>.json is fetched once (cached across tabs and reopening)
ok 187 - detail: tabs switch, each shows its document, and docs/<n>.json is fetched once (cached across tabs and reopening)
  ---
  duration_ms: 308.347605
  type: 'test'
  ...
# Subtest: detail: the Conversation tab exists only when the doc has one (off by default)
ok 188 - detail: the Conversation tab exists only when the doc has one (off by default)
  ---
  duration_ms: 677.637434
  type: 'test'
  ...
# Subtest: detail: a withheld file shows "withheld: <reason>" and never the text; the other tabs still render
ok 189 - detail: a withheld file shows "withheld: <reason>" and never the text; the other tabs still render
  ---
  duration_ms: 306.319333
  type: 'test'
  ...
# Subtest: detail: a done track has no tabs and no fetch, a note, and an Open in GitHub link (https, new tab, noopener)
ok 190 - detail: a done track has no tabs and no fetch, a note, and an Open in GitHub link (https, new tab, noopener)
  ---
  duration_ms: 559.058092
  type: 'test'
  ...
# Subtest: detail: with board.include_docs false the drawer shows the header only
ok 191 - detail: with board.include_docs false the drawer shows the header only
  ---
  duration_ms: 244.028086
  type: 'test'
  ...
# Subtest: detail: a failed or malformed docs fetch shows an error with Try again; success afterwards is not blocked by a cached failure
ok 192 - detail: a failed or malformed docs fetch shows an error with Try again; success afterwards is not blocked by a cached failure
  ---
  duration_ms: 556.559318
  type: 'test'
  ...
# Subtest: detail: Esc and Close both close it, the board is no longer inert, and focus returns to the clicked element
ok 193 - detail: Esc and Close both close it, the board is no longer inert, and focus returns to the clicked element
  ---
  duration_ms: 338.42444
  type: 'test'
  ...
# Subtest: detail: focus is trapped while open (Tab wraps at the ends, Shift+Tab too)
ok 194 - detail: focus is trapped while open (Tab wraps at the ends, Shift+Tab too)
  ---
  duration_ms: 299.207955
  type: 'test'
  ...
# Subtest: detail: the markdown renderer builds headings, lists, task items, code, quotes, rules and tables, with no raw html
ok 195 - detail: the markdown renderer builds headings, lists, task items, code, quotes, rules and tables, with no raw html
  ---
  duration_ms: 292.869242
  type: 'test'
  ...
# Subtest: detail XSS: script tags, img onerror and javascript: links in a document render as inert text; no element is made for them
ok 196 - detail XSS: script tags, img onerror and javascript: links in a document render as inert text; no element is made for them
  ---
  duration_ms: 12.835725
  type: 'test'
  ...
# Subtest: detail: search matches titles only, never document bodies
ok 197 - detail: search matches titles only, never document bodies
  ---
  duration_ms: 259.282943
  type: 'test'
  ...
# Subtest: page markup: a dialog with a labelled title, tabs container, the privacy footer line, and the drawer is outside the inert wrapper
ok 198 - page markup: a dialog with a labelled title, tabs container, the privacy footer line, and the drawer is outside the inert wrapper
  ---
  duration_ms: 5.269127
  type: 'test'
  ...
# Subtest: backlog: last, collapsed by default, Show and Hide work and are remembered; a search or a matching status filter opens it
ok 199 - backlog: last, collapsed by default, Show and Hide work and are remembered; a search or a matching status filter opens it
  ---
  duration_ms: 267.537352
  type: 'test'
  ...
# Subtest: backlog: the section is hidden when there are no backlog tracks, and the summary lists backlog last
ok 200 - backlog: the section is hidden when there are no backlog tracks, and the summary lists backlog last
  ---
  duration_ms: 298.249761
  type: 'test'
  ...
# Subtest: page: tracks in the workflow lanes planning and in-progress are drawn, counted and in the flow bar; no legacy columns
ok 201 - page: tracks in the workflow lanes planning and in-progress are drawn, counted and in the flow bar; no legacy columns
  ---
  duration_ms: 264.549347
  type: 'test'
  ...
# Subtest: page: legacy plan and implement lanes still display, under planning and in-progress
ok 202 - page: legacy plan and implement lanes still display, under planning and in-progress
  ---
  duration_ms: 251.286382
  type: 'test'
  ...
# Subtest: boardPageData: carries the lanes it is given, else the default workflow lanes
ok 203 - boardPageData: carries the lanes it is given, else the default workflow lanes
  ---
  duration_ms: 0.475652
  type: 'test'
  ...
# Subtest: lc board writes the workflow.json lane order into board.json; a missing workflow gets the default lanes
ok 204 - lc board writes the workflow.json lane order into board.json; a missing workflow gets the default lanes
  ---
  duration_ms: 523.012968
  type: 'test'
  ...
# Subtest: page: a project with custom lanes gets exactly those columns; first column is "being planned", the rest are "in progress"
ok 205 - page: a project with custom lanes gets exactly those columns; first column is "being planned", the rest are "in progress"
  ---
  duration_ms: 273.984854
  type: 'test'
  ...
# Subtest: page: a workflow that itself names the lanes plan and implement keeps them as columns (no mapping)
ok 206 - page: a workflow that itself names the lanes plan and implement keeps them as columns (no mapping)
  ---
  duration_ms: 258.182564
  type: 'test'
  ...
# Subtest: page: an older board.json without `lanes` still renders with the default workflow lanes
ok 207 - page: an older board.json without `lanes` still renders with the default workflow lanes
  ---
  duration_ms: 232.449589
  type: 'test'
  ...
# Subtest: page: the drawer shows the workflow lane name for a track still carrying a legacy lane
ok 208 - page: the drawer shows the workflow lane name for a track still carrying a legacy lane
  ---
  duration_ms: 205.821143
  type: 'test'
  ...
# Subtest: actions: cards, Needs-attention rows and the drawer header show the reason and the exact command; no Move without the capability
ok 209 - actions: cards, Needs-attention rows and the drawer header show the reason and the exact command; no Move without the capability
  ---
  duration_ms: 15.074866
  type: 'test'
  ...
# Subtest: actions: Copy calls navigator.clipboard.writeText inside the click handler, says Copied, and does not open the card
ok 210 - actions: Copy calls navigator.clipboard.writeText inside the click handler, says Copied, and does not open the card
  ---
  duration_ms: 17.517159
  type: 'test'
  ...
# Subtest: actions: a refused clipboard write falls back to selecting the command text
ok 211 - actions: a refused clipboard write falls back to selecting the command text
  ---
  duration_ms: 17.798887
  type: 'test'
  ...
# Subtest: actions: no clipboard API and no selection API at all: no error, and the page says what to do
ok 212 - actions: no clipboard API and no selection API at all: no error, and the page says what to do
  ---
  duration_ms: 11.860194
  type: 'test'
  ...
# Subtest: actions: the drawer header carries the Copy button and it is part of the focus trap
ok 213 - actions: the drawer header carries the Copy button and it is part of the focus trap
  ---
  duration_ms: 17.687038
  type: 'test'
  ...
# Subtest: Move: capability absent (no claude, use() null, use() rejects, no use): nothing is drawn, nothing is said
ok 214 - Move: capability absent (no claude, use() null, use() rejects, no use): nothing is drawn, nothing is said
  ---
  duration_ms: 61.993715
  type: 'test'
  ...
# Subtest: Move: with the capability the menu is drawn on cards, attention rows and in the drawer, but the server is never probed or called on load
ok 215 - Move: with the capability the menu is drawn on cards, attention rows and in the drawer, but the server is never probed or called on load
  ---
  duration_ms: 13.344379
  type: 'test'
  ...
# Subtest: Move: the first click probes once; a menu of the other lanes; a confirm names the exact move; then get_track and update_track; the card moves with a note
ok 216 - Move: the first click probes once; a menu of the other lanes; a confirm names the exact move; then get_track and update_track; the card moves with a note
  ---
  duration_ms: 23.258532
  type: 'test'
  ...
# Subtest: Move: cancel at the confirm step writes nothing
ok 217 - Move: cancel at the confirm step writes nothing
  ---
  duration_ms: 14.473268
  type: 'test'
  ...
# Subtest: Move: a running track gets a warning in the confirm step
ok 218 - Move: a running track gets a warning in the confirm step
  ---
  duration_ms: 13.352154
  type: 'test'
  ...
# Subtest: Move: a server that is not reachable (not in the desktop app): the menu goes on the first click, with a quiet note, and nothing is called
ok 219 - Move: a server that is not reachable (not in the desktop app): the menu goes on the first click, with a quiet note, and nothing is called
  ---
  duration_ms: 14.668514
  type: 'test'
  ...
# Subtest: Move: a server that lists without update_track is unreachable; so is a listTools rejection
ok 220 - Move: a server that lists without update_track is unreachable; so is a listTools rejection
  ---
  duration_ms: 28.829356
  type: 'test'
  ...
# Subtest: Move: CONFLICT shows "changed since you looked; refresh the board and try again" and the card stays
ok 221 - Move: CONFLICT shows "changed since you looked; refresh the board and try again" and the card stays
  ---
  duration_ms: 19.149853
  type: 'test'
  ...
# Subtest: Move: other failures are told apart (connector refusal, cancelled, approval, ambiguous outcome); none moves the card or retries
ok 222 - Move: other failures are told apart (connector refusal, cancelled, approval, ambiguous outcome); none moves the card or retries
  ---
  duration_ms: 92.720041
  type: 'test'
  ...
# Subtest: Move: a get_track without a base writes nothing
ok 223 - Move: a get_track without a base writes nothing
  ---
  duration_ms: 22.511922
  type: 'test'
  ...
# Subtest: Move: leaving the done lane needs an explicit tick in the page and passes reopen: true; never silently
ok 224 - Move: leaving the done lane needs an explicit tick in the page and passes reopen: true; never silently
  ---
  duration_ms: 24.687585
  type: 'test'
  ...
# Subtest: Move: moving into done asks the same confirm and names the exact move; the menu options are in the drawer focus trap
ok 225 - Move: moving into done asks the same confirm and names the exact move; the menu options are in the drawer focus trap
  ---
  duration_ms: 17.680826
  type: 'test'
  ...
# Subtest: actions: new CSS uses theme variables only, wraps at phone width, and the page keeps its safe-DOM rule
ok 226 - actions: new CSS uses theme variables only, wraps at phone width, and the page keeps its safe-DOM rule
  ---
  duration_ms: 1.168372
  type: 'test'
  ...
# Subtest: project drawer: with nothing to read the Project button stays hidden and no ctx file is fetched
ok 227 - project drawer: with nothing to read the Project button stays hidden and no ctx file is fetched
  ---
  duration_ms: 243.522248
  type: 'test'
  ...
# Subtest: project drawer: the button opens the drawer with one tab per definition, the first loaded, focus inside, snapshot note in the header
ok 228 - project drawer: the button opens the drawer with one tab per definition, the first loaded, focus inside, snapshot note in the header
  ---
  duration_ms: 256.578878
  type: 'test'
  ...
# Subtest: project drawer: Escape closes it; Tab and Shift+Tab are trapped; a track opened afterwards gets its own header back
ok 229 - project drawer: Escape closes it; Tab and Shift+Tab are trapped; a track opened afterwards gets its own header back
  ---
  duration_ms: 248.224291
  type: 'test'
  ...
# Subtest: project drawer: the Workflow tab draws the lanes as boxes with arrows, a text list, the primer, then the workflow.md text
ok 230 - project drawer: the Workflow tab draws the lanes as boxes with arrows, a text list, the primer, then the workflow.md text
  ---
  duration_ms: 235.636223
  type: 'test'
  ...
# Subtest: project drawer: no workflow.json means no boxes; an unreadable lane shows its note; odd entries are skipped and nothing throws
ok 231 - project drawer: no workflow.json means no boxes; an unreadable lane shows its note; odd entries are skipped and nothing throws
  ---
  duration_ms: 239.330495
  type: 'test'
  ...
# Subtest: project drawer: markdown from a file is safe (no elements from text, no script links); a withheld tab shows the reason and no text
ok 232 - project drawer: markdown from a file is safe (no elements from text, no script links); a withheld tab shows the reason and no text
  ---
  duration_ms: 234.50969
  type: 'test'
  ...
# Subtest: project drawer: a ctx file that fails to load shows an error with Try again (inside the focus trap), and a retry works
ok 233 - project drawer: a ctx file that fails to load shows an error with Try again (inside the focus trap), and a retry works
  ---
  duration_ms: 260.899378
  type: 'test'
  ...
# Subtest: project drawer: markup and CSS: a header button, theme variables only, wraps at phone width, no overflow from the boxes
ok 234 - project drawer: markup and CSS: a header button, theme variables only, wraps at phone width, no overflow from the boxes
  ---
  duration_ms: 1.649455
  type: 'test'
  ...
# Subtest: newer board: the page asks version.json every 15 seconds on an unref'd timer, never board.json again, and does nothing while the time is the same
ok 235 - newer board: the page asks version.json every 15 seconds on an unref'd timer, never board.json again, and does nothing while the time is the same
  ---
  duration_ms: 286.066644
  type: 'test'
  ...
# Subtest: newer board: a later generated time with nothing open reloads the page once; a second newer board within two minutes shows the button instead (reload guard)
ok 236 - newer board: a later generated time with nothing open reloads the page once; a second newer board within two minutes shows the button instead (reload guard)
  ---
  duration_ms: 263.146998
  type: 'test'
  ...
# Subtest: newer board: with a search typed or a track open the page does not reload; it shows "A newer board is available" and the button reloads
ok 237 - newer board: with a search typed or a track open the page does not reload; it shows "A newer board is available" and the button reloads
  ---
  duration_ms: 257.764508
  type: 'test'
  ...
# Subtest: newer board: an older or unreadable generated time changes nothing; a 404 (a board published before the index existed) stops the asking; a hidden tab asks nothing; no sessionStorage means no automatic reload
ok 238 - newer board: an older or unreadable generated time changes nothing; a 404 (a board published before the index existed) stops the asking; a hidden tab asks nothing; no sessionStorage means no automatic reload
  ---
  duration_ms: 556.784492
  type: 'test'
  ...
# Subtest: board.json: bb lists Depends On and Waiting On Tracks once each; kp is Serves, or empty with only a KPI Check After; neither: both absent
ok 239 - board.json: bb lists Depends On and Waiting On Tracks once each; kp is Serves, or empty with only a KPI Check After; neither: both absent
  ---
  duration_ms: 1.483794
  type: 'test'
  ...
# Subtest: drawer: Blocked by opens the other track; a done one reads Needs (done); KPI opens the KPIs tab of the Project drawer
ok 240 - drawer: Blocked by opens the other track; a done one reads Needs (done); KPI opens the KPIs tab of the Project drawer
  ---
  duration_ms: 27.730535
  type: 'test'
  ...
# Subtest: Discuss: copies a prompt that asks to read and talk first, runs no lane, and sits beside Copy
ok 241 - Discuss: copies a prompt that asks to read and talk first, runs no lane, and sits beside Copy
  ---
  duration_ms: 12.569596
  type: 'test'
  ...
# Subtest: a running card is the first card of its lane, above success cards and above higher priorities; the rest keeps its order
ok 242 - a running card is the first card of its lane, above success cards and above higher priorities; the rest keeps its order
  ---
  duration_ms: 6.946435
  type: 'test'
  ...
# Subtest: board.json: kf is a for a track that serves an active KPI, f when every KPI it serves is not active; absent for no Serves or one that is not listed; no kpis.md: absent
ok 243 - board.json: kf is a for a track that serves an active KPI, f when every KPI it serves is not active; absent for no Serves or one that is not listed; no kpis.md: absent
  ---
  duration_ms: 1.594842
  type: 'test'
  ...
# Subtest: page: a track serving only a future KPI carries the future KPI badge on its card and in the drawer; searching a KPI id finds the tracks that serve it; the KPI button counts the tracks
ok 244 - page: a track serving only a future KPI carries the future KPI badge on its card and in the drawer; searching a KPI id finds the tracks that serve it; the KPI button counts the tracks
  ---
  duration_ms: 21.950619
  type: 'test'
  ...
# Subtest: board.html is titled "<project> Board": the project name from the settings file or the folder, cleaned and clipped; the source page stays generic
ok 245 - board.html is titled "<project> Board": the project name from the settings file or the folder, cleaned and clipped; the source page stays generic
  ---
  duration_ms: 450.070361
  type: 'test'
  ...
# Subtest: board.json writes the priority only for high and low, ignores other values, and the first marker wins
ok 246 - board.json writes the priority only for high and low, ignores other values, and the first marker wins
  ---
  duration_ms: 9.571489
  type: 'test'
  ...
# Subtest: a project with no priorities writes no pr key anywhere
ok 247 - a project with no priorities writes no pr key anywhere
  ---
  duration_ms: 0.638207
  type: 'test'
  ...
# Subtest: page: old data without the field renders as before (newest first)
ok 248 - page: old data without the field renders as before (newest first)
  ---
  duration_ms: 21.450247
  type: 'test'
  ...
# Subtest: page: a lane lists high, then normal, then low, newest first inside a priority; no card changes lane
ok 249 - page: a lane lists high, then normal, then low, newest first inside a priority; no card changes lane
  ---
  duration_ms: 11.18114
  type: 'test'
  ...
# Subtest: page: the backlog is ordered by priority too, and Done keeps newest first
ok 250 - page: the backlog is ordered by priority too, and Done keeps newest first
  ---
  duration_ms: 8.563518
  type: 'test'
  ...
# Subtest: page: a text label shows only for high and low, next to the type label, and in the drawer header
ok 251 - page: a text label shows only for high and low, next to the type label, and in the drawer header
  ---
  duration_ms: 8.024086
  type: 'test'
  ...
# Subtest: page: an unknown value in the field reads as normal and cannot inject markup
ok 252 - page: an unknown value in the field reads as normal and cannot inject markup
  ---
  duration_ms: 8.89535
  type: 'test'
  ...
# Subtest: page: the type filter and the priority order work together
ok 253 - page: the type filter and the priority order work together
  ---
  duration_ms: 8.14379
  type: 'test'
  ...
# Subtest: page: the "Type" caption is visible text before the type chips, shown with them, and the new styles use tokens only
ok 254 - page: the "Type" caption is visible text before the type chips, shown with them, and the new styles use tokens only
  ---
  duration_ms: 22.697297
  type: 'test'
  ...
# Subtest: Needs attention keeps its order (newest first) and is not sorted by priority
ok 255 - Needs attention keeps its order (newest first) and is not sorted by priority
  ---
  duration_ms: 1.413482
  type: 'test'
  ...
# Subtest: page: inside a lane the running card is first, then by priority, then the cards that finished their step (success), newest first inside each group; Done stays newest first
ok 256 - page: inside a lane the running card is first, then by priority, then the cards that finished their step (success), newest first inside each group; Done stays newest first
  ---
  duration_ms: 6.807723
  type: 'test'
  ...
# Subtest: every definition file present: one tab each, in order, each its own ctx file with the text as written
ok 257 - every definition file present: one tab each, in order, each its own ctx file with the text as written
  ---
  duration_ms: 230.434727
  type: 'test'
  ...
# Subtest: a partial definition: only the files that exist get a tab; no workflow.json means no drawing
ok 258 - a partial definition: only the files that exist get a tab; no workflow.json means no drawing
  ---
  duration_ms: 235.078381
  type: 'test'
  ...
# Subtest: nothing to read: no project_docs, no wf, no ctx folder (the page then hides the Project button)
ok 259 - nothing to read: no project_docs, no wf, no ctx folder (the page then hides the Project button)
  ---
  duration_ms: 228.992694
  type: 'test'
  ...
# Subtest: only a workflow.json (no .md files): the Workflow tab exists for the drawing, with an empty text
ok 260 - only a workflow.json (no .md files): the Workflow tab exists for the drawing, with an empty text
  ---
  duration_ms: 269.110538
  type: 'test'
  ...
# Subtest: the untouched scaffold text is not a tab; the same files with real content are
ok 261 - the untouched scaffold text is not a tab; the same files with real content are
  ---
  duration_ms: 526.800729
  type: 'test'
  ...
# Subtest: isPlaceholderOnly: empty, headings only, scaffold placeholders; not real text next to a placeholder
ok 262 - isPlaceholderOnly: empty, headings only, scaffold placeholders; not real text next to a placeholder
  ---
  duration_ms: 0.808457
  type: 'test'
  ...
# Subtest: privacy: a fake secret in kpis.md withholds that tab with a reason; the text is in no published file, stdout or stderr
ok 263 - privacy: a fake secret in kpis.md withholds that tab with a reason; the text is in no published file, stdout or stderr
  ---
  duration_ms: 230.153234
  type: 'test'
  ...
# Subtest: privacy: one withheld file of the Guidelines tab leaves the others readable; an email and a phone number are caught too
ok 264 - privacy: one withheld file of the Guidelines tab leaves the others readable; an email and a phone number are caught too
  ---
  duration_ms: 290.606264
  type: 'test'
  ...
# Subtest: a Guidelines tab with every file withheld says so once
ok 265 - a Guidelines tab with every file withheld says so once
  ---
  duration_ms: 201.165994
  type: 'test'
  ...
# Subtest: board.include_docs: false turns the project definition off too: no project_docs, no wf, no ctx files
ok 266 - board.include_docs: false turns the project definition off too: no project_docs, no wf, no ctx files
  ---
  duration_ms: 274.4765
  type: 'test'
  ...
# Subtest: the file cap: ctx files count toward the 200; track documents get what is left and the message stays right
ok 267 - the file cap: ctx files count toward the 200; track documents get what is left and the message stays right
  ---
  duration_ms: 888.861959
  type: 'test'
  ...
# Subtest: a site folder that is reused loses the ctx files of a tab that is gone
ok 268 - a site folder that is reused loses the ctx files of a tab that is gone
  ---
  duration_ms: 501.156585
  type: 'test'
  ...
# Subtest: .laneconductor.json is never published: not in the file list, not on disk, and its values are in no file
ok 269 - .laneconductor.json is never published: not in the file list, not on disk, and its values are in no file
  ---
  duration_ms: 228.990166
  type: 'test'
  ...
# Subtest: wf for the current format: where each lane sends success and failure (the shared resolver)
ok 270 - wf for the current format: where each lane sends success and failure (the shared resolver)
  ---
  duration_ms: 475.846337
  type: 'test'
  ...
# Subtest: wf for a legacy workflow.json (otralingo style, bare targets and old lane names)
ok 271 - wf for a legacy workflow.json (otralingo style, bare targets and old lane names)
  ---
  duration_ms: 3.154279
  type: 'test'
  ...
# Subtest: wf never crashes on an unknown or broken format: it lists what it can
ok 272 - wf never crashes on an unknown or broken format: it lists what it can
  ---
  duration_ms: 249.219105
  type: 'test'
  ...
# Subtest: a missing workflow.json with a workflow.md: the tab shows the text, with no drawing
ok 273 - a missing workflow.json with a workflow.md: the tab shows the text, with no drawing
  ---
  duration_ms: 175.206962
  type: 'test'
  ...
# Subtest: a secret in a lane name withholds the drawing, not the board
ok 274 - a secret in a lane name withholds the drawing, not the board
  ---
  duration_ms: 198.540524
  type: 'test'
  ...
# Subtest: buildProjectDocs: pure; more than the usual styleguides are cut at six
ok 275 - buildProjectDocs: pure; more than the usual styleguides are cut at six
  ---
  duration_ms: 0.874251
  type: 'test'
  ...
# Subtest: publishedType: the four non-dev words in any case, nothing for dev, empty, absent or unknown values
ok 276 - publishedType: the four non-dev words in any case, nothing for dev, empty, absent or unknown values
  ---
  duration_ms: 1.092159
  type: 'test'
  ...
# Subtest: board.json writes the type only for non-dev tracks, ignores unknown values, and reads the first Type marker
ok 277 - board.json writes the type only for non-dev tracks, ignores unknown values, and reads the first Type marker
  ---
  duration_ms: 13.341332
  type: 'test'
  ...
# Subtest: a project with only dev tracks writes no type anywhere in board.json
ok 278 - a project with only dev tracks writes no type anywhere in board.json
  ---
  duration_ms: 0.791385
  type: 'test'
  ...
# Subtest: lc-board --site writes the type into board.json and the page file stays the same for every project
ok 279 - lc-board --site writes the type into board.json and the page file stays the same for every project
  ---
  duration_ms: 499.565642
  type: 'test'
  ...
# Subtest: page: an old board.json without the field renders as all dev, with no type filter and no label
ok 280 - page: an old board.json without the field renders as all dev, with no type filter and no label
  ---
  duration_ms: 44.874689
  type: 'test'
  ...
# Subtest: page: an unknown or hostile value in the field reads as dev
ok 281 - page: an unknown or hostile value in the field reads as dev
  ---
  duration_ms: 8.289884
  type: 'test'
  ...
# Subtest: page: the type chips show only the types in the data, All first, with counts, and aria-pressed
ok 282 - page: the type chips show only the types in the data, All first, with counts, and aria-pressed
  ---
  duration_ms: 20.830214
  type: 'test'
  ...
# Subtest: page: a non-dev card and the drawer header carry a text label; a dev card carries none
ok 283 - page: a non-dev card and the drawer header carry a text label; a dev card carries none
  ---
  duration_ms: 8.353374
  type: 'test'
  ...
# Subtest: page: the filter hides and shows the right cards, combines with search and status, and opens the backlog like a search
ok 284 - page: the filter hides and shows the right cards, combines with search and status, and opens the backlog like a search
  ---
  duration_ms: 11.694653
  type: 'test'
  ...
# Subtest: page: nothing matches says so, names the filters, and Clear filters brings everything back
ok 285 - page: nothing matches says so, names the filters, and Clear filters brings everything back
  ---
  duration_ms: 11.472065
  type: 'test'
  ...
# Subtest: page: the chosen chip is remembered per viewer and restored; a type no longer in the data falls back to All
ok 286 - page: the chosen chip is remembered per viewer and restored; a type no longer in the data falls back to All
  ---
  duration_ms: 38.32504
  type: 'test'
  ...
# Subtest: page: with localStorage throwing, the board renders and the filter still works for the session
ok 287 - page: with localStorage throwing, the board renders and the filter still works for the session
  ---
  duration_ms: 9.222885
  type: 'test'
  ...
# Subtest: page: the filter is a labelled group of buttons with a visible focus state, and the new styles add no colour literals
ok 288 - page: the filter is a labelled group of buttons with a visible focus state, and the new styles add no colour literals
  ---
  duration_ms: 0.864421
  type: 'test'
  ...
# Subtest: shape, ordering and counts on a fixture repo
ok 289 - shape, ordering and counts on a fixture repo
  ---
  duration_ms: 141.404328
  type: 'test'
  ...
# Subtest: tracks sort by lane order, then number descending
ok 290 - tracks sort by lane order, then number descending
  ---
  duration_ms: 6.605063
  type: 'test'
  ...
# Subtest: odd and missing markers never throw
ok 291 - odd and missing markers never throw
  ---
  duration_ms: 9.505134
  type: 'test'
  ...
# Subtest: deterministic for a given generatedAt
ok 292 - deterministic for a given generatedAt
  ---
  duration_ms: 366.516813
  type: 'test'
  ...
# Subtest: privacy: no conversation, spec or plan text, and no Problem or Summary text, in the output
ok 293 - privacy: no conversation, spec or plan text, and no Problem or Summary text, in the output
  ---
  duration_ms: 161.932417
  type: 'test'
  ...
# Subtest: privacy: a marker value never runs into the body (legacy index.md): Lane Status is one line, a title line ends a value
ok 294 - privacy: a marker value never runs into the body (legacy index.md): Lane Status is one line, a title line ends a value
  ---
  duration_ms: 0.657805
  type: 'test'
  ...
# Subtest: --check passes on a fresh file, fails on a stale or missing one (generated_at is ignored)
ok 295 - --check passes on a fresh file, fails on a stale or missing one (generated_at is ignored)
  ---
  duration_ms: 541.688021
  type: 'test'
  ...
# Subtest: CLI prints valid JSON on stdout and writes nothing into the repo
ok 296 - CLI prints valid JSON on stdout and writes nothing into the repo
  ---
  duration_ms: 281.302206
  type: 'test'
  ...
# Subtest: falls back to the folder name and the default lanes without config files
ok 297 - falls back to the folder name and the default lanes without config files
  ---
  duration_ms: 116.597836
  type: 'test'
  ...
# Subtest: a bad --now exits 2 and a repo with no tracks gives an empty board
ok 298 - a bad --now exits 2 and a repo with no tracks gives an empty board
  ---
  duration_ms: 189.609771
  type: 'test'
  ...
# Subtest: claimStamps: stamps on a claim, none on a re-claim, removes on release, respects explicit values
ok 299 - claimStamps: stamps on a claim, none on a re-claim, removes on release, respects explicit values
  ---
  duration_ms: 2.058853
  type: 'test'
  ...
# Subtest: staleRunning: only a stamped running claim older than the limit
ok 300 - staleRunning: only a stamped running claim older than the limit
  ---
  duration_ms: 0.984708
  type: 'test'
  ...
# Subtest: humanCommentSince: a changed conversation whose newest turn is the human's
ok 301 - humanCommentSince: a changed conversation whose newest turn is the human's
  ---
  duration_ms: 0.201248
  type: 'test'
  ...
# Subtest: update_track: claiming stamps Run Started and Run By (not part of the base), releasing removes them
ok 302 - update_track: claiming stamps Run Started and Run By (not part of the base), releasing removes them
  ---
  duration_ms: 851.270578
  type: 'test'
  ...
# Subtest: a stale claim is reported by get_track, list_tracks and the board; a fresh one is not
ok 303 - a stale claim is reported by get_track, list_tracks and the board; a fresh one is not
  ---
  duration_ms: 551.080338
  type: 'test'
  ...
# Subtest: a human comment that arrived after the caller read conversation.md warns when the lane status changes, once the read is current it does not
ok 304 - a human comment that arrived after the caller read conversation.md warns when the lane status changes, once the read is current it does not
  ---
  duration_ms: 937.341386
  type: 'test'
  ...
# Subtest: a 44-character client name is capped in Run By, and the stale warning still fits 200 characters with its final period
ok 305 - a 44-character client name is capped in Run By, and the stale warning still fits 200 characters with its final period
  ---
  duration_ms: 700.02686
  type: 'test'
  ...
# Subtest: a Lane-only move while running re-stamps the claim; replacing index.md with a non-running status drops the stamps
ok 306 - a Lane-only move while running re-stamps the claim; replacing index.md with a non-running status drops the stamps
  ---
  duration_ms: 733.979043
  type: 'test'
  ...
# Subtest: the rule has the four parts in order: outcome, what is needed from the person (three lines at most), one next command, one More line; six lines at most
ok 307 - the rule has the four parts in order: outcome, what is needed from the person (three lines at most), one next command, one More line; six lines at most
  ---
  duration_ms: 1.221973
  type: 'test'
  ...
# Subtest: findings, phase and test-case lists and risks go into the track's files and its one completion comment, never into the chat
ok 308 - findings, phase and test-case lists and risks go into the track's files and its one completion comment, never into the chat
  ---
  duration_ms: 0.245751
  type: 'test'
  ...
# Subtest: the rule is written once in the skill source; the lane commands and run carry it once, no other command does
ok 309 - the rule is written once in the skill source; the lane commands and run carry it once, no other command does
  ---
  duration_ms: 4.981257
  type: 'test'
  ...
# Subtest: each lane guide ends by pointing at the rule, once; the plan guide (the plan command) asks for no findings in chat
ok 310 - each lane guide ends by pointing at the rule, once; the plan guide (the plan command) asks for no findings in chat
  ---
  duration_ms: 0.99115
  type: 'test'
  ...
# Subtest: the habit of a lane finishing points at the rule; the one-completion-comment rule is as it was
ok 311 - the habit of a lane finishing points at the rule; the one-completion-comment rule is as it was
  ---
  duration_ms: 1.699909
  type: 'test'
  ...
# Subtest: sizes: no lane command grew against 1.9.6, and run stays under 68 KB
ok 312 - sizes: no lane command grew against 1.9.6, and run stays under 68 KB
  ---
  duration_ms: 2.488689
  type: 'test'
  ...
# Subtest: board: after a lane finishes, the track's card shows the next lane's command (the one the closing message names)
ok 313 - board: after a lane finishes, the track's card shows the next lane's command (the one the closing message names)
  ---
  duration_ms: 1.370061
  type: 'test'
  ...
# Subtest: board: a failed lane and a finished merge: the card names the retry or fix command, a merged track has nothing to copy
ok 314 - board: a failed lane and a finished merge: the card names the retry or fix command, a merged track has nothing to copy
  ---
  duration_ms: 0.521088
  type: 'test'
  ...
# Subtest: filing tracks by hand: the next free number unpadded, the id without the slug in every heading, as create_track writes them
ok 315 - filing tracks by hand: the next free number unpadded, the id without the slug in every heading, as create_track writes them
  ---
  duration_ms: 2.001275
  type: 'test'
  ...
# Subtest: setup and the new-track commands carry that text; setup says create_track when the tool is present, else by hand, with the id-only heading
ok 316 - setup and the new-track commands carry that text; setup says create_track when the tool is present, else by hand, with the id-only heading
  ---
  duration_ms: 2.832515
  type: 'test'
  ...
# Subtest: catalog: every command has the fields, unique names, a known group and exactly the commands of the spec
ok 317 - catalog: every command has the fields, unique names, a known group and exactly the commands of the spec
  ---
  duration_ms: 2.170543
  type: 'test'
  ...
# Subtest: catalog and prompt output name no Claude-specific string
ok 318 - catalog and prompt output name no Claude-specific string
  ---
  duration_ms: 1.511015
  type: 'test'
  ...
# Subtest: prompts/list returns every catalog command and prompts/get fills the arguments
ok 319 - prompts/list returns every catalog command and prompts/get fills the arguments
  ---
  duration_ms: 445.241978
  type: 'test'
  ...
# Subtest: prompts/get without a required argument is an error that names the argument
ok 320 - prompts/get without a required argument is an error that names the argument
  ---
  duration_ms: 312.652587
  type: 'test'
  ...
# Subtest: the help prompt and the help tool list every command exactly once, with an example phrase and the note on the board script
ok 321 - the help prompt and the help tool list every command exactly once, with an example phrase and the note on the board script
  ---
  duration_ms: 328.628185
  type: 'test'
  ...
# Subtest: help works in a directory that is not a LaneConductor repo and writes nothing there
ok 322 - help works in a directory that is not a LaneConductor repo and writes nothing there
  ---
  duration_ms: 408.176835
  type: 'test'
  ...
# Subtest: every tool carries the four annotation hints and an Example line; help is read-only
ok 323 - every tool carries the four annotation hints and an Example line; help is read-only
  ---
  duration_ms: 393.949412
  type: 'test'
  ...
# Subtest: KC-8: the context estimate stays within 15 percent of the 0.3.0 figure, and the instructions stay under 4,096 characters and mention prompts
ok 324 - KC-8: the context estimate stays within 15 percent of the 0.3.0 figure, and the instructions stay under 4,096 characters and mention prompts
  ---
  duration_ms: 11.595287
  type: 'test'
  ...
# Subtest: argumentHint reads like a usage line
ok 325 - argumentHint reads like a usage line
  ---
  duration_ms: 0.471264
  type: 'test'
  ...
# Subtest: setup: follows setup/setup.md (writes first), scaffold goes straight to setup/scaffold.md; nothing from the old install text
ok 326 - setup: follows setup/setup.md (writes first), scaffold goes straight to setup/scaffold.md; nothing from the old install text
  ---
  duration_ms: 0.942439
  type: 'test'
  ...
# Subtest: multi-line body with blank lines and \#\# headers: every line prefixed, parses back as one entry
ok 327 - multi-line body with blank lines and \#\# headers: every line prefixed, parses back as one entry
  ---
  duration_ms: 3.65608
  type: 'test'
  ...
# Subtest: a body that already starts with > ** is rejected with a hint
ok 328 - a body that already starts with > ** is rejected with a hint
  ---
  duration_ms: 0.777118
  type: 'test'
  ...
# Subtest: a body line that would parse as a new turn is rejected (it would split the entry)
ok 329 - a body line that would parse as a new turn is rejected (it would split the entry)
  ---
  duration_ms: 0.332203
  type: 'test'
  ...
# Subtest: empty, whitespace-only, over-long and unknown-author inputs are rejected
ok 330 - empty, whitespace-only, over-long and unknown-author inputs are rejected
  ---
  duration_ms: 0.902815
  type: 'test'
  ...
# Subtest: appendTurn separates turns with a blank line and ends with a newline
ok 331 - appendTurn separates turns with a blank line and ends with a newline
  ---
  duration_ms: 0.345498
  type: 'test'
  ...
# Subtest: appendTurn keeps a header and tolerates a missing trailing newline
ok 332 - appendTurn keeps a header and tolerates a missing trailing newline
  ---
  duration_ms: 0.255981
  type: 'test'
  ...
# Subtest: countUnparsedLines counts prose outside turns and ignores headings
ok 333 - countUnparsedLines counts prose outside turns and ignores headings
  ---
  duration_ms: 0.258285
  type: 'test'
  ...
# Subtest: duplicateNumbers: same number under different folder names only
ok 334 - duplicateNumbers: same number under different folder names only
  ---
  duration_ms: 3.886092
  type: 'test'
  ...
# Subtest: a number taken on another local branch is not handed out again
ok 335 - a number taken on another local branch is not handed out again
  ---
  duration_ms: 671.084701
  type: 'test'
  ...
# Subtest: a number taken on a remote-tracking ref counts too
ok 336 - a number taken on a remote-tracking ref counts too
  ---
  duration_ms: 612.974122
  type: 'test'
  ...
# Subtest: a folder named differently only on an unmerged branch is a softer note, not a duplicate
ok 337 - a folder named differently only on an unmerged branch is a softer note, not a duplicate
  ---
  duration_ms: 558.273287
  type: 'test'
  ...
# Subtest: noise fix: 200 stale unmerged branches name numbers differently, and the create answer has no note about them
ok 338 - noise fix: 200 stale unmerged branches name numbers differently, and the create answer has no note about them
  ---
  duration_ms: 9595.558637
  type: 'test'
  ...
# Subtest: noise fix: only recent branches count; at most 3 are shown, then "+N more" and the repair-duplicates pointer, within 200 characters
ok 339 - noise fix: only recent branches count; at most 3 are shown, then "+N more" and the repair-duplicates pointer, within 200 characters
  ---
  duration_ms: 2295.335682
  type: 'test'
  ...
# Subtest: two folder names for one number on the state branch is a Duplicate warning
ok 340 - two folder names for one number on the state branch is a Duplicate warning
  ---
  duration_ms: 318.948675
  type: 'test'
  ...
# Subtest: a duplicate on main renamed by repair, old name still on an unmerged branch: no Duplicate warning; the branch note goes once it is merged
ok 341 - a duplicate on main renamed by repair, old name still on an unmerged branch: no Duplicate warning; the branch note goes once it is merged
  ---
  duration_ms: 424.899538
  type: 'test'
  ...
# Subtest: more than 100 branch tips: one warning says only the 100 newest were checked
ok 342 - more than 100 branch tips: one warning says only the 100 newest were checked
  ---
  duration_ms: 1693.852779
  type: 'test'
  ...
# Subtest: a few branches: no cap warning
ok 343 - a few branches: no cap warning
  ---
  duration_ms: 326.51524
  type: 'test'
  ...
# Subtest: the repair-duplicates command asks first, renames the newer folder, never pushes, and is in the catalog
ok 344 - the repair-duplicates command asks first, renames the newer folder, never pushes, and is in the catalog
  ---
  duration_ms: 0.49052
  type: 'test'
  ...
# Subtest: a folder that appears with the chosen number mid-allocation causes a retry to the next number
ok 345 - a folder that appears with the chosen number mid-allocation causes a retry to the next number
  ---
  duration_ms: 344.369007
  type: 'test'
  ...
# Subtest: three lost races give NUMBER_COLLISION
ok 346 - three lost races give NUMBER_COLLISION
  ---
  duration_ms: 218.127448
  type: 'test'
  ...
# Subtest: upstream folders count toward the next number
ok 347 - upstream folders count toward the next number
  ---
  duration_ms: 236.440932
  type: 'test'
  ...
# Subtest: two server processes creating tracks at the same time get distinct numbers, all committed
ok 348 - two server processes creating tracks at the same time get distinct numbers, all committed
  ---
  duration_ms: 1439.202741
  type: 'test'
  ...
# Subtest: tools export is the v0 set and handlers carry no SDK imports
ok 349 - tools export is the v0 set and handlers carry no SDK imports
  ---
  duration_ms: 1.237822
  type: 'test'
  ...
# Subtest: the base passes every emulated directory rule (TC-2)
ok 350 - the base passes every emulated directory rule (TC-2)
  ---
  duration_ms: 20.148235
  type: 'test'
  ...
# Subtest: the add-ons are blocked by the same rules, which is why only the base is submitted (TC-2)
ok 351 - the add-ons are blocked by the same rules, which is why only the base is submitted (TC-2)
  ---
  duration_ms: 16.552628
  type: 'test'
  ...
# Subtest: the committed base folder is exactly what the generator builds, also from the CLI
ok 352 - the committed base folder is exactly what the generator builds, also from the CLI
  ---
  duration_ms: 188.500087
  type: 'test'
  ...
# Subtest: the base holds only the Markdown variant: files, manifest fields, identity, the privacy page and the marketplace
ok 353 - the base holds only the Markdown variant: files, manifest fields, identity, the privacy page and the marketplace
  ---
  duration_ms: 4.462002
  type: 'test'
  ...
# Subtest: each emulated rule fires on a copy of the base that breaks it
ok 354 - each emulated rule fires on a copy of the base that breaks it
  ---
  duration_ms: 506.6344
  type: 'test'
  ...
# Subtest: more than 512 files is a problem
ok 355 - more than 512 files is a problem
  ---
  duration_ms: 66.998311
  type: 'test'
  ...
# Subtest: no file of the base is executable, starts with \#!, or is over 256 KiB
ok 356 - no file of the base is executable, starts with \#!, or is over 256 KiB
  ---
  duration_ms: 11.162865
  type: 'test'
  ...
# Subtest: base commands: the same set as the catalog, written for file editing; the add-on tools appear only under their own prefix, `if present` (TC-4)
ok 357 - base commands: the same set as the catalog, written for file editing; the add-on tools appear only under their own prefix, `if present` (TC-4)
  ---
  duration_ms: 9.903672
  type: 'test'
  ...
# Subtest: TC-4: the install commands, each alone in a bash fence, in ADD-ONS.md, ops/board.md, the board commands and the README; people run them, Claude never does
ok 358 - TC-4: the install commands, each alone in a bash fence, in ADD-ONS.md, ops/board.md, the board commands and the README; people run them, Claude never does
  ---
  duration_ms: 9.372777
  type: 'test'
  ...
# Subtest: README: over 40 words, says what it is and is not; no hard-coded command count; no claim of being in the directory; the add-ons are shown as optional
ok 359 - README: over 40 words, says what it is and is not; no hard-coded command count; no claim of being in the directory; the add-ons are shown as optional
  ---
  duration_ms: 7.969142
  type: 'test'
  ...
# Subtest: claude plugin validate --strict passes on the base folder
ok 360 - claude plugin validate --strict passes on the base folder
  ---
  duration_ms: 904.613747
  type: 'test'
  ...
# Subtest: claude plugin validate --strict passes on the laneconductor-parallel folder
ok 361 - claude plugin validate --strict passes on the laneconductor-parallel folder
  ---
  duration_ms: 878.358301
  type: 'test'
  ...
# Subtest: claude plugin validate --strict passes on the laneconductor-board folder
ok 362 - claude plugin validate --strict passes on the laneconductor-board folder
  ---
  duration_ms: 880.375074
  type: 'test'
  ...
# Subtest: claude plugin validate --strict passes on the marketplace (repo root)
ok 363 - claude plugin validate --strict passes on the marketplace (repo root)
  ---
  duration_ms: 872.259494
  type: 'test'
  ...
# Subtest: the base: at most 512 files, each under 256 KiB, no links, no junk files, no package-manager config (the package.json and lockfile are the connector's, in laneconductor-parallel)
ok 364 - the base: at most 512 files, each under 256 KiB, no links, no junk files, no package-manager config (the package.json and lockfile are the connector's, in laneconductor-parallel)
  ---
  duration_ms: 3.532719
  type: 'test'
  ...
# Subtest: laneconductor-parallel: at most 512 files, each under 256 KiB, no links, no junk files, no package-manager config (the package.json and lockfile are the connector's, in laneconductor-parallel)
ok 365 - laneconductor-parallel: at most 512 files, each under 256 KiB, no links, no junk files, no package-manager config (the package.json and lockfile are the connector's, in laneconductor-parallel)
  ---
  duration_ms: 1.923208
  type: 'test'
  ...
# Subtest: laneconductor-board: at most 512 files, each under 256 KiB, no links, no junk files, no package-manager config (the package.json and lockfile are the connector's, in laneconductor-parallel)
ok 366 - laneconductor-board: at most 512 files, each under 256 KiB, no links, no junk files, no package-manager config (the package.json and lockfile are the connector's, in laneconductor-parallel)
  ---
  duration_ms: 1.32146
  type: 'test'
  ...
# Subtest: the base: only text files (UTF-8, no NUL bytes) or images and fonts
ok 367 - the base: only text files (UTF-8, no NUL bytes) or images and fonts
  ---
  duration_ms: 9.895166
  type: 'test'
  ...
# Subtest: laneconductor-parallel: only text files (UTF-8, no NUL bytes) or images and fonts
ok 368 - laneconductor-parallel: only text files (UTF-8, no NUL bytes) or images and fonts
  ---
  duration_ms: 5.514387
  type: 'test'
  ...
# Subtest: laneconductor-board: only text files (UTF-8, no NUL bytes) or images and fonts
ok 369 - laneconductor-board: only text files (UTF-8, no NUL bytes) or images and fonts
  ---
  duration_ms: 1.893162
  type: 'test'
  ...
# Subtest: the base: no minified code (every source line is readable)
ok 370 - the base: no minified code (every source line is readable)
  ---
  duration_ms: 0.699783
  type: 'test'
  ...
# Subtest: laneconductor-parallel: no minified code (every source line is readable)
ok 371 - laneconductor-parallel: no minified code (every source line is readable)
  ---
  duration_ms: 1.826417
  type: 'test'
  ...
# Subtest: laneconductor-board: no minified code (every source line is readable)
ok 372 - laneconductor-board: no minified code (every source line is readable)
  ---
  duration_ms: 1.113639
  type: 'test'
  ...
# Subtest: the base: the secret scan is clean
ok 373 - the base: the secret scan is clean
  ---
  duration_ms: 10.119377
  type: 'test'
  ...
# Subtest: laneconductor-parallel: the secret scan is clean
ok 374 - laneconductor-parallel: the secret scan is clean
  ---
  duration_ms: 4.875488
  type: 'test'
  ...
# Subtest: laneconductor-board: the secret scan is clean
ok 375 - laneconductor-board: the secret scan is clean
  ---
  duration_ms: 4.917938
  type: 'test'
  ...
# Subtest: laneconductor-parallel .mcp.json: a local server started with node on a file inside the plugin, using only ${CLAUDE_PLUGIN_ROOT}
ok 376 - laneconductor-parallel .mcp.json: a local server started with node on a file inside the plugin, using only ${CLAUDE_PLUGIN_ROOT}
  ---
  duration_ms: 0.557887
  type: 'test'
  ...
# Subtest: version and manifest limits: semver version equal to connector/package.json for all three, valid names, no top-level bin/, no hooks directory
ok 377 - version and manifest limits: semver version equal to connector/package.json for all three, valid names, no top-level bin/, no hooks directory
  ---
  duration_ms: 0.578065
  type: 'test'
  ...
# Subtest: the add-on connector starts over stdio from a temp copy of laneconductor-parallel and answers initialize + tools/list (and a call that reads guides and conductor/ helpers)
ok 378 - the add-on connector starts over stdio from a temp copy of laneconductor-parallel and answers initialize + tools/list (and a call that reads guides and conductor/ helpers)
  ---
  duration_ms: 2050.679505
  type: 'test'
  ...
# dependencies installed via npm ci --offline
# Subtest: .gitattributes: nothing that rewrites file contents (filter, LFS, export-ignore, export-subst, text/eol)
ok 379 - .gitattributes: nothing that rewrites file contents (filter, LFS, export-ignore, export-subst, text/eol)
  ---
  duration_ms: 12.190695
  type: 'test'
  ...
# Subtest: the repository as GitHub archives it is under 50 MiB and 10,000 files
ok 380 - the repository as GitHub archives it is under 50 MiB and 10,000 files
  ---
  duration_ms: 367.959605
  type: 'test'
  ...
# git archive HEAD: 44165120 bytes = 42.12 MiB
# files in HEAD: 2571
# Subtest: TC-1: list_tracks hides done:success only; done:queue, done:failure and done:waiting stay; include_done and lane done show all
ok 381 - TC-1: list_tracks hides done:success only; done:queue, done:failure and done:waiting stay; include_done and lane done show all
  ---
  duration_ms: 551.452539
  type: 'test'
  ...
# Subtest: TC-2: the board puts done:queue, done:failure and done:waiting in Needs attention, each with its reason; done:success stays quiet
ok 382 - TC-2: the board puts done:queue, done:failure and done:waiting in Needs attention, each with its reason; done:success stays quiet
  ---
  duration_ms: 12.418451
  type: 'test'
  ...
# Subtest: TC-3: list_tracks says whether the track-N branch is merged: true, false, and nothing when there is no branch
ok 383 - TC-3: list_tracks says whether the track-N branch is merged: true, false, and nothing when there is no branch
  ---
  duration_ms: 628.698854
  type: 'test'
  ...
# Subtest: TC-3: a list with no done track does not look at branches at all
ok 384 - TC-3: a list with no done track does not look at branches at all
  ---
  duration_ms: 351.820205
  type: 'test'
  ...
# Subtest: TC-3 (review fix): a track-N branch merged by squash or by cherry-pick, not by merge commit, is merged; a different branch with the same files is not
ok 385 - TC-3 (review fix): a track-N branch merged by squash or by cherry-pick, not by merge commit, is merged; a different branch with the same files is not
  ---
  duration_ms: 697.134049
  type: 'test'
  ...
# Subtest: TC-1: Part Of and Priority are parsed into the row only when set and valid; a track that names itself or a bad value is unchanged
ok 386 - TC-1: Part Of and Priority are parsed into the row only when set and valid; a track that names itself or a bad value is unchanged
  ---
  duration_ms: 3.08568
  type: 'test'
  ...
# Subtest: TC-2: the derived table lists the children by number with lane, status, progress, a done count; nothing for a track with no children
ok 387 - TC-2: the derived table lists the children by number with lane, status, progress, a done count; nothing for a track with no children
  ---
  duration_ms: 1.878645
  type: 'test'
  ...
# Subtest: TC-3: list_tracks and get_track show the epic its children table; a child shows part_of; the epic file is never written
ok 388 - TC-3: list_tracks and get_track show the epic its children table; a child shows part_of; the epic file is never written
  ---
  duration_ms: 551.678686
  type: 'test'
  ...
# Subtest: TC-4: a child finishing edits only the child: the epic file is byte-identical, and its derived table follows
ok 389 - TC-4: a child finishing edits only the child: the epic file is byte-identical, and its derived table follows
  ---
  duration_ms: 576.695638
  type: 'test'
  ...
# Subtest: TC-5: the board data carries the derived epics and the page data the compact form; no epics, no key
ok 390 - TC-5: the board data carries the derived epics and the page data the compact form; no epics, no key
  ---
  duration_ms: 6.167643
  type: 'test'
  ...
# Subtest: a very large epic: epicTable lists the first children and says how many more; done and total still count every child
ok 391 - a very large epic: epicTable lists the first children and says how many more; done and total still count every child
  ---
  duration_ms: 4.240717
  type: 'test'
  ...
# Subtest: a very large epic keeps list_tracks and get_track under the envelope cap, with an N more note
ok 392 - a very large epic keeps list_tracks and get_track under the envelope cap, with an N more note
  ---
  duration_ms: 796.017208
  type: 'test'
  ...
# Subtest: get_track and create_track read the rows without asking git which indexes are tracked
ok 393 - get_track and create_track read the rows without asking git which indexes are tracked
  ---
  duration_ms: 7.575444
  type: 'test'
  ...
# Subtest: the S01 and S03 card at the default level is three lines: the step, one line on what it does, one pointer to `next explain`
ok 394 - the S01 and S03 card at the default level is three lines: the step, one line on what it does, one pointer to `next explain`
  ---
  duration_ms: 1.275764
  type: 'test'
  ...
# Subtest: the S02 card of an existing project shows what the analysis found and offers exactly one reply, `go`, with one clause saying what it will do
ok 395 - the S02 card of an existing project shows what the analysis found and offers exactly one reply, `go`, with one clause saying what it will do
  ---
  duration_ms: 0.753103
  type: 'test'
  ...
# Subtest: the S02 card of an existing project has no lane primer, no three-paths list, no board note, no add-ons note and no second confirmation
ok 396 - the S02 card of an existing project has no lane primer, no three-paths list, no board note, no add-ons note and no second confirmation
  ---
  duration_ms: 0.409298
  type: 'test'
  ...
# Subtest: the S02 card of a brand-new project says so and offers `go` to start the brainstorm: options and decisions first, nothing written, then the scaffold, the first tracks and the starter set
ok 397 - the S02 card of a brand-new project says so and offers `go` to start the brainstorm: options and decisions first, nothing written, then the scaffold, the first tracks and the starter set
  ---
  duration_ms: 0.616216
  type: 'test'
  ...
# Subtest: `go` is the consent: both sides say it, and nothing says setup or new-project runs "only because" they were named
ok 398 - `go` is the consent: both sides say it, and nothing says setup or new-project runs "only because" they were named
  ---
  duration_ms: 1.045282
  type: 'test'
  ...
# Subtest: the level rule: auto is the first card in S01 to S04, and only `explain` gives the full text; the code and the text agree
ok 399 - the level rule: auto is the first card in S01 to S04, and only `explain` gives the full text; the code and the text agree
  ---
  duration_ms: 0.396113
  type: 'test'
  ...
# Subtest: the explain level still has everything the first card leaves out: the primer, the three paths, the board note and the add-ons offer
ok 400 - the explain level still has everything the first card leaves out: the primer, the three paths, the board note and the add-ons offer
  ---
  duration_ms: 0.544812
  type: 'test'
  ...
# Subtest: no "say go" before a command that asks for confirmation itself, and the first card has its own reply: the card rule, the generated command and both procedure texts say so
ok 401 - no "say go" before a command that asks for confirmation itself, and the first card has its own reply: the card rule, the generated command and both procedure texts say so
  ---
  duration_ms: 0.369924
  type: 'test'
  ...
# Subtest: a number in a card comes from a command run for that purpose, never from a truncated listing: it says so, in the source and the command
ok 402 - a number in a card comes from a command run for that purpose, never from a truncated listing: it says so, in the source and the command
  ---
  duration_ms: 0.437571
  type: 'test'
  ...
# Subtest: setup writes first: no pre-write confirmation, the unusual cases still ask first, in one line each
ok 403 - setup writes first: no pre-write confirmation, the unusual cases still ask first, in one line each
  ---
  duration_ms: 1.118509
  type: 'test'
  ...
# Subtest: the closing message of setup has the parts in order: project, what it created, the declared tracks line, the plan and the filed tracks, the undo line, the commit statement, two offers, one question
ok 404 - the closing message of setup has the parts in order: project, what it created, the declared tracks line, the plan and the filed tracks, the undo line, the commit statement, two offers, one question
  ---
  duration_ms: 1.315768
  type: 'test'
  ...
# Subtest: setup files the first four plan items as tracks: through `new` (search first, then create), in the plan order, in the plan lane, the item as the problem with its file named, no question, the open questions listed; no plan, nothing filed
ok 405 - setup files the first four plan items as tracks: through `new` (search first, then create), in the plan order, in the plan lane, the item as the problem with its file named, no question, the open questions listed; no plan, nothing filed
  ---
  duration_ms: 0.52767
  type: 'test'
  ...
# Subtest: the new-project closing is the same two offers and one question, after the starter set; the starter set ends with a statement, not a second question
ok 406 - the new-project closing is the same two offers and one question, after the starter set; the starter set ends with a statement, not a second question
  ---
  duration_ms: 0.33569
  type: 'test'
  ...
# Subtest: the generated next, setup, new-project and run commands do not grow in bytes
ok 407 - the generated next, setup, new-project and run commands do not grow in bytes
  ---
  duration_ms: 2.07855
  type: 'test'
  ...
# Subtest: the S04 card has the step line, numbered suggestions with the audit last, the board line and the own-title option
ok 408 - the S04 card has the step line, numbered suggestions with the audit last, the board line and the own-title option
  ---
  duration_ms: 0.36276
  type: 'test'
  ...
# Subtest: the S04 card has no lane primer, no three-paths list and no "say go"
ok 409 - the S04 card has no lane primer, no three-paths list and no "say go"
  ---
  duration_ms: 0.300925
  type: 'test'
  ...
# Subtest: the S04 rules: at most four, only facts that were read, nothing claimed that was not checked, the audit always last, nothing created before the answer
ok 410 - the S04 rules: at most four, only facts that were read, nothing claimed that was not checked, the audit always last, nothing created before the answer
  ---
  duration_ms: 0.235652
  type: 'test'
  ...
# Subtest: the S04 board line is always the board command: it checks for its add-on itself, so the card detects nothing and shows no install line
ok 411 - the S04 board line is always the board command: it checks for its add-on itself, so the card detects nothing and shows no install line
  ---
  duration_ms: 0.235562
  type: 'test'
  ...
# Subtest: the S04 row and the explain level: the default level is the card, the explain level keeps the primer and the add-ons
ok 412 - the S04 row and the explain level: the default level is the card, the explain level keeps the primer and the add-ons
  ---
  duration_ms: 0.207619
  type: 'test'
  ...
# Subtest: one text: next, setup and new-project carry the same first-track card word for word, in the skill and in the generated commands
ok 413 - one text: next, setup and new-project carry the same first-track card word for word, in the skill and in the generated commands
  ---
  duration_ms: 0.419056
  type: 'test'
  ...
# Subtest: the closing offers only the board and the first track: no "Next: run" line, no add-ons paragraph, no starter set in setup; the card (with the board line) stays for the no-plan case
ok 414 - the closing offers only the board and the first track: no "Next: run" line, no add-ons paragraph, no starter set in setup; the card (with the board line) stays for the no-plan case
  ---
  duration_ms: 0.354214
  type: 'test'
  ...
# Subtest: a symlinked skill folder pointing outside the repo: get_context serves the bundled guides and does not fail
ok 415 - a symlinked skill folder pointing outside the repo: get_context serves the bundled guides and does not fail
  ---
  duration_ms: 432.382929
  type: 'test'
  ...
# Subtest: exactly setup, next, new-project and suggest-skills are inlined
ok 416 - exactly setup, next, new-project and suggest-skills are inlined
  ---
  duration_ms: 2.93172
  type: 'test'
  ...
# Subtest: setup carries the write-first procedure, the file rules, the permission note, newTrack and the first-track card (no starter set since 1.9.5)
ok 417 - setup carries the write-first procedure, the file rules, the permission note, newTrack and the first-track card (no starter set since 1.9.5)
  ---
  duration_ms: 1.449951
  type: 'test'
  ...
# Subtest: next carries the gather steps, every state row, the rank, the card, the levels, the front door and the transition grammar
ok 418 - next carries the gather steps, every state row, the rank, the card, the levels, the front door and the transition grammar
  ---
  duration_ms: 0.678132
  type: 'test'
  ...
# Subtest: new-project carries all six steps and the rules, with the scaffold done by hand (no search for the add-on script); an existing repository goes to setup
ok 419 - new-project carries all six steps and the rules, with the scaffold done by hand (no search for the add-on script); an existing repository goes to setup
  ---
  duration_ms: 0.399329
  type: 'test'
  ...
# Subtest: no command that carries its text tells the model to read or search a plugin folder: no plugin path, no plugin Glob, no "read the skill file", no link to a skill file
ok 420 - no command that carries its text tells the model to read or search a plugin folder: no plugin path, no plugin Glob, no "read the skill file", no link to a skill file
  ---
  duration_ms: 6.075961
  type: 'test'
  ...
# Subtest: the inlined bodies are built from the shipped skill: change the source and the command changes (no hand-written copy)
ok 421 - the inlined bodies are built from the shipped skill: change the source and the command changes (no hand-written copy)
  ---
  duration_ms: 61.834503
  type: 'test'
  ...
# Subtest: every skill file a command names is carried in the command: under Reference, or as the source of its body
ok 422 - every skill file a command names is carried in the command: under Reference, or as the source of its body
  ---
  duration_ms: 2.349639
  type: 'test'
  ...
# Subtest: each Reference carries the real text of its source: the first line of every whole file and every named section is in the command
ok 423 - each Reference carries the real text of its source: the first line of every whole file and every named section is in the command
  ---
  duration_ms: 5.594276
  type: 'test'
  ...
# Subtest: the lane commands carry their guide: plan, implement, review, quality-gate, merge, brainstorm, and run carries all five
ok 424 - the lane commands carry their guide: plan, implement, review, quality-gate, merge, brainstorm, and run carries all five
  ---
  duration_ms: 3.487664
  type: 'test'
  ...
# Subtest: the commands that need nothing from the skill stay short
ok 425 - the commands that need nothing from the skill stay short
  ---
  duration_ms: 1.014914
  type: 'test'
  ...
# Subtest: the base searches the board script only under ~/.claude/plugins/cache: an installed copy matches, a marketplace clone and the repo's own scripts do not
ok 426 - the base searches the board script only under ~/.claude/plugins/cache: an installed copy matches, a marketplace clone and the repo's own scripts do not
  ---
  duration_ms: 5.397758
  type: 'test'
  ...
# Subtest: matrix (base alone): every installed plugin validates --strict, and no two register the same command, skill or agent name (TC-3)
ok 427 - matrix (base alone): every installed plugin validates --strict, and no two register the same command, skill or agent name (TC-3)
  ---
  duration_ms: 804.424915
  type: 'test'
  ...
# Subtest: matrix (base alone): the base's board command finds the script by its Glob when the board add-on is installed, and shows the install commands when it is not (TC-4, TC-6)
ok 428 - matrix (base alone): the base's board command finds the script by its Glob when the board add-on is installed, and shows the install commands when it is not (TC-4, TC-6)
  ---
  duration_ms: 6.217667
  type: 'test'
  ...
# Subtest: matrix (base + parallel): every installed plugin validates --strict, and no two register the same command, skill or agent name (TC-3)
ok 429 - matrix (base + parallel): every installed plugin validates --strict, and no two register the same command, skill or agent name (TC-3)
  ---
  duration_ms: 1701.686226
  type: 'test'
  ...
# Subtest: matrix (base + parallel): the base's board command finds the script by its Glob when the board add-on is installed, and shows the install commands when it is not (TC-4, TC-6)
ok 430 - matrix (base + parallel): the base's board command finds the script by its Glob when the board add-on is installed, and shows the install commands when it is not (TC-4, TC-6)
  ---
  duration_ms: 6.11332
  type: 'test'
  ...
# Subtest: matrix (base + parallel): the base's tool prefix equals the add-on's real tool names, read over stdio from the running add-on server (TC-5)
ok 431 - matrix (base + parallel): the base's tool prefix equals the add-on's real tool names, read over stdio from the running add-on server (TC-5)
  ---
  duration_ms: 1625.171784
  type: 'test'
  ...
# Subtest: matrix (base + board): every installed plugin validates --strict, and no two register the same command, skill or agent name (TC-3)
ok 432 - matrix (base + board): every installed plugin validates --strict, and no two register the same command, skill or agent name (TC-3)
  ---
  duration_ms: 1613.235121
  type: 'test'
  ...
# Subtest: matrix (base + board): the base's board command finds the script by its Glob when the board add-on is installed, and shows the install commands when it is not (TC-4, TC-6)
ok 433 - matrix (base + board): the base's board command finds the script by its Glob when the board add-on is installed, and shows the install commands when it is not (TC-4, TC-6)
  ---
  duration_ms: 235.472633
  type: 'test'
  ...
# Subtest: matrix (all three): every installed plugin validates --strict, and no two register the same command, skill or agent name (TC-3)
ok 434 - matrix (all three): every installed plugin validates --strict, and no two register the same command, skill or agent name (TC-3)
  ---
  duration_ms: 2385.583991
  type: 'test'
  ...
# Subtest: matrix (all three): the base's board command finds the script by its Glob when the board add-on is installed, and shows the install commands when it is not (TC-4, TC-6)
ok 435 - matrix (all three): the base's board command finds the script by its Glob when the board add-on is installed, and shows the install commands when it is not (TC-4, TC-6)
  ---
  duration_ms: 214.409535
  type: 'test'
  ...
# Subtest: matrix (all three): the base's tool prefix equals the add-on's real tool names, read over stdio from the running add-on server (TC-5)
ok 436 - matrix (all three): the base's tool prefix equals the add-on's real tool names, read over stdio from the running add-on server (TC-5)
  ---
  duration_ms: 1286.955656
  type: 'test'
  ...
# Subtest: TC-7 over stdio from the generated add-on: an otralingo-style workflow.json (planning, in-progress) gets a suggestion, and get_track and get_context list the valid names
ok 437 - TC-7 over stdio from the generated add-on: an otralingo-style workflow.json (planning, in-progress) gets a suggestion, and get_track and get_context list the valid names
  ---
  duration_ms: 1116.015491
  type: 'test'
  ...
# Subtest: the Serves marker is in the marker table: a list of KPIs, Focus values named, advice and never a lock
ok 438 - the Serves marker is in the marker table: a list of KPIs, Focus values named, advice and never a lock
  ---
  duration_ms: 1.515664
  type: 'test'
  ...
# Subtest: the plan lane asks which KPIs a track serves, writes Serves, warns on none or only non-active, and offers to promote backlog tracks when a KPI turns active
ok 439 - the plan lane asks which KPIs a track serves, writes Serves, warns on none or only non-active, and offers to promote backlog tracks when a KPI turns active
  ---
  duration_ms: 1.021437
  type: 'test'
  ...
# Subtest: the quality gate notes a missing Serves and never fails a track for it
ok 440 - the quality gate notes a missing Serves and never fails a track for it
  ---
  duration_ms: 0.369543
  type: 'test'
  ...
# Subtest: next prefers tracks that serve an active KPI, then tracks that name none, then tracks that serve only non-active ones
ok 441 - next prefers tracks that serve an active KPI, then tracks that name none, then tracks that serve only non-active ones
  ---
  duration_ms: 0.205336
  type: 'test'
  ...
# Subtest: setup writes kpis.md with an ID and a Focus column; the scaffold and the template agree
ok 442 - setup writes kpis.md with an ID and a Focus column; the scaffold and the template agree
  ---
  duration_ms: 0.337874
  type: 'test'
  ...
# Subtest: parseKpis: ids and focus are read from their columns; an empty focus is active; other tables and placeholder rows are ignored
ok 443 - parseKpis: ids and focus are read from their columns; an empty focus is active; other tables and placeholder rows are ignored
  ---
  duration_ms: 1.962562
  type: 'test'
  ...
# Subtest: parseKpis: an old file with no Focus or ID column keeps working, every KPI active, named by its metric
ok 444 - parseKpis: an old file with no Focus or ID column keeps working, every KPI active, named by its metric
  ---
  duration_ms: 0.359234
  type: 'test'
  ...
# Subtest: servesList: comma or semicolon separated, trimmed, backticks dropped, first line only, capped
ok 445 - servesList: comma or semicolon separated, trimmed, backticks dropped, first line only, capped
  ---
  duration_ms: 2.697101
  type: 'test'
  ...
# Subtest: kpiFocus: active when any served KPI is active, future when every found one is not, unmapped when none is named or found; ids and metric names both resolve
ok 446 - kpiFocus: active when any served KPI is active, future when every found one is not, unmapped when none is named or found; ids and metric names both resolve
  ---
  duration_ms: 0.309671
  type: 'test'
  ...
# Subtest: rowOf: serves is the Serves list, present only when named
ok 447 - rowOf: serves is the Serves list, present only when named
  ---
  duration_ms: 1.64688
  type: 'test'
  ...
# Subtest: list_tracks: serves filters by an id or a metric name, any case; the rows show their serves list
ok 448 - list_tracks: serves filters by an id or a metric name, any case; the rows show their serves list
  ---
  duration_ms: 502.89048
  type: 'test'
  ...
# Subtest: nearest: the same word, a synonym group, a prefix, a typo; null when nothing is near
ok 449 - nearest: the same word, a synonym group, a prefix, a typo; null when nothing is near
  ---
  duration_ms: 2.015092
  type: 'test'
  ...
# Subtest: TC-7: update_track with `implement` or `in_progress` fails with the valid name, and nothing is written
ok 450 - TC-7: update_track with `implement` or `in_progress` fails with the valid name, and nothing is written
  ---
  duration_ms: 761.142369
  type: 'test'
  ...
# Subtest: TC-7: get_track and get_context list the valid lanes and statuses, and which lane each guide stands for
ok 451 - TC-7: get_track and get_context list the valid lanes and statuses, and which lane each guide stands for
  ---
  duration_ms: 687.471259
  type: 'test'
  ...
# Subtest: a project with the default lanes: the lane stays `plan` and the first write with the skill's names works
ok 452 - a project with the default lanes: the lane stays `plan` and the first write with the skill's names works
  ---
  duration_ms: 707.754632
  type: 'test'
  ...
# Subtest: TC-8: guards log an uncaught exception and an unhandled rejection and do not exit; every exit leaves one reason line
ok 453 - TC-8: guards log an uncaught exception and an unhandled rejection and do not exit; every exit leaves one reason line
  ---
  duration_ms: 0.808237
  type: 'test'
  ...
# Subtest: TC-8: over stdio, a tool-level error does not end the server; SIGTERM and a closed stdin each log their reason on stderr
ok 454 - TC-8: over stdio, a tool-level error does not end the server; SIGTERM and a closed stdin each log their reason on stderr
  ---
  duration_ms: 755.065602
  type: 'test'
  ...
# Subtest: skill lane guides: each lane has "Skills that help here" with its starting skills, as a suggestion
ok 455 - skill lane guides: each lane has "Skills that help here" with its starting skills, as a suggestion
  ---
  duration_ms: 1.349091
  type: 'test'
  ...
# Subtest: bundled guides: each lane has "Skills that help here" with its starting skills, as a suggestion
ok 456 - bundled guides: each lane has "Skills that help here" with its starting skills, as a suggestion
  ---
  duration_ms: 0.368051
  type: 'test'
  ...
# Subtest: generated plugin guides: each lane has "Skills that help here" with its starting skills, as a suggestion
ok 457 - generated plugin guides: each lane has "Skills that help here" with its starting skills, as a suggestion
  ---
  duration_ms: 0.351098
  type: 'test'
  ...
# Subtest: the section ends each lane guide, and the other lanes' skills are not suggested at the wrong lane
ok 458 - the section ends each lane guide, and the other lanes' skills are not suggested at the wrong lane
  ---
  duration_ms: 0.498025
  type: 'test'
  ...
# Subtest: templates.md documents the optional skills key and the default workflow.json does not carry it
ok 459 - templates.md documents the optional skills key and the default workflow.json does not carry it
  ---
  duration_ms: 0.275707
  type: 'test'
  ...
# Subtest: connector reads workflow.json without a skills key: transitions, lane names for validation, lane guide, no warning
ok 460 - connector reads workflow.json without a skills key: transitions, lane names for validation, lane guide, no warning
  ---
  duration_ms: 706.841571
  type: 'test'
  ...
# Subtest: connector reads workflow.json with a skills key: transitions, lane names for validation, lane guide, no warning
ok 461 - connector reads workflow.json with a skills key: transitions, lane names for validation, lane guide, no warning
  ---
  duration_ms: 791.369341
  type: 'test'
  ...
# Subtest: legacy parsers (mergeWorkflowConfig, stripLanePrimaryCli) accept workflow.json with and without a skills key and carry it through
ok 462 - legacy parsers (mergeWorkflowConfig, stripLanePrimaryCli) accept workflow.json with and without a skills key and carry it through
  ---
  duration_ms: 6.396783
  type: 'test'
  ...
# Subtest: TC-7 merge: plain git and gh steps, each push asked about; no worktrees command, no reconciler, no global lock
ok 463 - TC-7 merge: plain git and gh steps, each push asked about; no worktrees command, no reconciler, no global lock
  ---
  duration_ms: 1.046764
  type: 'test'
  ...
# Subtest: TC-7 SKILL.md finds a track with the Glob form and the add-on tool; quality-gate reads the KPI by hand; implement makes the worktree itself
ok 464 - TC-7 SKILL.md finds a track with the Glob form and the add-on tool; quality-gate reads the KPI by hand; implement makes the worktree itself
  ---
  duration_ms: 0.642746
  type: 'test'
  ...
# Subtest: TC-8b every marker the lane guides use is still written in the file that used it
ok 465 - TC-8b every marker the lane guides use is still written in the file that used it
  ---
  duration_ms: 0.53314
  type: 'test'
  ...
# Subtest: TC-8c the implement lane steps are consecutive after the lock steps were removed
ok 466 - TC-8c the implement lane steps are consecutive after the lock steps were removed
  ---
  duration_ms: 0.826771
  type: 'test'
  ...
# Subtest: TC-10: the reference exists in the skill source and in the generated BASE plugin, and says what it must
ok 467 - TC-10: the reference exists in the skill source and in the generated BASE plugin, and says what it must
  ---
  duration_ms: 3.111708
  type: 'test'
  ...
# Subtest: TC-10: the base plugin stays Markdown, JSON and one PNG only
ok 468 - TC-10: the base plugin stays Markdown, JSON and one PNG only
  ---
  duration_ms: 1.405056
  type: 'test'
  ...
# Subtest: TC-11: the skill index, /laneconductor:workflow and every lane guide link to the reference
ok 469 - TC-11: the skill index, /laneconductor:workflow and every lane guide link to the reference
  ---
  duration_ms: 2.06251
  type: 'test'
  ...
# Subtest: TC-11: no lane guide, command or plugin text says "done:success after implement" or computes a target from the raw file
ok 470 - TC-11: no lane guide, command or plugin text says "done:success after implement" or computes a target from the raw file
  ---
  duration_ms: 7.741095
  type: 'test'
  ...
# Subtest: TC-11: the commands that move tracks say: valid.next or outcome with the connector, track 1020's grammar without it
ok 471 - TC-11: the commands that move tracks say: valid.next or outcome with the connector, track 1020's grammar without it
  ---
  duration_ms: 0.871996
  type: 'test'
  ...
# Subtest: TC-11: this repository's guides and the plugin copies stay in step (same reference link in the source and in the generated base)
ok 472 - TC-11: this repository's guides and the plugin copies stay in step (same reference link in the source and in the generated base)
  ---
  duration_ms: 3.625783
  type: 'test'
  ...
# Subtest: a repeated header does not fold into the marker above it; the first one wins and is reported
ok 473 - a repeated header does not fold into the marker above it; the first one wins and is reported
  ---
  duration_ms: 2.350781
  type: 'test'
  ...
# Subtest: the header_damaged warning fits the 200 character bound with its final period for up to 4 repeats and long names
ok 474 - the header_damaged warning fits the 200 character bound with its final period for up to 4 repeats and long names
  ---
  duration_ms: 0.578235
  type: 'test'
  ...
# Subtest: setMarker on a damaged header edits the first one and keeps the repeats
ok 475 - setMarker on a damaged header edits the first one and keeps the repeats
  ---
  duration_ms: 0.382448
  type: 'test'
  ...
# Subtest: CRLF: markers are read and written, and the file keeps its line endings
ok 476 - CRLF: markers are read and written, and the file keeps its line endings
  ---
  duration_ms: 0.396584
  type: 'test'
  ...
# Subtest: names match case-insensitively; values of Lane and Lane Status compare lower-cased; writes use the canonical name
ok 477 - names match case-insensitively; values of Lane and Lane Status compare lower-cased; writes use the canonical name
  ---
  duration_ms: 0.321082
  type: 'test'
  ...
# Subtest: repairIndex keeps the first Lane and Lane Status, moves the repeats below a heading, and is idempotent
ok 478 - repairIndex keeps the first Lane and Lane Status, moves the repeats below a heading, and is idempotent
  ---
  duration_ms: 1.383245
  type: 'test'
  ...
# Subtest: over this repository's real indexes: no throw, a repeated header never makes a track invalid, repair leaves a clean header
ok 479 - over this repository's real indexes: no throw, a repeated header never makes a track invalid, repair leaves a clean header
  ---
  duration_ms: 34.495597
  type: 'test'
  ...
# Subtest: update_track edits a damaged index, warns header_damaged, and repair_index fixes it in one write that needs the index base
ok 480 - update_track edits a damaged index, warns header_damaged, and repair_index fixes it in one write that needs the index base
  ---
  duration_ms: 823.698166
  type: 'test'
  ...
# Subtest: parseMarkers reads the header block only, with multi-line values
ok 481 - parseMarkers reads the header block only, with multi-line values
  ---
  duration_ms: 2.25917
  type: 'test'
  ...
# Subtest: setMarker replaces one line and leaves every other byte alone
ok 482 - setMarker replaces one line and leaves every other byte alone
  ---
  duration_ms: 0.451798
  type: 'test'
  ...
# Subtest: setMarker on a multi-line marker replaces the whole extent
ok 483 - setMarker on a multi-line marker replaces the whole extent
  ---
  duration_ms: 0.332654
  type: 'test'
  ...
# Subtest: setting an absent marker inserts it after the last marker of the header block
ok 484 - setting an absent marker inserts it after the last marker of the header block
  ---
  duration_ms: 0.210595
  type: 'test'
  ...
# Subtest: setting an absent marker with no markers present goes after the title
ok 485 - setting an absent marker with no markers present goes after the title
  ---
  duration_ms: 0.254076
  type: 'test'
  ...
# Subtest: removeMarker deletes the whole extent
ok 486 - removeMarker deletes the whole extent
  ---
  duration_ms: 0.257854
  type: 'test'
  ...
# Subtest: setMarker rejects names and values that would corrupt the header block
ok 487 - setMarker rejects names and values that would corrupt the header block
  ---
  duration_ms: 0.594336
  type: 'test'
  ...
# Subtest: markerFingerprint keeps short values and hashes long ones
ok 488 - markerFingerprint keeps short values and hashes long ones
  ---
  duration_ms: 0.713879
  type: 'test'
  ...
# Subtest: validateIndex: lane and status rules (REQ-14)
ok 489 - validateIndex: lane and status rules (REQ-14)
  ---
  duration_ms: 1.997939
  type: 'test'
  ...
# Subtest: trackTitle reads the heading
ok 490 - trackTitle reads the heading
  ---
  duration_ms: 0.538851
  type: 'test'
  ...
# Subtest: detectProject reads the project name, summary, stack and the REAL commands from package.json, README and CI
ok 491 - detectProject reads the project name, summary, stack and the REAL commands from package.json, README and CI
  ---
  duration_ms: 41.817244
  type: 'test'
  ...
# Subtest: detectProject never invents a command: the npm placeholder test script, a missing lint script and a lint config alone give none
ok 492 - detectProject never invents a command: the npm placeholder test script, a missing lint script and a lint config alone give none
  ---
  duration_ms: 20.682669
  type: 'test'
  ...
# Subtest: an existing repository gets the conductor files with the detected stack and the real test command in quality-gate.md
ok 493 - an existing repository gets the conductor files with the detected stack and the real test command in quality-gate.md
  ---
  duration_ms: 51.091806
  type: 'test'
  ...
# Subtest: a second run changes nothing; an existing README, package.json, CI file and lint config are never touched
ok 494 - a second run changes nothing; an existing README, package.json, CI file and lint config are never touched
  ---
  duration_ms: 229.530643
  type: 'test'
  ...
# Subtest: files the project already has under conductor/ are kept, not replaced
ok 495 - files the project already has under conductor/ are kept, not replaced
  ---
  duration_ms: 30.350328
  type: 'test'
  ...
# Subtest: conductor/tracks from an older LaneConductor are described, never imported or changed
ok 496 - conductor/tracks from an older LaneConductor are described, never imported or changed
  ---
  duration_ms: 36.761007
  type: 'test'
  ...
# Subtest: the walking skeleton is still the default for a new project and can be turned off for an existing one
ok 497 - the walking skeleton is still the default for a new project and can be turned off for an existing one
  ---
  duration_ms: 10.885966
  type: 'test'
  ...
# Subtest: normalizeAnswers: name and summary are required, initials are checked
ok 498 - normalizeAnswers: name and summary are required, initials are checked
  ---
  duration_ms: 1.991838
  type: 'test'
  ...
# Subtest: renderScaffold: every context file exists and is tailored to the answers
ok 499 - renderScaffold: every context file exists and is tailored to the answers
  ---
  duration_ms: 1.544328
  type: 'test'
  ...
# Subtest: quality-gate.md names only the commands the answers say exist
ok 500 - quality-gate.md names only the commands the answers say exist
  ---
  duration_ms: 0.59179
  type: 'test'
  ...
# Subtest: the scaffold writes no .laneconductor.json (the settings file is optional and personal); no database, mode, collector or worker content; no daemon text anywhere
ok 501 - the scaffold writes no .laneconductor.json (the settings file is optional and personal); no database, mode, collector or worker content; no daemon text anywhere
  ---
  duration_ms: 0.577343
  type: 'test'
  ...
# Subtest: .gitignore: the three entries are added once; an existing file keeps its lines
ok 502 - .gitignore: the three entries are added once; an existing file keeps its lines
  ---
  duration_ms: 1.692616
  type: 'test'
  ...
# Subtest: firstTracks: one walking-skeleton track in the plan lane; numbering continues from existing folders; old recipe answers are ignored
ok 503 - firstTracks: one walking-skeleton track in the plan lane; numbering continues from existing folders; old recipe answers are ignored
  ---
  duration_ms: 1.656208
  type: 'test'
  ...
# Subtest: writeScaffold in a new empty folder: git init, all files, tracks, gitignore; no commit
ok 504 - writeScaffold in a new empty folder: git init, all files, tracks, gitignore; no commit
  ---
  duration_ms: 12.616463
  type: 'test'
  ...
# Subtest: writeScaffold in an existing repository adds only what is missing and never overwrites
ok 505 - writeScaffold in an existing repository adds only what is missing and never overwrites
  ---
  duration_ms: 5.00964
  type: 'test'
  ...
# Subtest: writeScaffold dry run writes nothing
ok 506 - writeScaffold dry run writes nothing
  ---
  duration_ms: 0.701697
  type: 'test'
  ...
# Subtest: lc-scaffold CLI: answers file in, JSON report out; a bad answers file exits 1 with the reason
ok 507 - lc-scaffold CLI: answers file in, JSON report out; a bad answers file exits 1 with the reason
  ---
  duration_ms: 176.515016
  type: 'test'
  ...
# Subtest: skill templates.md shows the same default workflow.json the generator writes
ok 508 - skill templates.md shows the same default workflow.json the generator writes
  ---
  duration_ms: 0.409519
  type: 'test'
  ...
# Subtest: TC-24: every fixture gives the expected state, track and command
ok 509 - TC-24: every fixture gives the expected state, track and command
  ---
  duration_ms: 5953.479807
  type: 'test'
  ...
# Subtest: TC-24: every state S01 to S23 is produced by at least one fixture, so a state cannot be added to the table without a test
ok 510 - TC-24: every state S01 to S23 is produced by at least one fixture, so a state cannot be added to the table without a test
  ---
  duration_ms: 0.299683
  type: 'test'
  ...
# Subtest: TC-25: the ranking of REQ-19, one removal at a time (human reply, failure, priority, latest lane, lower number)
ok 511 - TC-25: the ranking of REQ-19, one removal at a time (human reply, failure, priority, latest lane, lower number)
  ---
  duration_ms: 1383.187004
  type: 'test'
  ...
# Subtest: TC-26: a done:queue track is gated, not shipped: a dependent stays blocked until done:success
ok 512 - TC-26: a done:queue track is gated, not shipped: a dependent stays blocked until done:success
  ---
  duration_ms: 160.73487
  type: 'test'
  ...
# Subtest: TC-17, TC-18, TC-19: levels. auto is explain for a young project and short for a mature one; a bad or missing file means auto; arguments win
ok 513 - TC-17, TC-18, TC-19: levels. auto is explain for a young project and short for a mature one; a bad or missing file means auto; arguments win
  ---
  duration_ms: 907.09909
  type: 'test'
  ...
# Subtest: TC-21: running next in every fixture changes no tracked or untracked file
ok 514 - TC-21: running next in every fixture changes no tracked or untracked file
  ---
  duration_ms: 3597.62945
  type: 'test'
  ...
# Subtest: TC-1: ops/next.md has a table whose ids are exactly S01 to S23, once each
ok 515 - TC-1: ops/next.md has a table whose ids are exactly S01 to S23, once each
  ---
  duration_ms: 0.384642
  type: 'test'
  ...
# Subtest: TC-1/TC-24 parity: the command cell of every row holds the command shapes the reference uses, and the fixtures use only those shapes
ok 516 - TC-1/TC-24 parity: the command cell of every row holds the command shapes the reference uses, and the fixtures use only those shapes
  ---
  duration_ms: 0.692109
  type: 'test'
  ...
# Subtest: TC-2: the ranking section has six steps in the order of the rule
ok 517 - TC-2: the ranking section has six steps in the order of the rule
  ---
  duration_ms: 0.342393
  type: 'test'
  ...
# Subtest: TC-3, TC-4: SKILL.md has the next row and the Priority marker; settings.md has the next.level row
ok 518 - TC-3, TC-4: SKILL.md has the next row and the Priority marker; settings.md has the next.level row
  ---
  duration_ms: 0.419728
  type: 'test'
  ...
# Subtest: stale project-level skill: next.md and setup.md name the one sentence, the exact removal commands in their own bash blocks, and never run them
ok 519 - stale project-level skill: next.md and setup.md name the one sentence, the exact removal commands in their own bash blocks, and never run them
  ---
  duration_ms: 0.462047
  type: 'test'
  ...
# Subtest: TC-5: setup and new-project no longer end by pointing at next (they end with the board and the first track); only new-project carries the generated starter-set marker
ok 520 - TC-5: setup and new-project no longer end by pointing at next (they end with the board and the first track); only new-project carries the generated starter-set marker
  ---
  duration_ms: 0.145293
  type: 'test'
  ...
# Subtest: TC-6, TC-7: next is in the catalog once, in the first group with help, optional argument, example phrase; help lists it first
ok 521 - TC-6, TC-7: next is in the catalog once, in the first group with help, optional argument, example phrase; help lists it first
  ---
  duration_ms: 0.357712
  type: 'test'
  ...
# Subtest: TC-13: help opens with the not-sure line, in the help text, the base command and the plain list
ok 522 - TC-13: help opens with the not-sure line, in the help text, the base command and the plain list
  ---
  duration_ms: 0.14412
  type: 'test'
  ...
# Subtest: TC-8, TC-29: the generated next command is read only: it carries the argument hint, names ops/next.md and no write tool
ok 523 - TC-8, TC-29: the generated next command is read only: it carries the argument hint, names ops/next.md and no write tool
  ---
  duration_ms: 0.286387
  type: 'test'
  ...
# Subtest: TC-9, TC-10: the parallel add-on offers next as a prompt, and the plugin map lists it for the base and the add-on; the build is current
ok 524 - TC-9, TC-10: the parallel add-on offers next as a prompt, and the plugin map lists it for the base and the add-on; the build is current
  ---
  duration_ms: 32.67822
  type: 'test'
  ...
# Subtest: TC-11, TC-12: the recommendation block in ops/next.md is the setup block for the add-ons, from the one catalog, with their commands and the one-line add-ons install in its own bash block
ok 525 - TC-11, TC-12: the recommendation block in ops/next.md is the setup block for the add-ons, from the one catalog, with their commands and the one-line add-ons install in its own bash block
  ---
  duration_ms: 29.316211
  type: 'test'
  ...
# Subtest: TC-14, TC-15: the habits carry the two edits; the server instructions point to next and stay under the limit
ok 526 - TC-14, TC-15: the habits carry the two edits; the server instructions point to next and stay under the limit
  ---
  duration_ms: 0.210185
  type: 'test'
  ...
# Subtest: TC-16: the new, bug and feature procedures and create_track are untouched by this feature
ok 527 - TC-16: the new, bug and feature procedures and create_track are untouched by this feature
  ---
  duration_ms: 0.179737
  type: 'test'
  ...
# Subtest: TC-3.4: status ends by pointing at next, in the catalog and in the base command
ok 528 - TC-3.4: status ends by pointing at next, in the catalog and in the base command
  ---
  duration_ms: 0.109565
  type: 'test'
  ...
# Subtest: TC-22, TC-23: the journey block is generated into the base README, once, and says nothing about unshipped work (a hand edit fails the drift check of plugin-build.test.mjs)
ok 529 - TC-22, TC-23: the journey block is generated into the base README, once, and says nothing about unshipped work (a hand edit fails the drift check of plugin-build.test.mjs)
  ---
  duration_ms: 0.888116
  type: 'test'
  ...
# Subtest: TC-27, TC-30: ops/next.md, the next command, the help line and the journey block pass the text rules
ok 530 - TC-27, TC-30: ops/next.md, the next command, the help line and the journey block pass the text rules
  ---
  duration_ms: 2.191702
  type: 'test'
  ...
# Subtest: TC-28: the base stays Markdown, JSON and one image: this feature adds only Markdown files
ok 531 - TC-28: the base stays Markdown, JSON and one image: this feature adds only Markdown files
  ---
  duration_ms: 12.839032
  type: 'test'
  ...
# Subtest: the NAMES used by the journey are the base plugin name
ok 532 - the NAMES used by the journey are the base plugin name
  ---
  duration_ms: 0.121207
  type: 'test'
  ...
# Subtest: the base plugin's commands/ and skills/ name no track number, except the example id of the help phrases (track 10106)
ok 533 - the base plugin's commands/ and skills/ name no track number, except the example id of the help phrases (track 10106)
  ---
  duration_ms: 1.728574
  type: 'test'
  ...
# Subtest: the generated next command card points at the lane reference in words, never at a plain file path
ok 534 - the generated next command card points at the lane reference in words, never at a plain file path
  ---
  duration_ms: 0.246011
  type: 'test'
  ...
# Subtest: first run: S02 and S03 (explain level) say, once and only when the board add-on is installed, that the board shows the same step; S04 and the close of setup say it in the first-track card
ok 535 - first run: S02 and S03 (explain level) say, once and only when the board add-on is installed, that the board shows the same step; S04 and the close of setup say it in the first-track card
  ---
  duration_ms: 13.516434
  type: 'test'
  ...
# Subtest: the pattern: it catches an lc subcommand, which lc, make install and the daemon scripts, and lets the script names and the MCP key through
ok 536 - the pattern: it catches an lc subcommand, which lc, make install and the daemon scripts, and lets the script names and the MCP key through
  ---
  duration_ms: 2.333549
  type: 'test'
  ...
# Subtest: the three generated plugins on disk, the same three built in memory, and the source skill (without legacy/) name no lc command
ok 537 - the three generated plugins on disk, the same three built in memory, and the source skill (without legacy/) name no lc command
  ---
  duration_ms: 145.121312
  type: 'test'
  ...
# Subtest: the generator, the catalog, the command catalog, the connector and its docs, the root README and the docs name no lc command
ok 538 - the generator, the catalog, the command catalog, the connector and its docs, the root README and the docs name no lc command
  ---
  duration_ms: 10.940959
  type: 'test'
  ...
# Subtest: the settings file is named only where the base explains it: ops/settings.md, the board texts, the next procedure, the README and the skill pointer; never by setup
ok 539 - the settings file is named only where the base explains it: ops/settings.md, the board texts, the next procedure, the README and the skill pointer; never by setup
  ---
  duration_ms: 5.052761
  type: 'test'
  ...
# Subtest: the Glob the source skill gives for the board script and the scaffold script is the one the generator names
ok 540 - the Glob the source skill gives for the board script and the scaffold script is the one the generator names
  ---
  duration_ms: 0.549842
  type: 'test'
  ...
# Subtest: 14.1: supervised implement sets Lane Status waiting with Waiting for reply, after Owner Action and its due date; the Owner Action is the reason, the lane stays implement
ok 541 - 14.1: supervised implement sets Lane Status waiting with Waiting for reply, after Owner Action and its due date; the Owner Action is the reason, the lane stays implement
  ---
  duration_ms: 1.307493
  type: 'test'
  ...
# Subtest: 14.1: the owner's reply still clears all three markers and parks the track in the quality gate, so the whole cycle is implement:waiting, then quality-gate:waiting
ok 542 - 14.1: the owner's reply still clears all three markers and parks the track in the quality gate, so the whole cycle is implement:waiting, then quality-gate:waiting
  ---
  duration_ms: 0.365005
  type: 'test'
  ...
# Subtest: 14.1: implement, run and comment carry the waiting step once; the reply text stays in exactly the same three commands
ok 543 - 14.1: implement, run and comment carry the waiting step once; the reply text stays in exactly the same three commands
  ---
  duration_ms: 0.722636
  type: 'test'
  ...
# Subtest: 14.1: the shape supervised implement writes is S22 "do the owner action" for next, and a track left running is not
ok 544 - 14.1: the shape supervised implement writes is S22 "do the owner action" for next, and a track left running is not
  ---
  duration_ms: 226.055044
  type: 'test'
  ...
# Subtest: 14.1: with the connector, one update_track that writes Owner Action and Lane Status waiting gets no Waiting Reason warning
ok 545 - 14.1: with the connector, one update_track that writes Owner Action and Lane Status waiting gets no Waiting Reason warning
  ---
  duration_ms: 546.419005
  type: 'test'
  ...
# Subtest: 14.1: the bundled connector guide says the same in one line
ok 546 - 14.1: the bundled connector guide says the same in one line
  ---
  duration_ms: 0.472467
  type: 'test'
  ...
# Subtest: 14.2: implement, review and run say first that a non-dev track gets no sub-agent, no worktree and no question, then dispatch for code tracks only
ok 547 - 14.2: implement, review and run say first that a non-dev track gets no sub-agent, no worktree and no question, then dispatch for code tracks only
  ---
  duration_ms: 1.667108
  type: 'test'
  ...
# Subtest: 14.2: the code-track dispatch: the prompt is unchanged, typing the command is the yes, do the lane yourself on a request to do it here
ok 548 - 14.2: the code-track dispatch: the prompt is unchanged, typing the command is the yes, do the lane yourself on a request to do it here
  ---
  duration_ms: 0.631705
  type: 'test'
  ...
# Subtest: 14.2: the connector catalog (MCP prompts) gates the same way for implement, review and run, and skips the dispatch steps for a non-dev track
ok 549 - 14.2: the connector catalog (MCP prompts) gates the same way for implement, review and run, and skips the dispatch steps for a non-dev track
  ---
  duration_ms: 0.525105
  type: 'test'
  ...
# Subtest: 14.2: the descriptions say the recommendation is for code tracks
ok 550 - 14.2: the descriptions say the recommendation is for code tracks
  ---
  duration_ms: 1.013071
  type: 'test'
  ...
# Subtest: 14.2: the working-a-track guide limits the sub-agent section to code tracks, and the lane guide needs no worktree for a non-dev track
ok 551 - 14.2: the working-a-track guide limits the sub-agent section to code tracks, and the lane guide needs no worktree for a non-dev track
  ---
  duration_ms: 8.299042
  type: 'test'
  ...
# Subtest: 14.2: next recommends the sub-agent for a code track only, and a non-dev track is implemented in this session
ok 552 - 14.2: next recommends the sub-agent for a code track only, and a non-dev track is implemented in this session
  ---
  duration_ms: 0.626866
  type: 'test'
  ...
# Subtest: 14.3: the quality gate closes a passing non-dev track as done:success (nothing to merge) and keeps done:queue for code tracks
ok 553 - 14.3: the quality gate closes a passing non-dev track as done:success (nothing to merge) and keeps done:queue for code tracks
  ---
  duration_ms: 0.741952
  type: 'test'
  ...
# Subtest: 14.3: the merge guide says a non-dev track has nothing to merge (an older done:queue is recorded done:success), and `next` says the same in S11
ok 554 - 14.3: the merge guide says a non-dev track has nothing to merge (an older done:queue is recorded done:success), and `next` says the same in S11
  ---
  duration_ms: 0.997783
  type: 'test'
  ...
# Subtest: 14.3: the bundled connector guide says a non-dev pass closes done:success with markers
ok 555 - 14.3: the bundled connector guide says a non-dev pass closes done:success with markers
  ---
  duration_ms: 0.179136
  type: 'test'
  ...
# Subtest: 14.3: a non-dev track at done:success with a Result is finished for next and is not flagged outcome_missing; without Result or KPI Actual it is, as before
ok 556 - 14.3: a non-dev track at done:success with a Result is finished for next and is not flagged outcome_missing; without Result or KPI Actual it is, as before
  ---
  duration_ms: 442.069
  type: 'test'
  ...
# Subtest: no generated command is larger than in 1.9.7; run stays under 68 KB
ok 557 - no generated command is larger than in 1.9.7; run stays under 68 KB
  ---
  duration_ms: 2.13713
  type: 'test'
  ...
# Subtest: the catalog names the plugins of each line, and addons_install is exactly the add-on entries
ok 558 - the catalog names the plugins of each line, and addons_install is exactly the add-on entries
  ---
  duration_ms: 1.607416
  type: 'test'
  ...
# Subtest: the two lines are built only from catalog names and the marketplace, as exactly the expected `claude plugin ...` segments joined by &&
ok 559 - the two lines are built only from catalog names and the marketplace, as exactly the expected `claude plugin ...` segments joined by &&
  ---
  duration_ms: 0.486433
  type: 'test'
  ...
# Subtest: the shared setup/next block carries addons_install alone in its own bash fence, introduced by one sentence, and never as a command to run
ok 560 - the shared setup/next block carries addons_install alone in its own bash fence, introduced by one sentence, and never as a command to run
  ---
  duration_ms: 0.995057
  type: 'test'
  ...
# Subtest: the block is for the case where BOTH add-ons are missing; with one add-on the offer is the single one and adds nothing
ok 561 - the block is for the case where BOTH add-ons are missing; with one add-on the offer is the single one and adds nothing
  ---
  duration_ms: 0.395863
  type: 'test'
  ...
# Subtest: the generated texts carry the block: new-project (the starter set), and next (the front door points at the one line of its first-track card, written once)
ok 562 - the generated texts carry the block: new-project (the starter set), and next (the front door points at the one line of its first-track card, written once)
  ---
  duration_ms: 0.951616
  type: 'test'
  ...
# Subtest: the READMEs of the three plugins, the connector README and the root README carry full_install as "The full version in one line"
ok 563 - the READMEs of the three plugins, the connector README and the root README carry full_install as "The full version in one line"
  ---
  duration_ms: 2.067179
  type: 'test'
  ...
# Subtest: the base stays Markdown-only and free of daemon-era words, with the new text in it
ok 564 - the base stays Markdown-only and free of daemon-era words, with the new text in it
  ---
  duration_ms: 45.742219
  type: 'test'
  ...
# Subtest: the update one-liner is built from the same bundle, updates every plugin of the full version, and is in the root README
ok 565 - the update one-liner is built from the same bundle, updates every plugin of the full version, and is in the root README
  ---
  duration_ms: 0.27704
  type: 'test'
  ...
# Subtest: TC-15: supervised implement writes Owner Action and Owner Action Due before Waiting for reply, and says nothing is done for the owner
ok 566 - TC-15: supervised implement writes Owner Action and Owner Action Due before Waiting for reply, and says nothing is done for the owner
  ---
  duration_ms: 1.467374
  type: 'test'
  ...
# Subtest: TC-15: the owner's reply is handled without a daemon: clear both markers and the reply flag, set KPI Check After, park in the quality gate with a Waiting Reason
ok 567 - TC-15: the owner's reply is handled without a daemon: clear both markers and the reply flag, set KPI Check After, park in the quality gate with a Waiting Reason
  ---
  duration_ms: 0.422984
  type: 'test'
  ...
# Subtest: TC-15: the reply text is written once in the base source; only implement, run and comment carry it
ok 568 - TC-15: the reply text is written once in the base source; only implement, run and comment carry it
  ---
  duration_ms: 4.552843
  type: 'test'
  ...
# Subtest: TC-15: the comment command applies the reply handling when the track has an Owner Action, and behaves as before when it has none
ok 569 - TC-15: the comment command applies the reply handling when the track has an Owner Action, and behaves as before when it has none
  ---
  duration_ms: 0.549121
  type: 'test'
  ...
# Subtest: TC-15: move says in one short line that leaving waiting clears the owner markers
ok 570 - TC-15: move says in one short line that leaving waiting clears the owner markers
  ---
  duration_ms: 0.317195
  type: 'test'
  ...
# Subtest: TC-16: the quality gate writes Result and a history line after its KPI step, applies the kill rule, never invents a number
ok 571 - TC-16: the quality gate writes Result and a history line after its KPI step, applies the kill rule, never invents a number
  ---
  duration_ms: 0.586881
  type: 'test'
  ...
# Subtest: TC-16: the plan guide has one optional Kill rule line in the KPI block, and nothing else new there
ok 572 - TC-16: the plan guide has one optional Kill rule line in the KPI block, and nothing else new there
  ---
  duration_ms: 0.300033
  type: 'test'
  ...
# Subtest: TC-17: no new heading in the three guides, no new skill file, no campaign template, channel kit or readout format in the base
ok 573 - TC-17: no new heading in the three guides, no new skill file, no campaign template, channel kit or readout format in the base
  ---
  duration_ms: 1.576017
  type: 'test'
  ...
# Subtest: TC-17: the added text is merged into the existing steps; the affected commands grew by a small, recorded amount and stay inside the limits
ok 574 - TC-17: the added text is merged into the existing steps; the affected commands grew by a small, recorded amount and stay inside the limits
  ---
  duration_ms: 2.761902
  type: 'test'
  ...
# Subtest: TC-18: the base says once that the lint, the computed flags and the board need the connector or the board add-on, and that without them the markers are by hand
ok 575 - TC-18: the base says once that the lint, the computed flags and the board need the connector or the board add-on, and that without them the markers are by hand
  ---
  duration_ms: 7.097447
  type: 'test'
  ...
# Subtest: TC-8: the state table has 23 states; S22 and S23 have shapes and a command
ok 576 - TC-8: the state table has 23 states; S22 and S23 have shapes and a command
  ---
  duration_ms: 1.545089
  type: 'test'
  ...
# Subtest: TC-8: a waiting track with an owner action is its own state, ahead of S05; the card names the action, the due day and the Draft pointer, never the S05 text
ok 577 - TC-8: a waiting track with an owner action is its own state, ahead of S05; the card names the action, the due day and the Draft pointer, never the S05 text
  ---
  duration_ms: 209.136568
  type: 'test'
  ...
# Subtest: TC-8: S22 comes before a genuine reply (S05), then failures; overdue first, then oldest due; a missing or malformed due day last, with the reason
ok 578 - TC-8: S22 comes before a genuine reply (S05), then failures; overdue first, then oldest due; a missing or malformed due day last, with the reason
  ---
  duration_ms: 618.234128
  type: 'test'
  ...
# Subtest: TC-8: the owner action state is also shown as a short row in the "also" list
ok 579 - TC-8: the owner action state is also shown as a short row in the "also" list
  ---
  duration_ms: 102.023405
  type: 'test'
  ...
# Subtest: TC-9: a waiting track past KPI Check After is offered as a measurement with /laneconductor:quality-gate N
ok 580 - TC-9: a waiting track past KPI Check After is offered as a measurement with /laneconductor:quality-gate N
  ---
  duration_ms: 1304.447437
  type: 'test'
  ...
# Subtest: TC-10: more than two open owner actions add one line of advice; two or fewer add nothing; the advice never changes the order
ok 581 - TC-10: more than two open owner actions add one line of advice; two or fewer add nothing; the advice never changes the order
  ---
  duration_ms: 608.873958
  type: 'test'
  ...
# Subtest: TC-10: Priority, a met and an unmet Depends On, S09 (resume), done:waiting and an epic
ok 582 - TC-10: Priority, a met and an unmet Depends On, S09 (resume), done:waiting and an epic
  ---
  duration_ms: 630.544605
  type: 'test'
  ...
# Subtest: TC-1: a project with none of the markers is ranked exactly as before, and carries no advice
ok 583 - TC-1: a project with none of the markers is ranked exactly as before, and carries no advice
  ---
  duration_ms: 256.605466
  type: 'test'
  ...
# Subtest: TC-11: ops/next.md has the S22 and S23 rows with the commands of the code, and the rank section names them and the advice line
ok 584 - TC-11: ops/next.md has the S22 and S23 rows with the commands of the code, and the rank section names them and the advice line
  ---
  duration_ms: 0.728748
  type: 'test'
  ...
# Subtest: TC-11: an agent without the connector is told to compare dates with today's date, in UTC, and to ask when it does not know it
ok 585 - TC-11: an agent without the connector is told to compare dates with today's date, in UTC, and to ask when it does not know it
  ---
  duration_ms: 0.533581
  type: 'test'
  ...
# Subtest: TC-11: the generated base carries the same table and the same step, and the next command is still read only
ok 586 - TC-11: the generated base carries the same table and the same step, and the next command is still read only
  ---
  duration_ms: 2.793041
  type: 'test'
  ...
# Subtest: TC-1: a track with none of the new markers has none of the new fields
ok 587 - TC-1: a track with none of the new markers has none of the new fields
  ---
  duration_ms: 7.695079
  type: 'test'
  ...
# Subtest: TC-2: names are read case-insensitively (a hand-typed name too), CRLF files read like LF files, the first match wins
ok 588 - TC-2: names are read case-insensitively (a hand-typed name too), CRLF files read like LF files, the first match wins
  ---
  duration_ms: 1.473215
  type: 'test'
  ...
# Subtest: TC-2: update_track sets and removes the three markers; a value over 200 characters is shortened in listings, the full text is in get_track
ok 589 - TC-2: update_track sets and removes the three markers; a value over 200 characters is shortened in listings, the full text is in get_track
  ---
  duration_ms: 729.386744
  type: 'test'
  ...
# Subtest: TC-4: strict days: a real YYYY-MM-DD and nothing else
ok 590 - TC-4: strict days: a real YYYY-MM-DD and nothing else
  ---
  duration_ms: 0.366077
  type: 'test'
  ...
# Subtest: TC-4: KPI Check After is a day or a full UTC timestamp (what the quality gate has written), nothing looser
ok 591 - TC-4: KPI Check After is a day or a full UTC timestamp (what the quality gate has written), nothing looser
  ---
  duration_ms: 0.601759
  type: 'test'
  ...
# Subtest: TC-3, TC-4: date_malformed names the marker and the value as written, never a guess, and sets no flag
ok 592 - TC-3, TC-4: date_malformed names the marker and the value as written, never a guess, and sets no flag
  ---
  duration_ms: 1.916496
  type: 'test'
  ...
# Subtest: TC-3, TC-4: overdue and ready_to_measure with a fixed clock: the boundaries
ok 593 - TC-3, TC-4: overdue and ready_to_measure with a fixed clock: the boundaries
  ---
  duration_ms: 1.308254
  type: 'test'
  ...
# Subtest: TC-3: list_tracks and get_track carry the flags (UTC, ctx.now) and omit them when unset
ok 594 - TC-3: list_tracks and get_track carry the flags (UTC, ctx.now) and omit them when unset
  ---
  duration_ms: 321.85321
  type: 'test'
  ...
# Subtest: TC-5: outcome_missing: marketing or sales at done:success with a KPI block and neither KPI Actual nor Result
ok 595 - TC-5: outcome_missing: marketing or sales at done:success with a KPI block and neither KPI Actual nor Result
  ---
  duration_ms: 2.207542
  type: 'test'
  ...
# Subtest: TC-5: outcome_missing reaches list_tracks and the generated summary as a warning, and never blocks a write
ok 596 - TC-5: outcome_missing reaches list_tracks and the generated summary as a warning, and never blocks a write
  ---
  duration_ms: 617.660359
  type: 'test'
  ...
# Subtest: TC-5: get_track warns date_malformed and outcome_missing for the track it reads
ok 597 - TC-5: get_track warns date_malformed and outcome_missing for the track it reads
  ---
  duration_ms: 232.805454
  type: 'test'
  ...
# Subtest: TC-6: an Owner Action satisfies the waiting lint; a blank one does not; the dependency state does not call it ready to resume
ok 598 - TC-6: an Owner Action satisfies the waiting lint; a blank one does not; the dependency state does not call it ready to resume
  ---
  duration_ms: 0.910319
  type: 'test'
  ...
# Subtest: TC-7: no new tool and no description mentions the owner markers; the context estimate is the one of the shipped tool list
ok 599 - TC-7: no new tool and no description mentions the owner markers; the context estimate is the one of the shipped tool list
  ---
  duration_ms: 0.280587
  type: 'test'
  ...
# (node:2218910) ExperimentalWarning: The MockTimers API is an experimental feature and might change at any time
# (Use `node --trace-warnings ...` to show where the warning was created)
# Subtest: TC-7: ten tracks whose three markers are 200 characters long: list_tracks and get_track stay inside the response budget
ok 600 - TC-7: ten tracks whose three markers are 200 characters long: list_tracks and get_track stay inside the response budget
  ---
  duration_ms: 178.162342
  type: 'test'
  ...
# Subtest: TC-7: rowOf and generateSummary hold no clock: the same entries give the same text on any day, and checkSummary does not churn from one day to the next
ok 601 - TC-7: rowOf and generateSummary hold no clock: the same entries give the same text on any day, and checkSummary does not churn from one day to the next
  ---
  duration_ms: 1.927637
  type: 'test'
  ...
# Subtest: TC-2: dependency state: unmet, unknown, met, Waiting On Tracks, waiting-for-reply, done lane
ok 602 - TC-2: dependency state: unmet, unknown, met, Waiting On Tracks, waiting-for-reply, done lane
  ---
  duration_ms: 2.620998
  type: 'test'
  ...
# Subtest: TC-3: list_tracks, get_track and get_context show blocked_by and ready_to_resume
ok 603 - TC-3: list_tracks, get_track and get_context show blocked_by and ready_to_resume
  ---
  duration_ms: 522.183882
  type: 'test'
  ...
# Subtest: TC-3: with nothing to resume the list and the context carry no ready_to_resume field
ok 604 - TC-3: with nothing to resume the list and the context carry no ready_to_resume field
  ---
  duration_ms: 440.945222
  type: 'test'
  ...
# Subtest: TC-4: create_track refuses a dependency on a track that does not exist, and writes nothing
ok 605 - TC-4: create_track refuses a dependency on a track that does not exist, and writes nothing
  ---
  duration_ms: 696.922625
  type: 'test'
  ...
# Subtest: TC-5: setting a status other than waiting takes the parking markers off; waiting keeps them; the caller may set them
ok 606 - TC-5: setting a status other than waiting takes the parking markers off; waiting keeps them; the caller may set them
  ---
  duration_ms: 1921.97458
  type: 'test'
  ...
# Subtest: TC-6: a track becoming waiting without a Waiting Reason gets a warning; with one, none
ok 607 - TC-6: a track becoming waiting without a Waiting Reason gets a warning; with one, none
  ---
  duration_ms: 678.277438
  type: 'test'
  ...
# Subtest: TC-6: the summary lists a waiting track with no Waiting Reason under Needs attention (a done:waiting PR is not a park)
ok 608 - TC-6: the summary lists a waiting track with no Waiting Reason under Needs attention (a done:waiting PR is not a park)
  ---
  duration_ms: 3.564549
  type: 'test'
  ...
# Subtest: TC-7: claiming a track whose dependencies are not done:success warns; with them met, no warning
ok 609 - TC-7: claiming a track whose dependencies are not done:success warns; with them met, no warning
  ---
  duration_ms: 590.261817
  type: 'test'
  ...
# Subtest: TC-1 (regression): the skill no longer says a reconciler resumes a track; it says who does and how
ok 610 - TC-1 (regression): the skill no longer says a reconciler resumes a track; it says who does and how
  ---
  duration_ms: 5.250883
  type: 'test'
  ...
# Subtest: the README, setup, new-project and the setup command carry the one-line note: choose the one-time option, the permanent ones are not needed
ok 611 - the README, setup, new-project and the setup command carry the one-line note: choose the one-time option, the permanent ones are not needed
  ---
  duration_ms: 1.237793
  type: 'test'
  ...
# Subtest: the setup flow writes first: no pre-write confirmation, ONE closing message with the private tracks line and an undo line, a question only for something unusual
ok 612 - the setup flow writes first: no pre-write confirmation, ONE closing message with the private tracks line and an undo line, a question only for something unusual
  ---
  duration_ms: 0.572584
  type: 'test'
  ...
# Subtest: no shipped skill or command declares allowed-tools (evaluated, not shipped)
ok 613 - no shipped skill or command declares allowed-tools (evaluated, not shipped)
  ---
  duration_ms: 2.242178
  type: 'test'
  ...
# Subtest: planItems: the unticked checkboxes in the plan's own order, the ticked and done ones left out, the open decision a question and not an item
ok 614 - planItems: the unticked checkboxes in the plan's own order, the ticked and done ones left out, the open decision a question and not an item
  ---
  duration_ms: 2.486856
  type: 'test'
  ...
# Subtest: planItems: without checkboxes it takes the bullets, then the \#\#\# headings; a plan with nothing yields no item (nothing is invented)
ok 615 - planItems: without checkboxes it takes the bullets, then the \#\#\# headings; a plan with nothing yields no item (nothing is invented)
  ---
  duration_ms: 0.393509
  type: 'test'
  ...
# Subtest: planCoverage: an item that is in a track is `has`, a half match is `maybe` ("may already be a track"), the rest `none`; conservative
ok 616 - planCoverage: an item that is in a track is `has`, a half match is `maybe` ("may already be a track"), the rest `none`; conservative
  ---
  duration_ms: 0.492825
  type: 'test'
  ...
# Subtest: the S04 card leads with the plan items, names the source file, caps at four with "N more in <file>", and shows the open question after them
ok 617 - the S04 card leads with the plan items, names the source file, caps at four with "N more in <file>", and shows the open question after them
  ---
  duration_ms: 0.430387
  type: 'test'
  ...
# Subtest: the generic items come after the plan items, only when the plan does not say them, at most two, and the audit is always last
ok 618 - the generic items come after the plan items, only when the plan does not say them, at most two, and the audit is always last
  ---
  duration_ms: 0.332814
  type: 'test'
  ...
# Subtest: a project with no plan gets today's generic list; nothing is invented
ok 619 - a project with no plan gets today's generic list; nothing is invented
  ---
  duration_ms: 0.221596
  type: 'test'
  ...
# Subtest: "file all N" and numbers: the existing `new` procedure (search first), in the plan's order, in the plan lane, the plan item as the problem with its source named; nothing before the answer
ok 620 - "file all N" and numbers: the existing `new` procedure (search first), in the plan's order, in the plan lane, the plan item as the problem with its source named; nothing before the answer
  ---
  duration_ms: 0.25557
  type: 'test'
  ...
# Subtest: one text: next, setup and new-project carry the same card, and the shipped copies lead with the plan too
ok 621 - one text: next, setup and new-project carry the same card, and the shipped copies lead with the plan too
  ---
  duration_ms: 0.41027
  type: 'test'
  ...
# Subtest: setup says in one line what plan it found and what it filed, and nothing when there is none; the closing message stays short
ok 622 - setup says in one line what plan it found and what it filed, and nothing when there is none; the closing message stays short
  ---
  duration_ms: 0.515348
  type: 'test'
  ...
# Subtest: later on, S20 offers the plan items that have no track yet, as the same card, conservatively, text first
ok 623 - later on, S20 offers the plan items that have no track yet, as the same card, conservatively, text first
  ---
  duration_ms: 0.711134
  type: 'test'
  ...
# Subtest: an empty git repository is S02 with new-project as the command (the classifier and the board), and the texts say so
ok 624 - an empty git repository is S02 with new-project as the command (the classifier and the board), and the texts say so
  ---
  duration_ms: 97.707105
  type: 'test'
  ...
# Subtest: the new-project interview is a brainstorm: options and decisions are explored before a file is written, and it ends with the same card and one question
ok 625 - the new-project interview is a brainstorm: options and decisions are explored before a file is written, and it ends with the same card and one question
  ---
  duration_ms: 0.405982
  type: 'test'
  ...
# Subtest: a repository with no upstream, or a rebuilt summary, is not a stale line in next: the text, the line the connector composes, the instructions
ok 626 - a repository with no upstream, or a rebuilt summary, is not a stale line in next: the text, the line the connector composes, the instructions
  ---
  duration_ms: 0.723998
  type: 'test'
  ...
# Subtest: the generated next, setup, new-project and run commands are no bigger than before this change (bytes)
ok 627 - the generated next, setup, new-project and run commands are no bigger than before this change (bytes)
  ---
  duration_ms: 1.241069
  type: 'test'
  ...
# Subtest: regenerating gives byte-identical output (no drift) and is deterministic
ok 628 - regenerating gives byte-identical output (no drift) and is deterministic
  ---
  duration_ms: 236.089512
  type: 'test'
  ...
# Subtest: TC-1: --check exits 1 and names the file when any of the three plugins, the marketplace file or the plugin map has drifted
ok 629 - TC-1: --check exits 1 and names the file when any of the three plugins, the marketplace file or the plugin map has drifted
  ---
  duration_ms: 116.94376
  type: 'test'
  ...
# Subtest: TC-1: marketplace lists the base, then the two add-ons; each entry names its manifest; versions are one semver and follow connector/package.json
ok 630 - TC-1: marketplace lists the base, then the two add-ons; each entry names its manifest; versions are one semver and follow connector/package.json
  ---
  duration_ms: 1.147763
  type: 'test'
  ...
# Subtest: the parallel add-on declares one local server, key lc, started with node on a file it ships; the base and the board declare none
ok 631 - the parallel add-on declares one local server, key lc, started with node on a file it ships; the base and the board declare none
  ---
  duration_ms: 0.50615
  type: 'test'
  ...
# Subtest: listing: each README has its words, LICENSE, the install commands (one per bash block) and the migration note; no command count; no placeholder
ok 632 - listing: each README has its words, LICENSE, the install commands (one per bash block) and the migration note; no command count; no placeholder
  ---
  duration_ms: 5.674367
  type: 'test'
  ...
# Subtest: no top-level bin/ in any plugin, no symlinks, no node_modules committed
ok 633 - no top-level bin/ in any plugin, no symlinks, no node_modules committed
  ---
  duration_ms: 6.408054
  type: 'test'
  ...
# Subtest: parallel package.json and lockfile: registry-only exact pins, lockfile v2/3, no scripts or overrides
ok 634 - parallel package.json and lockfile: registry-only exact pins, lockfile v2/3, no scripts or overrides
  ---
  duration_ms: 0.712858
  type: 'test'
  ...
# Subtest: REQ-12-style secret scan over the three plugin directories
ok 635 - REQ-12-style secret scan over the three plugin directories
  ---
  duration_ms: 19.205807
  type: 'test'
  ...
# Subtest: skill: frontmatter fits the listing budget and every relative link resolves inside the plugin
ok 636 - skill: frontmatter fits the listing budget and every relative link resolves inside the plugin
  ---
  duration_ms: 1.014514
  type: 'test'
  ...
# Subtest: skill: the parked legacy tier is not shipped and nothing points at it
ok 637 - skill: the parked legacy tier is not shipped and nothing points at it
  ---
  duration_ms: 14.01121
  type: 'test'
  ...
# Subtest: skill: no database or cloud-service tooling in SKILL.md, lanes/ or ops/; setup/ and deploy/ stay tame
ok 638 - skill: no database or cloud-service tooling in SKILL.md, lanes/ or ops/; setup/ and deploy/ stay tame
  ---
  duration_ms: 2.991873
  type: 'test'
  ...
# Subtest: skill transform: explicit edits, and a missing anchor fails the build
ok 639 - skill transform: explicit edits, and a missing anchor fails the build
  ---
  duration_ms: 2.225736
  type: 'test'
  ...
# Subtest: skill: allowed-tools is deleted, Habits and the add-on pointer are appended, the source skill is untouched
ok 640 - skill: allowed-tools is deleted, Habits and the add-on pointer are appended, the source skill is untouched
  ---
  duration_ms: 0.544592
  type: 'test'
  ...
# Subtest: removeFrontmatterKey deletes exactly one key and fails loudly when it is gone
ok 641 - removeFrontmatterKey deletes exactly one key and fails loudly when it is gone
  ---
  duration_ms: 0.278462
  type: 'test'
  ...
# Subtest: skill path audit: no hard-coded project or machine paths outside the setup docs
ok 642 - skill path audit: no hard-coded project or machine paths outside the setup docs
  ---
  duration_ms: 1.142173
  type: 'test'
  ...
# Subtest: the install commands are one source: installCommands() and the marketplace add command
ok 643 - the install commands are one source: installCommands() and the marketplace add command
  ---
  duration_ms: 0.172093
  type: 'test'
  ...
# Subtest: the generator CLI: --profile with --out builds one plugin elsewhere, and refuses the plugins/ folder, a non-empty folder and unknown profiles
ok 644 - the generator CLI: --profile with --out builds one plugin elsewhere, and refuses the plugins/ folder, a non-empty folder and unknown profiles
  ---
  duration_ms: 494.226157
  type: 'test'
  ...
# Subtest: every routing-table command has a command file, an alias to one, or a reason in coverage.json
ok 645 - every routing-table command has a command file, an alias to one, or a reason in coverage.json
  ---
  duration_ms: 2.119898
  type: 'test'
  ...
# Subtest: every catalog command is a routing-table name, an alias target, or listed under catalogOnly with a reason
ok 646 - every catalog command is a routing-table name, an alias target, or listed under catalogOnly with a reason
  ---
  duration_ms: 0.487325
  type: 'test'
  ...
# Subtest: one plugin command file and one MCP prompt per catalog entry; no hand-written command source remains
ok 647 - one plugin command file and one MCP prompt per catalog entry; no hand-written command source remains
  ---
  duration_ms: 331.861108
  type: 'test'
  ...
# Subtest: coverage.json is honest: reasons present, no stale names, nothing listed twice
ok 648 - coverage.json is honest: reasons present, no stale names, nothing listed twice
  ---
  duration_ms: 0.715452
  type: 'test'
  ...
# Subtest: commands: the spec list exists, each has a description and an argument-hint, and a short body
ok 649 - commands: the spec list exists, each has a description and an argument-hint, and a short body
  ---
  duration_ms: 2.208985
  type: 'test'
  ...
# Subtest: commands and agents reference only files and tools that ship
ok 650 - commands and agents reference only files and tools that ship
  ---
  duration_ms: 6.259535
  type: 'test'
  ...
# Subtest: agents: documented frontmatter only, valid isolation, tool names that exist; the base has the read-only plan-reviewer, the parallel add-on has track-runner with isolation
ok 651 - agents: documented frontmatter only, valid isolation, tool names that exist; the base has the read-only plan-reviewer, the parallel add-on has track-runner with isolation
  ---
  duration_ms: 0.753914
  type: 'test'
  ...
# Subtest: run, implement and review dispatch the add-on's track-runner (the command is the yes), show the dispatch first; without the add-on they work in session
ok 652 - run, implement and review dispatch the add-on's track-runner (the command is the yes), show the dispatch first; without the add-on they work in session
  ---
  duration_ms: 1.033439
  type: 'test'
  ...
# Subtest: the real table: automatic and skill-only rows are exactly the recorded ones
ok 653 - the real table: automatic and skill-only rows are exactly the recorded ones
  ---
  duration_ms: 0.423224
  type: 'test'
  ...
# Subtest: commands that use the connector name its tools only for when they are present, and the steps above them work without; the board commands find the script by Glob
ok 654 - commands that use the connector name its tools only for when they are present, and the steps above them work without; the board commands find the script by Glob
  ---
  duration_ms: 5.623672
  type: 'test'
  ...
# Subtest: TC-5/TC-9 shape: all slash commands live in the base; the add-ons ship no commands/ or skills/ folder
ok 655 - TC-5/TC-9 shape: all slash commands live in the base; the add-ons ship no commands/ or skills/ folder
  ---
  duration_ms: 0.525907
  type: 'test'
  ...
# Subtest: the facts are the real folders: commands, skills, agents, scripts, tools and prompts
ok 656 - the facts are the real folders: commands, skills, agents, scripts, tools and prompts
  ---
  duration_ms: 2.225726
  type: 'test'
  ...
# Subtest: docs/plugin-map.md says exactly that: every provided name appears in its column, and every base command has a row with its dependency
ok 657 - docs/plugin-map.md says exactly that: every provided name appears in its column, and every base command has a row with its dependency
  ---
  duration_ms: 3.482134
  type: 'test'
  ...
# Subtest: every README carries the same short plugin map, generated from the same facts
ok 658 - every README carries the same short plugin map, generated from the same facts
  ---
  duration_ms: 0.355477
  type: 'test'
  ...
# Subtest: private tracks add exactly three .gitignore lines, only the ones missing, after the three of every project
ok 659 - private tracks add exactly three .gitignore lines, only the ones missing, after the three of every project
  ---
  duration_ms: 1.869518
  type: 'test'
  ...
# Subtest: decideTracks: private on a public sign (README, open-source LICENSE, package.json licence) or with no remote; committed with a remote and no sign
ok 660 - decideTracks: private on a public sign (README, open-source LICENSE, package.json licence) or with no remote; committed with a remote and no sign
  ---
  duration_ms: 142.602016
  type: 'test'
  ...
# Subtest: detectProject carries the decision in its answers and its evidence; writeScaffold with private tracks writes the three lines
ok 661 - detectProject carries the decision in its answers and its evidence; writeScaffold with private tracks writes the three lines
  ---
  duration_ms: 24.394974
  type: 'test'
  ...
# Subtest: create_track, update_track and append_conversation in a repository that ignores the tracks, the summary and the advice log: files written, no commit, a warning, no error
ok 662 - create_track, update_track and append_conversation in a repository that ignores the tracks, the summary and the advice log: files written, no commit, a warning, no error
  ---
  duration_ms: 691.992687
  type: 'test'
  ...
# Subtest: with the tracks ignored but the summary not, a write commits only the paths that are not ignored (the case the three lines prevent)
ok 663 - with the tracks ignored but the summary not, a write commits only the paths that are not ignored (the case the three lines prevent)
  ---
  duration_ms: 521.489449
  type: 'test'
  ...
# Subtest: setup and new-project never ask: they declare one line in the closing message, name the rule, the three lines and the way back
ok 664 - setup and new-project never ask: they declare one line in the closing message, name the rule, the three lines and the way back
  ---
  duration_ms: 1.034511
  type: 'test'
  ...
# Subtest: the base skill carries the short rule for the plain sentence later: private adds the three lines and offers `git rm -r --cached` (shown, not run); committed removes them after asking
ok 665 - the base skill carries the short rule for the plain sentence later: private adds the three lines and offers `git rm -r --cached` (shown, not run); committed removes them after asking
  ---
  duration_ms: 0.403467
  type: 'test'
  ...
# Subtest: probe over stdio via the SDK v2 client: instructions visible, tool listed and callable (TC-1.3)
ok 666 - probe over stdio via the SDK v2 client: instructions visible, tool listed and callable (TC-1.3)
  ---
  duration_ms: 289.880357
  type: 'test'
  ...
# Subtest: probe answers a raw 2025-06-18 initialize with instructions, stdout is MCP-only (TC-1.4)
ok 667 - probe answers a raw 2025-06-18 initialize with instructions, stdout is MCP-only (TC-1.4)
  ---
  duration_ms: 265.206731
  type: 'test'
  ...
# Subtest: probe answers a raw 2025-03-26 initialize with instructions, stdout is MCP-only (TC-1.4)
ok 668 - probe answers a raw 2025-03-26 initialize with instructions, stdout is MCP-only (TC-1.4)
  ---
  duration_ms: 280.339538
  type: 'test'
  ...
# Subtest: clean, synced and recently fetched is fresh
ok 669 - clean, synced and recently fetched is fresh
  ---
  duration_ms: 141.911951
  type: 'test'
  ...
# Subtest: ahead 2 gives possibly_stale + unpushed_local_commits
ok 670 - ahead 2 gives possibly_stale + unpushed_local_commits
  ---
  duration_ms: 173.859026
  type: 'test'
  ...
# Subtest: behind 1 after a fetch gives stale + behind_upstream
ok 671 - behind 1 after a fetch gives stale + behind_upstream
  ---
  duration_ms: 264.784929
  type: 'test'
  ...
# Subtest: no upstream gives no_upstream
ok 672 - no upstream gives no_upstream
  ---
  duration_ms: 73.540602
  type: 'test'
  ...
# Subtest: FETCH_HEAD older than 1 h gives last_fetch_older_than_1h
ok 673 - FETCH_HEAD older than 1 h gives last_fetch_older_than_1h
  ---
  duration_ms: 137.822019
  type: 'test'
  ...
# Subtest: a dirty conductor/ file gives dirty_state_files (and a dirty non-state file does not)
ok 674 - a dirty conductor/ file gives dirty_state_files (and a dirty non-state file does not)
  ---
  duration_ms: 180.968057
  type: 'test'
  ...
# Subtest: stale outranks possibly_stale and reasons keep the rule order
ok 675 - stale outranks possibly_stale and reasons keep the rule order
  ---
  duration_ms: 0.371036
  type: 'test'
  ...
# Subtest: github-only rules: remote_head_older_than_24h, cache_age_over_60s, served_from_cache_rate_limited
ok 676 - github-only rules: remote_head_older_than_24h, cache_age_over_60s, served_from_cache_rate_limited
  ---
  duration_ms: 0.247876
  type: 'test'
  ...
# Subtest: the provenance line has the short commit, branch, backend, ahead/behind and the fetch age
ok 677 - the provenance line has the short commit, branch, backend, ahead/behind and the fetch age
  ---
  duration_ms: 184.016958
  type: 'test'
  ...
# Subtest: the line for a fresh repo with dirty files and for never-fetched upstreams
ok 678 - the line for a fresh repo with dirty files and for never-fetched upstreams
  ---
  duration_ms: 0.622027
  type: 'test'
  ...
# Subtest: an empty repo (no commits) does not throw
ok 679 - an empty repo (no commits) does not throw
  ---
  duration_ms: 19.29793
  type: 'test'
  ...
# Subtest: default policy "ask": a connector commit never pushes and starts no timer; the response says the commit is unpushed and tells Claude to ask
ok 680 - default policy "ask": a connector commit never pushes and starts no timer; the response says the commit is unpushed and tells Claude to ask
  ---
  duration_ms: 514.658829
  type: 'test'
  ...
# Subtest: "auto-state": after 60 s idle (injected timer) the conductor-only commits of a write burst are pushed once, fast-forward, and logged
ok 681 - "auto-state": after 60 s idle (injected timer) the conductor-only commits of a write burst are pushed once, fast-forward, and logged
  ---
  duration_ms: 277.445948
  type: 'test'
  ...
# Subtest: "auto-state" with an unpushed commit that touches src/x.js: no push, and the warning names the commit
ok 682 - "auto-state" with an unpushed commit that touches src/x.js: no push, and the warning names the commit
  ---
  duration_ms: 245.186166
  type: 'test'
  ...
# Subtest: "auto-state" when the remote moved (non fast-forward): no push, no force, behind_upstream
ok 683 - "auto-state" when the remote moved (non fast-forward): no push, no force, behind_upstream
  ---
  duration_ms: 305.758344
  type: 'test'
  ...
# Subtest: "auto-state" without an upstream and with a rejected push reports why and never throws
ok 684 - "auto-state" without an upstream and with a rejected push reports why and never throws
  ---
  duration_ms: 312.841617
  type: 'test'
  ...
# Subtest: an unpushed merge commit is not pushed automatically
ok 685 - an unpushed merge commit is not pushed automatically
  ---
  duration_ms: 180.817476
  type: 'test'
  ...
# Subtest: readPushPolicy: absent file and absent key mean ask; auto-state is read; anything else falls back to ask with a problem
ok 686 - readPushPolicy: absent file and absent key mean ask; auto-state is read; anything else falls back to ask with a problem
  ---
  duration_ms: 54.949267
  type: 'test'
  ...
# Subtest: the server reads connector.push from .laneconductor.json and its responses say so
ok 687 - the server reads connector.push from .laneconductor.json and its responses say so
  ---
  duration_ms: 384.838843
  type: 'test'
  ...
# Subtest: the plan lane guide tells Claude to git fetch when the last fetch is old; other lanes do not
ok 688 - the plan lane guide tells Claude to git fetch when the last fetch is old; other lanes do not
  ---
  duration_ms: 398.866858
  type: 'test'
  ...
# Subtest: the catalog: one entry per recommended plugin with every field, unique names, a known kind
ok 689 - the catalog: one entry per recommended plugin with every field, unique names, a known kind
  ---
  duration_ms: 3.673012
  type: 'test'
  ...
# Subtest: every plugin named anywhere in the generated text is a catalog entry (or the base itself)
ok 690 - every plugin named anywhere in the generated text is a catalog entry (or the base itself)
  ---
  duration_ms: 5.358555
  type: 'test'
  ...
# Subtest: the entries' install commands match the marketplace file
ok 691 - the entries' install commands match the marketplace file
  ---
  duration_ms: 1.165286
  type: 'test'
  ...
# Subtest: an entry that installs code says so plainly, everywhere the install commands are shown; installs_code matches what the folder really ships
ok 692 - an entry that installs code says so plainly, everywhere the install commands are shown; installs_code matches what the folder really ships
  ---
  duration_ms: 59.04462
  type: 'test'
  ...
# Subtest: the generated text never tells Claude to run an install; the funnel is once per session, only when relevant
ok 693 - the generated text never tells Claude to run an install; the funnel is once per session, only when relevant
  ---
  duration_ms: 10.170875
  type: 'test'
  ...
# Subtest: resolveRepoSource: flag beats env beats cwd; cwd uses the git top level; nothing found throws
ok 694 - resolveRepoSource: flag beats env beats cwd; cwd uses the git top level; nothing found throws
  ---
  duration_ms: 115.884855
  type: 'test'
  ...
# Subtest: started with no --repo: CLAUDE_PROJECT_DIR is used and the choice is logged
ok 695 - started with no --repo: CLAUDE_PROJECT_DIR is used and the choice is logged
  ---
  duration_ms: 313.57504
  type: 'test'
  ...
# Subtest: --repo wins over CLAUDE_PROJECT_DIR
ok 696 - --repo wins over CLAUDE_PROJECT_DIR
  ---
  duration_ms: 329.469525
  type: 'test'
  ...
# Subtest: no flag and no variable: the current directory is used when it is inside a git repo (top level)
ok 697 - no flag and no variable: the current directory is used when it is inside a git repo (top level)
  ---
  duration_ms: 293.048307
  type: 'test'
  ...
# Subtest: outside any repo with no flag and no variable: a clear error and exit code 2, nothing on stdout
ok 698 - outside any repo with no flag and no variable: a clear error and exit code 2, nothing on stdout
  ---
  duration_ms: 217.002554
  type: 'test'
  ...
# Subtest: scanText: every pattern class is detected, with the line and the class name only
ok 699 - scanText: every pattern class is detected, with the line and the class name only
  ---
  duration_ms: 5.182354
  type: 'test'
  ...
# Subtest: scanText: other phone and credential forms
ok 700 - scanText: other phone and credential forms
  ---
  duration_ms: 0.429566
  type: 'test'
  ...
# Subtest: scanText: ordinary text is not flagged
ok 701 - scanText: ordinary text is not flagged
  ---
  duration_ms: 0.517672
  type: 'test'
  ...
# Subtest: scanText: several matches on several lines, and CRLF line endings
ok 702 - scanText: several matches on several lines, and CRLF line endings
  ---
  duration_ms: 7.19459
  type: 'test'
  ...
# Subtest: scanText: a very long line does not take long
ok 703 - scanText: a very long line does not take long
  ---
  duration_ms: 3.620744
  type: 'test'
  ...
# Subtest: create_track: a track that matches the new work is listed in similar_tracks with number, title, lane and lane status, plus a warning; the create still happens
ok 704 - create_track: a track that matches the new work is listed in similar_tracks with number, title, lane and lane status, plus a warning; the create still happens
  ---
  duration_ms: 549.409078
  type: 'test'
  ...
# Subtest: create_track: nothing matches, similar_tracks is empty and there is no similar-track warning
ok 705 - create_track: nothing matches, similar_tracks is empty and there is no similar-track warning
  ---
  duration_ms: 506.058449
  type: 'test'
  ...
# Subtest: create_track: only a done track matches, it is listed and marked with lane done
ok 706 - create_track: only a done track matches, it is listed and marked with lane done
  ---
  duration_ms: 474.781192
  type: 'test'
  ...
# Subtest: similarTracks: at most 5, best first, the backlog is searched, tracks without a lane are skipped
ok 707 - similarTracks: at most 5, best first, the backlog is searched, tracks without a lane are skipped
  ---
  duration_ms: 1.054479
  type: 'test'
  ...
# Subtest: the connector's `new` procedure has the search-first flow
ok 708 - the connector's `new` procedure has the search-first flow
  ---
  duration_ms: 0.470263
  type: 'test'
  ...
# Subtest: the base's `new` procedure has the same flow and lists tracks without the connector
ok 709 - the base's `new` procedure has the same flow and lists tracks without the connector
  ---
  duration_ms: 0.287309
  type: 'test'
  ...
# Subtest: the connector's `bug` procedure has the search-first flow
ok 710 - the connector's `bug` procedure has the search-first flow
  ---
  duration_ms: 0.197551
  type: 'test'
  ...
# Subtest: the base's `bug` procedure has the same flow and lists tracks without the connector
ok 711 - the base's `bug` procedure has the same flow and lists tracks without the connector
  ---
  duration_ms: 0.18135
  type: 'test'
  ...
# Subtest: the connector's `feature` procedure has the search-first flow
ok 712 - the connector's `feature` procedure has the search-first flow
  ---
  duration_ms: 0.383479
  type: 'test'
  ...
# Subtest: the base's `feature` procedure has the same flow and lists tracks without the connector
ok 713 - the base's `feature` procedure has the same flow and lists tracks without the connector
  ---
  duration_ms: 0.372659
  type: 'test'
  ...
# Subtest: the skill file and the lane guides carry the rule
ok 714 - the skill file and the lane guides carry the rule
  ---
  duration_ms: 0.58073
  type: 'test'
  ...
# Subtest: TC-1 ops/settings.md is in the source skill and in the built base, lists exactly the nine keys, says optional and personal, and names the .gitignore line
ok 715 - TC-1 ops/settings.md is in the source skill and in the built base, lists exactly the nine keys, says optional and personal, and names the .gitignore line
  ---
  duration_ms: 35.821024
  type: 'test'
  ...
# Subtest: TC-2 parity: every key the code reads is listed in ops/settings.md, and every listed key is read by the code or the board procedure
ok 716 - TC-2 parity: every key the code reads is listed in ops/settings.md, and every listed key is read by the code or the board procedure
  ---
  duration_ms: 0.599505
  type: 'test'
  ...
# Subtest: TC-3 the scaffold file map and writeScaffold create no .laneconductor.json and add no line for it to .gitignore
ok 717 - TC-3 the scaffold file map and writeScaffold create no .laneconductor.json and add no line for it to .gitignore
  ---
  duration_ms: 12.46556
  type: 'test'
  ...
# Subtest: TC-4 an OLD settings file (mode, project id, collectors): the state branch, the push policy, the board script and the scaffold run with no problem and leave it byte-identical
ok 718 - TC-4 an OLD settings file (mode, project id, collectors): the state branch, the push policy, the board script and the scaffold run with no problem and leave it byte-identical
  ---
  duration_ms: 251.670983
  type: 'test'
  ...
# Subtest: TC-5 a settings file that is not valid JSON: the push policy says so once and uses ask; the state branch and the board carry on with defaults
ok 719 - TC-5 a settings file that is not valid JSON: the push policy says so once and uses ask; the state branch and the board carry on with defaults
  ---
  duration_ms: 112.051963
  type: 'test'
  ...
# Subtest: TC-6 a new project with no remote on main and no settings file: the state branch is main, from the current branch
ok 720 - TC-6 a new project with no remote on main and no settings file: the state branch is main, from the current branch
  ---
  duration_ms: 33.186742
  type: 'test'
  ...
# Subtest: TC-12 helpText and helpData carry no lc command-line wording; the JSON field is needs_board_script
ok 721 - TC-12 helpText and helpData carry no lc command-line wording; the JSON field is needs_board_script
  ---
  duration_ms: 1.368157
  type: 'test'
  ...
# Subtest: TC-13 the board script prints board: (not lc board:) on stderr, and --check says how to rebuild with node
ok 722 - TC-13 the board script prints board: (not lc board:) on stderr, and --check says how to rebuild with node
  ---
  duration_ms: 185.3601
  type: 'test'
  ...
# Subtest: TC-14 board (no argument) still reads board.artifact_url and handles the missing file or key
ok 723 - TC-14 board (no argument) still reads board.artifact_url and handles the missing file or key
  ---
  duration_ms: 0.542458
  type: 'test'
  ...
# Subtest: TC-15 every starter-set candidate has a one-line setup_fit of 10 to 200 characters
ok 724 - TC-15 every starter-set candidate has a one-line setup_fit of 10 to 200 characters
  ---
  duration_ms: 1.74807
  type: 'test'
  ...
# Subtest: TC-16 the generated block in new-project.md names exactly the starter candidates, one line each with its commands in inline code (Claude shows each alone in its own bash block), and the one-line add-ons install in its own fence
ok 725 - TC-16 the generated block in new-project.md names exactly the starter candidates, one line each with its commands in inline code (Claude shows each alone in its own bash block), and the one-line add-ons install in its own fence
  ---
  duration_ms: 2.39843
  type: 'test'
  ...
# Subtest: TC-17 the block shows only: it says never run, no install without a yes, skip what is installed, and say nothing when nothing fits
ok 726 - TC-17 the block shows only: it says never run, no install without a yes, skip what is installed, and say nothing when nothing fits
  ---
  duration_ms: 0.702287
  type: 'test'
  ...
# Subtest: TC-11 TC-12 the starter set: at most four, none installed, once; derived from the stack and Type; "later" defers to the moment of intent
ok 727 - TC-11 TC-12 the starter set: at most four, none installed, once; derived from the stack and Type; "later" defers to the moment of intent
  ---
  duration_ms: 0.421641
  type: 'test'
  ...
# Subtest: TC-19/20 no other base text recommends an add-on unconditionally or names a plugin that is not a catalog entry
ok 728 - TC-19/20 no other base text recommends an add-on unconditionally or names a plugin that is not a catalog entry
  ---
  duration_ms: 35.683967
  type: 'test'
  ...
# Subtest: TC-21 the block is built from the catalog: a fake skillpack entry gets its own paragraph and fences
ok 729 - TC-21 the block is built from the catalog: a fake skillpack entry gets its own paragraph and fences
  ---
  duration_ms: 0.409138
  type: 'test'
  ...
# Subtest: ADD-ONS.md prints each entry's setup_fit, and the setup command points at the step
ok 730 - ADD-ONS.md prints each entry's setup_fit, and the setup command points at the step
  ---
  duration_ms: 0.431529
  type: 'test'
  ...
# Subtest: setup walk-through on a scratch repository with no lc on PATH: scaffold, board, no settings file, no commit, no lc anywhere in the output
ok 731 - setup walk-through on a scratch repository with no lc on PATH: scaffold, board, no settings file, no commit, no lc anywhere in the output
  ---
  duration_ms: 424.418849
  type: 'test'
  ...
# Subtest: the same walk-through with an OLD settings file and a fake lc on PATH: nothing calls lc, the old file is untouched and reported as left alone
ok 732 - the same walk-through with an OLD settings file and a fake lc on PATH: nothing calls lc, the old file is untouched and reported as left alone
  ---
  duration_ms: 346.868324
  type: 'test'
  ...
# Subtest: the generated setup procedure, read the way a session would, names no program that does not exist
ok 733 - the generated setup procedure, read the way a session would, names no program that does not exist
  ---
  duration_ms: 46.403832
  type: 'test'
  ...
# Subtest: the connector starts and serves get_context and list_tracks with no lc on PATH
ok 734 - the connector starts and serves get_context and list_tracks with no lc on PATH
  ---
  duration_ms: 452.141892
  type: 'test'
  ...
# Subtest: landing: sitemap.xml lists only pages that exist, on the real host, and robots.txt allows crawling and points at it
ok 735 - landing: sitemap.xml lists only pages that exist, on the real host, and robots.txt allows crawling and points at it
  ---
  duration_ms: 2.635105
  type: 'test'
  ...
# Subtest: landing: the hosting config ignores neither file (they must be served, ahead of the catch-all rewrite)
ok 736 - landing: the hosting config ignores neither file (they must be served, ahead of the catch-all rewrite)
  ---
  duration_ms: 0.891423
  type: 'test'
  ...
# Subtest: landing page: the Latest versions line starts hidden, has a placeholder for every plugin and carries no hard-coded version number
ok 737 - landing page: the Latest versions line starts hidden, has a placeholder for every plugin and carries no hard-coded version number
  ---
  duration_ms: 1.646079
  type: 'test'
  ...
# Subtest: landing page: the line is filled from the generated versions file of the repository, only with plain version numbers, and a failed read leaves it hidden
ok 738 - landing page: the line is filled from the generated versions file of the repository, only with plain version numbers, and a failed read leaves it hidden
  ---
  duration_ms: 1.925793
  type: 'test'
  ...
# Subtest: docs/plugin-versions.json is every plugin at its manifest version (generated)
ok 739 - docs/plugin-versions.json is every plugin at its manifest version (generated)
  ---
  duration_ms: 16.077538
  type: 'test'
  ...
# Subtest: TC-18 real work, no track: one sentence and three ways in, plain text, nothing blocked
ok 740 - TC-18 real work, no track: one sentence and three ways in, plain text, nothing blocked
  ---
  duration_ms: 1.376282
  type: 'test'
  ...
# Subtest: TC-19 small things get no offer, "no track" once is the end of it for the session, and nothing is created without a yes
ok 741 - TC-19 small things get no offer, "no track" once is the end of it for the session, and nothing is created without a yes
  ---
  duration_ms: 0.428985
  type: 'test'
  ...
# Subtest: TC-20 the current track: the prompt, a branch named after a track, or the track this session has running; written once and used by the base skill, suggest-skills and next
ok 742 - TC-20 the current track: the prompt, a branch named after a track, or the track this session has running; written once and used by the base skill, suggest-skills and next
  ---
  duration_ms: 4.515663
  type: 'test'
  ...
# Subtest: the command: suggest-skills is in the catalog, in the first group next to next, with the plain description and the example phrase; the base ships it with its whole procedure
ok 743 - the command: suggest-skills is in the catalog, in the first group next to next, with the plain description and the example phrase; the base ships it with its whole procedure
  ---
  duration_ms: 2.557559
  type: 'test'
  ...
# Subtest: size: a lane command carries one short rule (at most 12 lines) and one line per candidate; the long procedure lives only in suggest-skills
ok 744 - size: a lane command carries one short rule (at most 12 lines) and one line per candidate; the long procedure lives only in suggest-skills
  ---
  duration_ms: 1.437317
  type: 'test'
  ...
# Subtest: TC-4 plain text: one or two sentences, each command alone in its own bash block (no leading $), in-session alternative inline, no form
ok 745 - TC-4 plain text: one or two sentences, each command alone in its own bash block (no leading $), in-session alternative inline, no form
  ---
  duration_ms: 0.668554
  type: 'test'
  ...
# Subtest: TC-5, TC-6 at the moment of intent: a prerequisite asks install-first-or-carry-on in one sentence, a helper is a one-line tip, the work is never blocked
ok 746 - TC-5, TC-6 at the moment of intent: a prerequisite asks install-first-or-carry-on in one sentence, a helper is a one-line tip, the work is never blocked
  ---
  duration_ms: 1.81194
  type: 'test'
  ...
# Subtest: TC-7 install first, carry on, do not ask again: the three answers
ok 747 - TC-7 install first, carry on, do not ask again: the three answers
  ---
  duration_ms: 0.348274
  type: 'test'
  ...
# Subtest: TC-9 declined (Phase 7): the list is `skills.declined` in the personal settings file, listed in the settings table; no shipped text sends the write inside the repository hidden directory; the old file is only read
ok 748 - TC-9 declined (Phase 7): the list is `skills.declined` in the personal settings file, listed in the settings table; no shipped text sends the write inside the repository hidden directory; the old file is only read
  ---
  duration_ms: 4.373045
  type: 'test'
  ...
# Subtest: TC-8 quiet: nothing missing means no message, at most two items, never twice in a session, a trivial track gets one line
ok 749 - TC-8 quiet: nothing missing means no message, at most two items, never twice in a session, a trivial track gets one line
  ---
  duration_ms: 0.435538
  type: 'test'
  ...
# Subtest: TC-9 detection: the session skills list, `claude plugin list`, .claude/skills and ~/.claude/skills; an installed skill is named, not recommended; the old lookup is gone
ok 750 - TC-9 detection: the session skills list, `claude plugin list`, .claude/skills and ~/.claude/skills; an installed skill is named, not recommended; the old lookup is gone
  ---
  duration_ms: 3.96542
  type: 'test'
  ...
# Subtest: TC-10 consent: the base shows the commands and never runs an install; a program is called a program, a Markdown pack adds knowledge only
ok 751 - TC-10 consent: the base shows the commands and never runs an install; a program is called a program, a Markdown pack adds knowledge only
  ---
  duration_ms: 2.229764
  type: 'test'
  ...
# Subtest: the hooks: every lane guide has "Offer a missing skill" before "Skills that help here"; new-project and next carry theirs
ok 752 - the hooks: every lane guide has "Offer a missing skill" before "Skills that help here"; new-project and next carry theirs
  ---
  duration_ms: 3.969749
  type: 'test'
  ...
# Subtest: TC-13 the add-ons are ordinary entries: the same line, offered in the lane guides and the catalog like any pack, no special code path
ok 753 - TC-13 the add-ons are ordinary entries: the same line, offered in the lane guides and the catalog like any pack, no special code path
  ---
  duration_ms: 0.733867
  type: 'test'
  ...
# Subtest: TC-14 every lane is covered, with the skills the owner named
ok 754 - TC-14 every lane is covered, with the skills the owner named
  ---
  duration_ms: 0.710363
  type: 'test'
  ...
# Subtest: every catalog entry appears in the guide of each lane it names, and in no guide of a lane it does not (TC-3, TC-14)
ok 755 - every catalog entry appears in the guide of each lane it names, and in no guide of a lane it does not (TC-3, TC-14)
  ---
  duration_ms: 5.069823
  type: 'test'
  ...
# Subtest: a Type: marketing track gets the offer at plan and at implement, and at creation
ok 756 - a Type: marketing track gets the offer at plan and at implement, and at creation
  ---
  duration_ms: 0.550873
  type: 'test'
  ...
# Subtest: REQ-7 disclosure: the READMEs say nothing is installed without a yes, from which sources, and what it runs
ok 757 - REQ-7 disclosure: the READMEs say nothing is installed without a yes, from which sources, and what it runs
  ---
  duration_ms: 1.359922
  type: 'test'
  ...
# Subtest: the base stays Markdown only: nothing new in it is a program, a hook or a connector tool
ok 758 - the base stays Markdown only: nothing new in it is a program, a hook or a connector tool
  ---
  duration_ms: 1.342389
  type: 'test'
  ...
# Subtest: TC-1 the live catalog passes the checker offline: every field, dated, every lane and Type covered
ok 759 - TC-1 the live catalog passes the checker offline: every field, dated, every lane and Type covered
  ---
  duration_ms: 6.106929
  type: 'test'
  ...
# Subtest: TC-1 the checker accepts a valid fixture and names the field when one is missing
ok 760 - TC-1 the checker accepts a valid fixture and names the field when one is missing
  ---
  duration_ms: 1.356646
  type: 'test'
  ...
# Subtest: TC-1 the checker fails on an unknown lane, Type, kind, level or stack tag
ok 761 - TC-1 the checker fails on an unknown lane, Type, kind, level or stack tag
  ---
  duration_ms: 0.642435
  type: 'test'
  ...
# Subtest: TC-1 the checker fails on a source that cannot resolve (not a public GitHub repository) and on install commands that differ from it
ok 762 - TC-1 the checker fails on a source that cannot resolve (not a public GitHub repository) and on install commands that differ from it
  ---
  duration_ms: 0.660669
  type: 'test'
  ...
# Subtest: TC-1 the checker fails on a private-looking name, path, address or marketplace; prose may say "private"
ok 763 - TC-1 the checker fails on a private-looking name, path, address or marketplace; prose may say "private"
  ---
  duration_ms: 0.750959
  type: 'test'
  ...
# Subtest: TC-14 the coverage check fails when a lane or a Type has no entry, and the live catalog covers every lane
ok 764 - TC-14 the coverage check fails when a lane or a Type has no entry, and the live catalog covers every lane
  ---
  duration_ms: 0.961003
  type: 'test'
  ...
# Subtest: TC-1 online: a source that resolves and holds the named skill passes; each way of not resolving is reported
ok 765 - TC-1 online: a source that resolves and holds the named skill passes; each way of not resolving is reported
  ---
  duration_ms: 1.310329
  type: 'test'
  ...
# Subtest: TC-1 online: a plugin in another repository (url source with a commit) and a command or agent count as holding the name
ok 766 - TC-1 online: a plugin in another repository (url source with a commit) and a command or agent count as holding the name
  ---
  duration_ms: 0.58063
  type: 'test'
  ...
# Subtest: TC-1 the command line: exit 0 on the live catalog; exit 1 and the problems on a bad file
ok 767 - TC-1 the command line: exit 0 on the live catalog; exit 1 and the problems on a bad file
  ---
  duration_ms: 174.748318
  type: 'test'
  ...
# Subtest: TC-2 our own entries come first, a prerequisite before a helper; the finder is the third-party fallback and no entry
ok 768 - TC-2 our own entries come first, a prerequisite before a helper; the finder is the third-party fallback and no entry
  ---
  duration_ms: 0.587643
  type: 'test'
  ...
# Subtest: TC-3 every skill a lane guide names under "Skills that help here" is in the catalog for that lane (or the section marks it local)
ok 769 - TC-3 every skill a lane guide names under "Skills that help here" is in the catalog for that lane (or the section marks it local)
  ---
  duration_ms: 1.782765
  type: 'test'
  ...
# Subtest: every skill of the old inline lists (marketing, sales) is found in the catalog under its current name or an alias
ok 770 - every skill of the old inline lists (marketing, sales) is found in the catalog under its current name or an alias
  ---
  duration_ms: 0.304461
  type: 'test'
  ...
# Subtest: the pack list is exactly the five packs of the spec, and every skill folder is in exactly one of them
ok 771 - the pack list is exactly the five packs of the spec, and every skill folder is in exactly one of them
  ---
  duration_ms: 2.32853
  type: 'test'
  ...
# Subtest: each pack folder holds exactly the files of its skills, byte for byte (hidden template files included), and nothing else but the fixed parts
ok 772 - each pack folder holds exactly the files of its skills, byte for byte (hidden template files included), and nothing else but the fixed parts
  ---
  duration_ms: 6.408014
  type: 'test'
  ...
# Subtest: a pack ships no script, hook, MCP server, package file, agent or isolation key, and nothing executable
ok 773 - a pack ships no script, hook, MCP server, package file, agent or isolation key, and nothing executable
  ---
  duration_ms: 6.802735
  type: 'test'
  ...
# Subtest: plugin.json has the same shape as the other plugins: author, homepage, repository, license, keywords, privacyPolicyUrl
ok 774 - plugin.json has the same shape as the other plugins: author, homepage, repository, license, keywords, privacyPolicyUrl
  ---
  duration_ms: 0.66065
  type: 'test'
  ...
# Subtest: each pack README names each of its skills with its frontmatter description, has install and update lines, the advice note and the docs link, in under 400 words
ok 775 - each pack README names each of its skills with its frontmatter description, has install and update lines, the advice note and the docs link, in under 400 words
  ---
  duration_ms: 2.153341
  type: 'test'
  ...
# Subtest: the marketplace lists all nine plugins: the three first, then the six packs, each pack with its own version
ok 776 - the marketplace lists all nine plugins: the three first, then the six packs, each pack with its own version
  ---
  duration_ms: 0.908063
  type: 'test'
  ...
# Subtest: docs/plugin-map.md lists each pack with the skills it holds
ok 777 - docs/plugin-map.md lists each pack with the skills it holds
  ---
  duration_ms: 0.385102
  type: 'test'
  ...
# Subtest: the root README has a Skill packs section with every pack and its install command, and claims nothing about Anthropic's directory
ok 778 - the root README has a Skill packs section with every pack and its install command, and claims nothing about Anthropic's directory
  ---
  duration_ms: 2.293754
  type: 'test'
  ...
# Subtest: the pack build never writes into the base plugin, which stays what the generator makes of its own sources
ok 779 - the pack build never writes into the base plugin, which stays what the generator makes of its own sources
  ---
  duration_ms: 43.841865
  type: 'test'
  ...
# Subtest: the build is deterministic: two runs give the same bytes, in the same order
ok 780 - the build is deterministic: two runs give the same bytes, in the same order
  ---
  duration_ms: 70.375423
  type: 'test'
  ...
# Subtest: generator errors: a skill in no pack, a skill in two packs and a pack naming a missing skill each fail with a clear message
ok 781 - generator errors: a skill in no pack, a skill in two packs and a pack naming a missing skill each fail with a clear message
  ---
  duration_ms: 203.894549
  type: 'test'
  ...
# Subtest: claude plugin validate --strict passes on laneconductor-nodejs-frontend
ok 782 - claude plugin validate --strict passes on laneconductor-nodejs-frontend
  ---
  duration_ms: 802.332032
  type: 'test'
  ...
# Subtest: claude plugin validate --strict passes on laneconductor-firebase
ok 783 - claude plugin validate --strict passes on laneconductor-firebase
  ---
  duration_ms: 864.282463
  type: 'test'
  ...
# Subtest: claude plugin validate --strict passes on laneconductor-node-postgres
ok 784 - claude plugin validate --strict passes on laneconductor-node-postgres
  ---
  duration_ms: 817.615503
  type: 'test'
  ...
# Subtest: claude plugin validate --strict passes on laneconductor-gemini
ok 785 - claude plugin validate --strict passes on laneconductor-gemini
  ---
  duration_ms: 771.178624
  type: 'test'
  ...
# Subtest: claude plugin validate --strict passes on laneconductor-skill-from-code
ok 786 - claude plugin validate --strict passes on laneconductor-skill-from-code
  ---
  duration_ms: 753.728135
  type: 'test'
  ...
# Subtest: claude plugin validate --strict passes on laneconductor-analytics-monitoring
ok 787 - claude plugin validate --strict passes on laneconductor-analytics-monitoring
  ---
  duration_ms: 753.185702
  type: 'test'
  ...
# Subtest: the skills library checks still pass on skills/: the checker with no errors or warnings, the privacy gate without a deny list reports no finding
ok 788 - the skills library checks still pass on skills/: the checker with no errors or warnings, the privacy gate without a deny list reports no finding
  ---
  duration_ms: 187.082962
  type: 'test'
  ...
# Subtest: the directory guard still catches a real listing claim and allows a plain mention
ok 789 - the directory guard still catches a real listing claim and allows a plain mention
  ---
  duration_ms: 0.231204
  type: 'test'
  ...
# Subtest: rule 1: --state-branch wins over config and origin/HEAD, and applies to every --repo
ok 790 - rule 1: --state-branch wins over config and origin/HEAD, and applies to every --repo
  ---
  duration_ms: 400.620616
  type: 'test'
  ...
# Subtest: rule 2: connector.state_branch in .laneconductor.json wins over origin/HEAD and the current branch
ok 791 - rule 2: connector.state_branch in .laneconductor.json wins over origin/HEAD and the current branch
  ---
  duration_ms: 359.181951
  type: 'test'
  ...
# Subtest: rule 3: the default branch from refs/remotes/origin/HEAD, with no fetch
ok 792 - rule 3: the default branch from refs/remotes/origin/HEAD, with no fetch
  ---
  duration_ms: 391.293709
  type: 'test'
  ...
# Subtest: rule 4: with no config and no origin/HEAD, the current branch is used when it is main or master
ok 793 - rule 4: with no config and no origin/HEAD, the current branch is used when it is main or master
  ---
  duration_ms: 311.474204
  type: 'test'
  ...
# Subtest: rule 5: otherwise main, and writes are refused while the checkout is elsewhere (guard unchanged)
ok 794 - rule 5: otherwise main, and writes are refused while the checkout is elsewhere (guard unchanged)
  ---
  duration_ms: 409.364871
  type: 'test'
  ...
# Subtest: a master-branch repo with no config creates and updates a track through the real stdio server
ok 795 - a master-branch repo with no config creates and updates a track through the real stdio server
  ---
  duration_ms: 557.401691
  type: 'test'
  ...
# Subtest: an invalid connector.state_branch is a clear startup error naming the repo, not a crash
ok 796 - an invalid connector.state_branch is a clear startup error naming the repo, not a crash
  ---
  duration_ms: 1812.828205
  type: 'test'
  ...
# Subtest: multi-repo: each --repo resolves its own state branch independently
ok 797 - multi-repo: each --repo resolves its own state branch independently
  ---
  duration_ms: 459.056193
  type: 'test'
  ...
# Subtest: a matching precondition lands the write in exactly one commit that touches only the written paths
ok 798 - a matching precondition lands the write in exactly one commit that touches only the written paths
  ---
  duration_ms: 125.405872
  type: 'test'
  ...
# Subtest: a precondition mismatch is a conflict: bytes unchanged, no commit
ok 799 - a precondition mismatch is a conflict: bytes unchanged, no commit
  ---
  duration_ms: 62.765513
  type: 'test'
  ...
# Subtest: precondition sha:null while the file exists conflicts (create never overwrites)
ok 800 - precondition sha:null while the file exists conflicts (create never overwrites)
  ---
  duration_ms: 100.166572
  type: 'test'
  ...
# Subtest: two concurrent writers from the same base: exactly one wins (20 iterations, two store instances)
ok 801 - two concurrent writers from the same base: exactly one wins (20 iterations, two store instances)
  ---
  duration_ms: 1384.518194
  type: 'test'
  ...
# Subtest: writes off the state branch are refused; reads work and the provenance says so
ok 802 - writes off the state branch are refused; reads work and the provenance says so
  ---
  duration_ms: 88.33829
  type: 'test'
  ...
# Subtest: a failing pre-commit hook leaves the write on disk with commit:null and commitError, nothing staged
ok 803 - a failing pre-commit hook leaves the write on disk with commit:null and commitError, nothing staged
  ---
  duration_ms: 93.598421
  type: 'test'
  ...
# Subtest: an .git/index.lock present for ~500 ms is retried and succeeds; held throughout it is WRITE_FAILED and rolled back
ok 804 - an .git/index.lock present for ~500 ms is retried and succeeds; held throughout it is WRITE_FAILED and rolled back
  ---
  duration_ms: 923.225362
  type: 'test'
  ...
# Subtest: a gitignored conversation.md is written, not committed, never force-added
ok 805 - a gitignored conversation.md is written, not committed, never force-added
  ---
  duration_ms: 68.395589
  type: 'test'
  ...
# Subtest: when ignored and committable paths are mixed, the committable ones are committed and the ignored are reported
ok 806 - when ignored and committable paths are mixed, the committable ones are committed and the ignored are reported
  ---
  duration_ms: 84.008817
  type: 'test'
  ...
# Subtest: delete changes are committed
ok 807 - delete changes are committed
  ---
  duration_ms: 82.031457
  type: 'test'
  ...
# Subtest: path safety: writes only under conductor/, no .., no .git, no symlink escape
ok 808 - path safety: writes only under conductor/, no .., no .git, no symlink escape
  ---
  duration_ms: 74.798124
  type: 'test'
  ...
# Subtest: reads: listDir, readFiles (missing is null), isAncestor, upstreamDirs
ok 809 - reads: listDir, readFiles (missing is null), isAncestor, upstreamDirs
  ---
  duration_ms: 137.463211
  type: 'test'
  ...
# Subtest: generateSummary: sorted rows, blob-sha source, escaped cells, same input and stamp give identical text
ok 810 - generateSummary: sorted rows, blob-sha source, escaped cells, same input and stamp give identical text
  ---
  duration_ms: 4.138726
  type: 'test'
  ...
# Subtest: generateSummary: lint puts invalid lane, bad status, missing markers, missing index.md and duplicate numbers under "needs attention"
ok 811 - generateSummary: lint puts invalid lane, bad status, missing markers, missing index.md and duplicate numbers under "needs attention"
  ---
  duration_ms: 8.870946
  type: 'test'
  ...
# Subtest: checkSummary: missing, hand-edited and current files
ok 812 - checkSummary: missing, hand-edited and current files
  ---
  duration_ms: 1.120473
  type: 'test'
  ...
# Subtest: create_track commits the summary in the SAME commit as the track files
ok 813 - create_track commits the summary in the SAME commit as the track files
  ---
  duration_ms: 458.025273
  type: 'test'
  ...
# Subtest: update_track: a marker change regenerates the summary in the same commit; a spec-only change leaves a current summary alone
ok 814 - update_track: a marker change regenerates the summary in the same commit; a spec-only change leaves a current summary alone
  ---
  duration_ms: 652.165622
  type: 'test'
  ...
# Subtest: update_track on a repo with no summary yet writes one (writes self-heal the file)
ok 815 - update_track on a repo with no summary yet writes one (writes self-heal the file)
  ---
  duration_ms: 487.638786
  type: 'test'
  ...
# Subtest: list_tracks self-heals: a missing or hand-edited summary is reported in stale_reasons and the rows still come from the track files
ok 816 - list_tracks self-heals: a missing or hand-edited summary is reported in stale_reasons and the rows still come from the track files
  ---
  duration_ms: 668.987685
  type: 'test'
  ...
# Subtest: lc-summary CLI: --check exits 1 when missing, plain run writes without committing, --check then exits 0
ok 817 - lc-summary CLI: --check exits 1 when missing, plain run writes without committing, --check then exits 0
  ---
  duration_ms: 523.981295
  type: 'test'
  ...
# Subtest: privacy: create_track commits a summary of the 2 tracked tracks + the new one, never the untracked draft
ok 818 - privacy: create_track commits a summary of the 2 tracked tracks + the new one, never the untracked draft
  ---
  duration_ms: 498.464497
  type: 'test'
  ...
# Subtest: privacy: update_track commits a summary with the updated track and not the untracked draft
ok 819 - privacy: update_track commits a summary with the updated track and not the untracked draft
  ---
  duration_ms: 541.924951
  type: 'test'
  ...
# Subtest: privacy: once the draft is committed it appears in the next summary
ok 820 - privacy: once the draft is committed it appears in the next summary
  ---
  duration_ms: 586.082914
  type: 'test'
  ...
# Subtest: privacy: list_tracks lists the draft as untracked with a warning, and it causes no permanent stale reason
ok 821 - privacy: list_tracks lists the draft as untracked with a warning, and it causes no permanent stale reason
  ---
  duration_ms: 401.261098
  type: 'test'
  ...
# Subtest: privacy: lc summary leaves the untracked draft out by default and --include-untracked adds it
ok 822 - privacy: lc summary leaves the untracked draft out by default and --include-untracked adds it
  ---
  duration_ms: 379.91343
  type: 'test'
  ...
# Subtest: tools/list returns exactly the 8 v0 tools plus help, with the spec annotations
ok 823 - tools/list returns exactly the 8 v0 tools plus help, with the spec annotations
  ---
  duration_ms: 318.942978
  type: 'test'
  ...
# Subtest: server instructions: present, within the limit, first 300 characters mention planning tracks and get_context
ok 824 - server instructions: present, within the limit, first 300 characters mention planning tracks and get_context
  ---
  duration_ms: 253.760119
  type: 'test'
  ...
# Subtest: every result, success and error, has structuredContent.provenance and starts its text with the provenance line
ok 825 - every result, success and error, has structuredContent.provenance and starts its text with the provenance line
  ---
  duration_ms: 527.721698
  type: 'test'
  ...
# Subtest: list_tracks: done hidden by default, include_done, lane filter, duplicate-number warning
ok 826 - list_tracks: done hidden by default, include_done, lane filter, duplicate-number warning
  ---
  duration_ms: 529.67285
  type: 'test'
  ...
# Subtest: list_tracks: tracks without a Lane marker produce a warning; a non-LaneConductor repo is NOT_A_LANECONDUCTOR_REPO
ok 827 - list_tracks: tracks without a Lane marker produce a warning; a non-LaneConductor repo is NOT_A_LANECONDUCTOR_REPO
  ---
  duration_ms: 640.474597
  type: 'test'
  ...
# Subtest: get_track returns base with git-hash-object shas and the parsed markers
ok 828 - get_track returns base with git-hash-object shas and the parsed markers
  ---
  duration_ms: 363.848988
  type: 'test'
  ...
# Subtest: get_track: asking for fewer files leaves the others out of base.files, markers always present
ok 829 - get_track: asking for fewer files leaves the others out of base.files, markers always present
  ---
  duration_ms: 324.014354
  type: 'test'
  ...
# Subtest: get_track with an 80,000-character conversation: text <= 40,000, conversation truncated first, spec/plan full and in base
ok 830 - get_track with an 80,000-character conversation: text <= 40,000, conversation truncated first, spec/plan full and in base
  ---
  duration_ms: 313.930552
  type: 'test'
  ...
# Subtest: get_track: an oversized spec is truncated, flagged, and absent from base.files so it cannot be overwritten (REQ-6)
ok 831 - get_track: an oversized spec is truncated, flagged, and absent from base.files so it cannot be overwritten (REQ-6)
  ---
  duration_ms: 418.175493
  type: 'test'
  ...
# Subtest: create_track makes XX-NNN-slug with five files, valid markers, one commit, and a base usable by update_track
ok 832 - create_track makes XX-NNN-slug with five files, valid markers, one commit, and a base usable by update_track
  ---
  duration_ms: 571.416406
  type: 'test'
  ...
# Subtest: create_track with track_kind bug writes the bug form and a regression-test first case (10116)
ok 833 - create_track with track_kind bug writes the bug form and a regression-test first case (10116)
  ---
  duration_ms: 297.750926
  type: 'test'
  ...
# Subtest: create_track: number follows the max of both conventions and reuses the common initials
ok 834 - create_track: number follows the max of both conventions and reuses the common initials
  ---
  duration_ms: 482.229033
  type: 'test'
  ...
# Subtest: create_track: a problem that would break index.md is VALIDATION_FAILED and writes nothing
ok 835 - create_track: a problem that would break index.md is VALIDATION_FAILED and writes nothing
  ---
  duration_ms: 215.009237
  type: 'test'
  ...
# Subtest: update_track with a fresh base writes and commits and returns a new base; reusing the old base is a CONFLICT that leaves the first edit
ok 836 - update_track with a fresh base writes and commits and returns a new base; reusing the old base is a CONFLICT that leaves the first edit
  ---
  duration_ms: 391.149958
  type: 'test'
  ...
# Subtest: markers: field-level checks. Another session changing only spec.md is no conflict; changing the same marker is
ok 837 - markers: field-level checks. Another session changing only spec.md is no conflict; changing the same marker is
  ---
  duration_ms: 665.758437
  type: 'test'
  ...
# Subtest: markers: invalid lane/status are rejected, null removes a marker, Lane cannot be removed, files.index is validated
ok 838 - markers: invalid lane/status are rejected, null removes a marker, Lane cannot be removed, files.index is validated
  ---
  duration_ms: 411.035828
  type: 'test'
  ...
# Subtest: update_track: files.index with markers, files.conversation, and an empty request are VALIDATION_FAILED
ok 839 - update_track: files.index with markers, files.conversation, and an empty request are VALIDATION_FAILED
  ---
  duration_ms: 276.313307
  type: 'test'
  ...
# Subtest: update_track with a base commit that is not in history is UNKNOWN_BASE; an older ancestor is accepted
ok 840 - update_track with a base commit that is not in history is UNKNOWN_BASE; an older ancestor is accepted
  ---
  duration_ms: 348.523217
  type: 'test'
  ...
# Subtest: update_track on a branch other than the state branch is NOT_ON_STATE_BRANCH and writes nothing
ok 841 - update_track on a branch other than the state branch is NOT_ON_STATE_BRANCH and writes nothing
  ---
  duration_ms: 303.412728
  type: 'test'
  ...
# Subtest: append_conversation from two clients concurrently: both entries present, both parse
ok 842 - append_conversation from two clients concurrently: both entries present, both parse
  ---
  duration_ms: 412.991655
  type: 'test'
  ...
# Subtest: append_conversation validation: pre-formatted body and a body that would split the turn are VALIDATION_FAILED
ok 843 - append_conversation validation: pre-formatted body and a body that would split the turn are VALIDATION_FAILED
  ---
  duration_ms: 250.698493
  type: 'test'
  ...
# Subtest: append_conversation when conversation.md is gitignored (D5): written, commit null, commit_error names D5, never force-added
ok 844 - append_conversation when conversation.md is gitignored (D5): written, commit null, commit_error names D5, never force-added
  ---
  duration_ms: 218.431916
  type: 'test'
  ...
# Subtest: get_context: manifest without bodies, files in full, lane guide from the repo with framing, source and serve_id
ok 845 - get_context: manifest without bodies, files in full, lane guide from the repo with framing, source and serve_id
  ---
  duration_ms: 298.814405
  type: 'test'
  ...
# Subtest: get_context lane in a repo without .claude/skills/... returns the bundled guide
ok 846 - get_context lane in a repo without .claude/skills/... returns the bundled guide
  ---
  duration_ms: 291.68684
  type: 'test'
  ...
# Subtest: unknown tool is a protocol error; schema-invalid arguments are rejected by the SDK before any handler runs
ok 847 - unknown tool is a protocol error; schema-invalid arguments are rejected by the SDK before any handler runs
  ---
  duration_ms: 219.48867
  type: 'test'
  ...
# Subtest: project: an unserved path is VALIDATION_FAILED, the served path works, and two repos can be served
ok 848 - project: an unserved path is VALIDATION_FAILED, the served path works, and two repos can be served
  ---
  duration_ms: 281.238003
  type: 'test'
  ...
# Subtest: stdout stays MCP-only and the server exits when the client disconnects (no leaked process)
ok 849 - stdout stays MCP-only and the server exits when the client disconnects (no leaked process)
  ---
  duration_ms: 717.525975
  type: 'test'
  ...
# Subtest: create_track creates history.md with a one-line header, committed with the track; conversation.md stays untracked
ok 850 - create_track creates history.md with a one-line header, committed with the track; conversation.md stays untracked
  ---
  duration_ms: 467.973341
  type: 'test'
  ...
# Subtest: append_conversation: author system lands in history.md as a dated line and is committed; the answer names the file
ok 851 - append_conversation: author system lands in history.md as a dated line and is committed; the answer names the file
  ---
  duration_ms: 549.360481
  type: 'test'
  ...
# Subtest: append_conversation: human, claude and gemini stay in conversation.md and are not committed
ok 852 - append_conversation: human, claude and gemini stay in conversation.md and are not committed
  ---
  duration_ms: 561.31805
  type: 'test'
  ...
# Subtest: an older track without history.md gets it with its first system entry; lines append in order; multi-line text is one line
ok 853 - an older track without history.md gets it with its first system entry; lines append in order; multi-line text is one line
  ---
  duration_ms: 450.577458
  type: 'test'
  ...
# Subtest: a system body that is already a turn or a dated line is refused, nothing is written
ok 854 - a system body that is already a turn or a dated line is refused, nothing is written
  ---
  duration_ms: 359.121828
  type: 'test'
  ...
# Subtest: formatHistoryLine: UTC minute stamp, one line, emoji first
ok 855 - formatHistoryLine: UTC minute stamp, one line, emoji first
  ---
  duration_ms: 0.878308
  type: 'test'
  ...
# Subtest: the scaffold creates an empty history.md beside each first track and its .gitignore lines do not ignore it
ok 856 - the scaffold creates an empty history.md beside each first track and its .gitignore lines do not ignore it
  ---
  duration_ms: 14.721945
  type: 'test'
  ...
# Subtest: plan_has_log: a clean plan, and a plan with many task checkboxes, are not flagged
ok 857 - plan_has_log: a clean plan, and a plan with many task checkboxes, are not flagged
  ---
  duration_ms: 2.427254
  type: 'test'
  ...
# Subtest: plan_has_log: exactly one dated heading is clean, two are a log
ok 858 - plan_has_log: exactly one dated heading is clean, two are a log
  ---
  duration_ms: 0.551675
  type: 'test'
  ...
# Subtest: plan_has_log: STATUS, RELEASE, INCIDENT, UPDATE and LOG headings (any case, with an emoji) count; a numbered section or a fenced heading does not
ok 859 - plan_has_log: STATUS, RELEASE, INCIDENT, UPDATE and LOG headings (any case, with an emoji) count; a numbered section or a fenced heading does not
  ---
  duration_ms: 1.4067
  type: 'test'
  ...
# Subtest: plan_has_log: a plan over 60 KB is flagged without any dated heading
ok 860 - plan_has_log: a plan over 60 KB is flagged without any dated heading
  ---
  duration_ms: 0.865795
  type: 'test'
  ...
# Subtest: plan_has_log: get_track warns within 200 characters and names the file and the count; a clean track has no such warning
ok 861 - plan_has_log: get_track warns within 200 characters and names the file and the count; a clean track has no such warning
  ---
  duration_ms: 381.65414
  type: 'test'
  ...
# Subtest: plan_has_log: list_tracks gives ONE aggregate line with the count and the first track numbers; the summary lint lists the track
ok 862 - plan_has_log: list_tracks gives ONE aggregate line with the count and the first track numbers; the summary lint lists the track
  ---
  duration_ms: 305.887991
  type: 'test'
  ...
# Subtest: plan_has_log: the generated summary file carries the lint after a track write, and does not change when only a checkbox is ticked
ok 863 - plan_has_log: the generated summary file carries the lint after a track write, and does not change when only a checkbox is ticked
  ---
  duration_ms: 407.573688
  type: 'test'
  ...
# Subtest: ops/tracks.md has the contract: a table of the six files, plan.md as the task tracker, the history line format and the splitting procedure
ok 864 - ops/tracks.md has the contract: a table of the six files, plan.md as the task tracker, the history line format and the splitting procedure
  ---
  duration_ms: 0.546185
  type: 'test'
  ...
# Subtest: the plan lane guides (skill and bundled) and SKILL.md name the contract; the other lane guides carry the one-line rule
ok 865 - the plan lane guides (skill and bundled) and SKILL.md name the contract; the other lane guides carry the one-line rule
  ---
  duration_ms: 0.421891
  type: 'test'
  ...
# Subtest: the scaffold's workflow.md template (skill text and generator) carries the contract
ok 866 - the scaffold's workflow.md template (skill text and generator) carries the contract
  ---
  duration_ms: 0.892224
  type: 'test'
  ...
# Subtest: the shipped base text has no daemon-era words, no `lc` command and no track number in the contract sections
ok 867 - the shipped base text has no daemon-era words, no `lc` command and no track number in the contract sections
  ---
  duration_ms: 1.09267
  type: 'test'
  ...
# Subtest: the generated commands carry the contract: the plan lane and run command include both sections; the built base plugin is Markdown only
ok 868 - the generated commands carry the contract: the plan lane and run command include both sections; the built base plugin is Markdown only
  ---
  duration_ms: 33.508066
  type: 'test'
  ...
# Subtest: resolveTrack finds both naming conventions by number
ok 869 - resolveTrack finds both naming conventions by number
  ---
  duration_ms: 1.761505
  type: 'test'
  ...
# Subtest: resolveTrack: unknown number is TRACK_NOT_FOUND, two folders for one number is AMBIGUOUS_TRACK
ok 870 - resolveTrack: unknown number is TRACK_NOT_FOUND, two folders for one number is AMBIGUOUS_TRACK
  ---
  duration_ms: 1.540992
  type: 'test'
  ...
# Subtest: a longer number never matches a shorter prefix
ok 871 - a longer number never matches a shorter prefix
  ---
  duration_ms: 0.240712
  type: 'test'
  ...
# Subtest: folder name helpers
ok 872 - folder name helpers
  ---
  duration_ms: 0.523482
  type: 'test'
  ...
# Subtest: nextNumber is max(local both conventions, upstream) + 1
ok 873 - nextNumber is max(local both conventions, upstream) + 1
  ---
  duration_ms: 1.205222
  type: 'test'
  ...
# Subtest: slugify
ok 874 - slugify
  ---
  duration_ms: 0.417454
  type: 'test'
  ...
# Subtest: defaultInitials: argument, else the most common prefix, else XX
ok 875 - defaultInitials: argument, else the most common prefix, else XX
  ---
  duration_ms: 0.339437
  type: 'test'
  ...
# Subtest: buildTrackFiles makes six files whose index.md satisfies the format rules
ok 876 - buildTrackFiles makes six files whose index.md satisfies the format rules
  ---
  duration_ms: 1.586918
  type: 'test'
  ...
# Subtest: buildTrackFiles rejects a problem that would corrupt the header block
ok 877 - buildTrackFiles rejects a problem that would corrupt the header block
  ---
  duration_ms: 0.557797
  type: 'test'
  ...
# Subtest: buildTrackFiles bug: problem text unchanged, then the six bug sections in order, regression test first
ok 878 - buildTrackFiles bug: problem text unchanged, then the six bug sections in order, regression test first
  ---
  duration_ms: 0.851247
  type: 'test'
  ...
# Subtest: buildTrackFiles feature: problem text unchanged, then the five feature sections
ok 879 - buildTrackFiles feature: problem text unchanged, then the five feature sections
  ---
  duration_ms: 0.342764
  type: 'test'
  ...
# Subtest: buildTrackFiles with no kind keeps the generic skeleton byte for byte
ok 880 - buildTrackFiles with no kind keeps the generic skeleton byte for byte
  ---
  duration_ms: 0.220894
  type: 'test'
  ...
# Subtest: the script is executable bash with valid syntax and documents itself
ok 881 - the script is executable bash with valid syntax and documents itself
  ---
  duration_ms: 29.294068
  type: 'test'
  ...
# Subtest: dry run prints every command in order, creates nothing and runs no claude command
ok 882 - dry run prints every command in order, creates nothing and runs no claude command
  ---
  duration_ms: 281.088457
  type: 'test'
  ...
# Subtest: a real run (fake claude) prints each command right before running it, in the scratch repository, at local scope
ok 883 - a real run (fake claude) prints each command right before running it, in the scratch repository, at local scope
  ---
  duration_ms: 622.804631
  type: 'test'
  ...
# Subtest: it refuses this repository, a path inside it, a non-git folder, a repository outside the temp folder without the marker, and a leftover try marketplace
ok 884 - it refuses this repository, a path inside it, a non-git folder, a repository outside the temp folder without the marker, and a leftover try marketplace
  ---
  duration_ms: 999.333874
  type: 'test'
  ...
# Subtest: step 4 disables nothing when no other laneconductor plugin is enabled, and warns (without failing) when the plugin list cannot be read
ok 885 - step 4 disables nothing when no other laneconductor plugin is enabled, and warns (without failing) when the plugin list cannot be read
  ---
  duration_ms: 2293.606849
  type: 'test'
  ...
# Subtest: a Lane Status-only write from a base that predates a lane move is a CONFLICT on Lane, and writes nothing
ok 886 - a Lane Status-only write from a base that predates a lane move is a CONFLICT on Lane, and writes nothing
  ---
  duration_ms: 687.085948
  type: 'test'
  ...
# Subtest: a Lane Status write from a current base still works, and Lane in the same call is not compared twice
ok 887 - a Lane Status write from a current base still works, and Lane in the same call is not compared twice
  ---
  duration_ms: 587.614323
  type: 'test'
  ...
# Subtest: leaving done needs reopen: Lane, files.index and outcome are refused without it, and work with it
ok 888 - leaving done needs reopen: Lane, files.index and outcome are refused without it, and work with it
  ---
  duration_ms: 668.522485
  type: 'test'
  ...
# Subtest: the done guard comes after the conflict check: a stale base to leave done is a CONFLICT, not a refusal
ok 889 - the done guard comes after the conflict check: a stale base to leave done is a CONFLICT, not a refusal
  ---
  duration_ms: 520.291202
  type: 'test'
  ...
# Subtest: TC-6: get_track carries valid.next for the track's lane; get_context carries the table for every lane; both are additive
ok 890 - TC-6: get_track carries valid.next for the track's lane; get_context carries the table for every lane; both are additive
  ---
  duration_ms: 744.048857
  type: 'test'
  ...
# Subtest: TC-6: a track in a lane the workflow does not have gets valid.next null and says why, never a guess
ok 891 - TC-6: a track in a lane the workflow does not have gets valid.next null and says why, never a guess
  ---
  duration_ms: 679.666984
  type: 'test'
  ...
# Subtest: TC-7: outcome success on an in-progress track lands in review:queue in ONE commit touching only that track's index.md (and the summary); failure lands in in-progress:failure
ok 892 - TC-7: outcome success on an in-progress track lands in review:queue in ONE commit touching only that track's index.md (and the summary); failure lands in in-progress:failure
  ---
  duration_ms: 1147.947188
  type: 'test'
  ...
# Subtest: TC-7: outcome can ride along with other markers and the summary in the same commit
ok 893 - TC-7: outcome can ride along with other markers and the summary in the same commit
  ---
  duration_ms: 630.356487
  type: 'test'
  ...
# Subtest: TC-8: outcome with Lane or Lane Status markers (or files.index) is VALIDATION_FAILED with a hint; nothing is written
ok 894 - TC-8: outcome with Lane or Lane Status markers (or files.index) is VALIDATION_FAILED with a hint; nothing is written
  ---
  duration_ms: 573.88662
  type: 'test'
  ...
# Subtest: TC-8: an outcome that resolves to no automatic move (backlog, done) is refused with the reason
ok 895 - TC-8: an outcome that resolves to no automatic move (backlog, done) is refused with the reason
  ---
  duration_ms: 650.760983
  type: 'test'
  ...
# Subtest: TC-8: a stale base still gives CONFLICT and nothing is written (the lane the outcome resolves from is the one the caller saw)
ok 896 - TC-8: a stale base still gives CONFLICT and nothing is written (the lane the outcome resolves from is the one the caller saw)
  ---
  duration_ms: 554.972465
  type: 'test'
  ...
# Subtest: TC-9: over stdio against fixture A: create, move to in-progress with the project's own name, outcome success, read back review / queue; wrong names keep the 10128 suggestion
ok 897 - TC-9: over stdio against fixture A: create, move to in-progress with the project's own name, outcome success, read back review / queue; wrong names keep the 10128 suggestion
  ---
  duration_ms: 490.85887
  type: 'test'
  ...
# Subtest: update_track input schema: outcome is an optional enum success | failure; an unknown outcome is refused
ok 898 - update_track input schema: outcome is an optional enum success | failure; an unknown outcome is refused
  ---
  duration_ms: 369.190846
  type: 'test'
  ...
# Subtest: AM-10137 TC-4: outcome in review and quality-gate writes Verdict (pass on success, fail on failure); other lanes leave it alone
ok 899 - AM-10137 TC-4: outcome in review and quality-gate writes Verdict (pass on success, fail on failure); other lanes leave it alone
  ---
  duration_ms: 932.316951
  type: 'test'
  ...
# Subtest: AM-10137 TC-4: an explicit Verdict with an outcome wins over the derived one
ok 900 - AM-10137 TC-4: an explicit Verdict with an outcome wins over the derived one
  ---
  duration_ms: 465.968892
  type: 'test'
  ...
# Subtest: AM-10137 TC-5: Verdict other than pass or fail is refused; null clears it
ok 901 - AM-10137 TC-5: Verdict other than pass or fail is refused; null clears it
  ---
  duration_ms: 498.320785
  type: 'test'
  ...
# Subtest: AM-10137 TC-6: outcome clears Waiting Reason and Waiting On Tracks; a base that never saw them is not a conflict
ok 902 - AM-10137 TC-6: outcome clears Waiting Reason and Waiting On Tracks; a base that never saw them is not a conflict
  ---
  duration_ms: 483.699989
  type: 'test'
  ...
# Subtest: AM-10137 TC-7: the bundled review and quality-gate guides carry the clear-at-claim line and say the outcome writes Verdict
ok 903 - AM-10137 TC-7: the bundled review and quality-gate guides carry the clear-at-claim line and say the outcome writes Verdict
  ---
  duration_ms: 0.284544
  type: 'test'
  ...
# Subtest: TC-17: resolveTransition (lane results and verdicts in laneconductor.sync.mjs): identical to the old daemon for every real value, lane and outcome
ok 904 - TC-17: resolveTransition (lane results and verdicts in laneconductor.sync.mjs): identical to the old daemon for every real value, lane and outcome
  ---
  duration_ms: 18.871241
  type: 'test'
  ...
# Subtest: TC-17: the old daemon's retry behavior is kept by a named shim: a bare same-lane failure target that has not hit max_retries re-queues, 1020 says failure
ok 905 - TC-17: the old daemon's retry behavior is kept by a named shim: a bare same-lane failure target that has not hit max_retries re-queues, 1020 says failure
  ---
  duration_ms: 0.152116
  type: 'test'
  ...
# Subtest: TC-17: DIFFERENCES between the old daemon and the shared module, for odd or malformed targets (named, asserted, left to the owner)
ok 906 - TC-17: DIFFERENCES between the old daemon and the shared module, for odd or malformed targets (named, asserted, left to the owner)
  ---
  duration_ms: 0.955133
  type: 'test'
  ...
# Subtest: TC-17: DIFFERENCES daemon resolver vs shared resolver: stay / stop, defaults.on_*, null targets, legacy bare targets (owner decides each)
ok 907 - TC-17: DIFFERENCES daemon resolver vs shared resolver: stay / stop, defaults.on_*, null targets, legacy bare targets (owner decides each)
  ---
  duration_ms: 0.790233
  type: 'test'
  ...
# Subtest: TC-17: spawnCli (agent-runtime.mjs): the lane written after a run is the same for legacy bare targets
ok 908 - TC-17: spawnCli (agent-runtime.mjs): the lane written after a run is the same for legacy bare targets
  ---
  duration_ms: 0.54894
  type: 'test'
  ...
# Subtest: TC-17: orphaned-dispatch matchForwardTransition: identical for every fixture lane, target and outcome
ok 909 - TC-17: orphaned-dispatch matchForwardTransition: identical for every fixture lane, target and outcome
  ---
  duration_ms: 0.769343
  type: 'test'
  ...
# Subtest: TC-17: resting-state: which lanes park at their own success is the same for every fixture
ok 910 - TC-17: resting-state: which lanes park at their own success is the same for every fixture
  ---
  duration_ms: 0.492744
  type: 'test'
  ...
# Subtest: TC-17: daemon sites that were NOT patched are listed, so the owner can decide (they pass a raw target string as a lane)
ok 911 - TC-17: daemon sites that were NOT patched are listed, so the owner can decide (they pass a raw target string as a lane)
  ---
  duration_ms: 3.12323
  type: 'test'
  ...
# Subtest: the fixtures are what the brief says they are
ok 912 - the fixtures are what the brief says they are
  ---
  duration_ms: 1.111636
  type: 'test'
  ...
# Subtest: TC-1 (A, legacy): bare targets resolve through the 1020 defaults; backlog and done have no automatic move
ok 913 - TC-1 (A, legacy): bare targets resolve through the 1020 defaults; backlog and done have no automatic move
  ---
  duration_ms: 0.577824
  type: 'test'
  ...
# Subtest: TC-2 (B, current): lane:status targets are used as written
ok 914 - TC-2 (B, current): lane:status targets are used as written
  ---
  duration_ms: 0.225343
  type: 'test'
  ...
# Subtest: TC-3 (grammar): bare different lane -> queue; bare same lane -> success / failure; explicit as written; bare done is done:queue; null or absent is no move
ok 915 - TC-3 (grammar): bare different lane -> queue; bare same lane -> success / failure; explicit as written; bare done is done:queue; null or absent is no move
  ---
  duration_ms: 0.842751
  type: 'test'
  ...
# Subtest: TC-4 (C, custom): a custom lane resolves through the workflow's own keys; mixed formats; an unknown lane is an explicit error
ok 916 - TC-4 (C, custom): a custom lane resolves through the workflow's own keys; mixed formats; an unknown lane is an explicit error
  ---
  duration_ms: 0.637116
  type: 'test'
  ...
# Subtest: TC-4: backlog is a known place with no automatic move, even when the workflow leaves it out
ok 917 - TC-4: backlog is a known place with no automatic move, even when the workflow leaves it out
  ---
  duration_ms: 0.216186
  type: 'test'
  ...
# Subtest: TC-4 (AM-10137): a lane that omits on_success / on_failure inherits `defaults`; an explicit null does not; the lane value wins
ok 918 - TC-4 (AM-10137): a lane that omits on_success / on_failure inherits `defaults`; an explicit null does not; the lane value wins
  ---
  duration_ms: 0.211497
  type: 'test'
  ...
# Subtest: TC-4 (AM-10137): the otralingo legacy fixture (A) has `defaults` without targets, so its rows do not change
ok 919 - TC-4 (AM-10137): the otralingo legacy fixture (A) has `defaults` without targets, so its rows do not change
  ---
  duration_ms: 0.213671
  type: 'test'
  ...
# Subtest: TC-4 (AM-10137): `stay` and `stop` are read as "no automatic move" (an old workflow.json), never as a lane
ok 920 - TC-4 (AM-10137): `stay` and `stop` are read as "no automatic move" (an old workflow.json), never as a lane
  ---
  duration_ms: 0.413516
  type: 'test'
  ...
# Subtest: TC-5 (names): a project on the guide names and one on the old names resolve the same logical transitions
ok 921 - TC-5 (names): a project on the guide names and one on the old names resolve the same logical transitions
  ---
  duration_ms: 0.465824
  type: 'test'
  ...
# Subtest: describeNext: both directions at once, for valid.next
ok 922 - describeNext: both directions at once, for valid.next
  ---
  duration_ms: 0.290605
  type: 'test'
  ...
# Subtest: the lane of a transition is the same list the table above was built from: every lane of every fixture resolves both ways
ok 923 - the lane of a transition is the same list the table above was built from: every lane of every fixture resolves both ways
  ---
  duration_ms: 0.217057
  type: 'test'
  ...
# Subtest: TC-16: ONE logic, two callers: no second copy of the transition grammar outside conductor/services/workflow-transitions.mjs
ok 924 - TC-16: ONE logic, two callers: no second copy of the transition grammar outside conductor/services/workflow-transitions.mjs
  ---
  duration_ms: 15.463536
  type: 'test'
  ...
# Subtest: TC-16: the connector and the daemon sites import the shared module
ok 925 - TC-16: the connector and the daemon sites import the shared module
  ---
  duration_ms: 2.688625
  type: 'test'
  ...
# Subtest: TC-18: the add-on ships conductor/services/workflow-transitions.mjs, byte-identical to the source
ok 926 - TC-18: the add-on ships conductor/services/workflow-transitions.mjs, byte-identical to the source
  ---
  duration_ms: 0.761419
  type: 'test'
  ...
# Subtest: TC-18: installed layout: a copy of the add-on (a plain directory with the npm dependencies beside it) serves valid.next and outcome through stdio
ok 927 - TC-18: installed layout: a copy of the add-on (a plain directory with the npm dependencies beside it) serves valid.next and outcome through stdio
  ---
  duration_ms: 771.24661
  type: 'test'
  ...
1..927
# tests 927
# suites 0
# pass 927
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 20975.872212 (look for ); plugins/laneconductor, plugins/laneconductor-parallel, plugins/laneconductor-board, .claude-plugin/marketplace.json and docs/plugin-map.md are up to date.
6 skill packs (scripts/skill-packs.json) are covered by the same check.; Validating marketplace manifest: /tmp/claude-1000/-home-meller-Code-laneconductor/413264fe-1b48-4c41-9780-01d5ab4047f1/scratchpad/pw/.claude-plugin/marketplace.json

✔ Validation passed
- 

## Test Cases
- [ ] TC-1 (REQ-2): a synthetic repository with a lane claim, three plan ticks and a completion line yields one lane run with three phases and the right boundaries
- [ ] TC-2 (REQ-3): a synthetic transcript with known token counts, a long gap and a sub-agent run gives exactly the expected active time, waiting time, token split and sub-agent share
- [ ] TC-3 (REQ-4): a transcript whose content holds a token and an email never produces either in the printed table or in 
- [ ] TC-4 (REQ-5): running twice gives the same  apart from the generated-at line; the file names its sources
- [ ] TC-5 (REQ-6): the board for a track with an  has the "Agent run" tab; a withheld file (a secret match) shows the standard placeholder
- [ ] TC-6 (REQ-7): diff --git a/conductor/tracks/AM-10107-laneconductor-recipe-library-discoverable-skills-bootstrap-project/plan.md b/conductor/tracks/AM-10107-laneconductor-recipe-library-discoverable-skills-bootstrap-project/plan.md
index b5caaea9..2da32cb6 100644
--- a/conductor/tracks/AM-10107-laneconductor-recipe-library-discoverable-skills-bootstrap-project/plan.md
+++ b/conductor/tracks/AM-10107-laneconductor-recipe-library-discoverable-skills-bootstrap-project/plan.md
@@ -66,13 +66,13 @@ what Claude does.
 paired baseline in test.md. If the recipe does not beat plain Claude, stop and rethink before
 building anything.
 
-- [ ] Task 1: Create the library repo per D1 (`git init -b main` in `/home/meller/Code/lc-recipes`, `README.md` stating the format rules from spec REQ-1..6). No remote; the human adds it.
-- [ ] Task 2: Write `recipes/shared-gcp-firebase-site/SKILL.md` and `files/.firebaserc.tmpl`, `files/firebase.json.tmpl` from the spec example; re-check every reference path at its cited commit with `git -C <repo> cat-file -e <commit>:<path>`
-- [ ] Task 3: Check the codebase pitfall ("a shared `default` codebase across repos treats the other repo's functions as removed") against the Firebase Functions docs on codebases; keep, correct or delete it, and note the source
-- [ ] Task 4: Check the format by hand: `description` + `when_to_use` <= 1,536 characters, `metadata` is a map, no reused field names, no secret patterns (spec REQ-12), body sections in order
-- [ ] Task 5: AC-3 check: copy the folder into `~/.claude/skills/`, confirm it is listed in a fresh Claude Code session with no frontmatter error, then delete the copy
-- [ ] Task 6: Run the paired baseline (test.md TC-1.5 to TC-1.8): 3 plain runs, 3 recipe runs, scored on the rubric
-- [ ] Task 7: Record the scores in `baseline.md` in this track folder and a one-paragraph verdict in `conversation.md`. If the recipe does not beat the baseline by at least 2 points, set `**Lane Status**: waiting` with a question to the human instead of continuing.
+- [x] Task 1: Create the library repo per D1 (`git init -b main` in `/home/meller/Code/lc-recipes`, `README.md` stating the format rules from spec REQ-1..6). No remote; the human adds it.
+- [x] Task 2: Write `recipes/shared-gcp-firebase-site/SKILL.md` and `files/.firebaserc.tmpl`, `files/firebase.json.tmpl` from the spec example; re-check every reference path at its cited commit with `git -C <repo> cat-file -e <commit>:<path>`
+- [x] Task 3: Check the codebase pitfall (CONFIRMED against firebase.google.com/docs/functions/organize-functions "Managing multiple repositories" and reworded in the recipe; the `/api**` and `/healthz` pitfalls are repo-sourced, labelled as such) ("a shared `default` codebase across repos treats the other repo's functions as removed") against the Firebase Functions docs on codebases; keep, correct or delete it, and note the source
+- [x] Task 4: Check the format by hand: `description` + `when_to_use` <= 1,536 characters, `metadata` is a map, no reused field names, no secret patterns (spec REQ-12), body sections in order
+- [ ] (HUMAN) Task 5: AC-3 check: copy the folder into `~/.claude/skills/`, confirm it is listed in a fresh Claude Code session with no frontmatter error, then delete the copy
+- [x] Task 6: Run the paired baseline (test.md TC-1.5 to TC-1.8): 3 plain runs, 3 recipe runs, scored on the rubric (done as 6 separate sub-agents plus a blind scorer sub-agent; plain 3/3/3, recipe 7/7/7; see `baseline.md`)
+- [x] Task 7: Record the scores in `baseline.md` in this track folder and a one-paragraph verdict in `conversation.md`. If the recipe does not beat the baseline by at least 2 points, set `**Lane Status**: waiting` with a question to the human instead of continuing. (Result 2026-11-17: beat by 4 points, rule passed, so no waiting; caveat in `baseline.md` that R1-R4 are unguessable by plain Claude by construction, so the gap shows the recipe is followed, not that it beats plain Claude on general knowledge, and discovery is untested until Phase 8.)
 
 **Impact**: The format is validated on a real case, and there is evidence (not opinion) that recipes
 change Claude's output.
@@ -82,11 +82,13 @@ change Claude's output.
 **Problem**: By-hand checks do not scale to the other recipes or catch secrets reliably.
 **Solution**: Pure modules plus a CLI, no MCP code.
 
-- [ ] Task 1: `connector/src/recipes/format.mjs`: parse frontmatter (YAML), enforce REQ-1..4 (folder name = `name`, allowed top-level fields, `metadata` keys and types, `kind` values, 1,536-character cap, body sections and their order, 8,000-character body cap), return `{ ok, errors: [{ field, message }] }`
-- [ ] Task 2: `connector/src/recipes/secrets.mjs`: the REQ-12 patterns; returns matches with file and line only, never the matched text
-- [ ] Task 3: `connector/src/recipes/references.mjs`: resolve `owner/name` to a local repo by `origin` URL under the roots (REQ-10), then check `cat-file -e <commit>:<path>` and compare the blob at the commit with the blob at `HEAD`; produce `freshness` and `stale_reasons` (REQ-9)
-- [ ] Task 4: `connector/bin/lc-recipe-check.mjs <library dir>`: runs all three on every recipe, prints one line per finding, exits 1 on any error
-- [ ] Task 5: Run it on the Phase 1 recipe; it must pass with zero findings
+- [x] Task 1: `connector/src/recipes/format.mjs` (adds ONE dependency, `yaml` 2.9.1 exact, for the frontmatter): parse frontmatter (YAML), enforce REQ-1..4 (folder name = `name`, allowed top-level fields, `metadata` keys and types, `kind` values, 1,536-character cap, body sections and their order, 8,000-character body cap), return `{ ok, errors: [{ field, message }] }`
+- [x] Task 2: `connector/src/recipes/secrets.mjs`: the REQ-12 patterns; returns matches with file and line only, never the matched text (`sk-` pattern gets a lookbehind so words like `task-management-...` do not match)
+- [x] Task 3: `connector/src/recipes/references.mjs`: resolve `owner/name` to a local repo by `origin` URL under the roots (REQ-10), then check `cat-file -e <commit>:<path>` and compare the blob at the commit with the blob at `HEAD`; produce `freshness` and `stale_reasons` (REQ-9)
+- [x] Task 4: `connector/bin/lc-recipe-check.mjs <library dir>`: runs all three on every recipe, prints one line per finding, exits 1 on any error
+- [x] Task 5: Run it on the Phase 1 recipe; it must pass with zero findings
+
+**Done 2026-11-17**: `check-library.mjs` (the folder walk the CLI uses) is also in `connector/src/recipes/`. Checker findings are `error` (fails, exit 1) or `warn` (a reference repo with no local checkout, a possibly stale recipe; exit 0). `lc-recipe-check` also takes `--ref-root <dir>` (default `~/Code`) for the reference resolver; on the real library it reports `0 errors, 0 warnings`.
 
 **Impact**: Every later recipe and every `save_recipe` call goes through the same checks.
 
@@ -95,18 +97,31 @@ change Claude's output.
 **Problem**: The library is useful only once the conventions that hurt during Dual Reader are in it.
 **Solution**: Write each from the FOUND references in spec.md; keep only what Claude cannot derive.
 
-- [ ] Task 1: `vertex-gemini-adc` (references: dual-reader `geminiGenerator.ts`, tokentalos `llm_clients.js`); `## You run` holds `gcloud auth application-default login` and the role grant command
-- [ ] Task 2: `browser-tts-unlock-voice-binding` (otralingo `AudioUnlocker.tsx`, dual-reader `audioUnlocker.ts` and `speechSynthesisClock.ts`); `files/audioUnlocker.ts` template from the dual-reader version
-- [ ] Task 3: `vertex-imagen-retry-gcs-fallback` (the_hero_journey `image-generation.ts`, dual-reader `vertexImagenGenerator.ts`)
-- [ ] Task 4: `makefile-local-run` (dual-reader and otralingo Makefiles); `files/Makefile.tmpl` with `help`, `install-all`, `env-file`, `db-local`, `db-seed`, `db-reset`, `dev`, `test-all`, `stop-all`, `deploy`
-- [ ] Task 5: `postgres-local-neon-prod-secret-manager` (dual-reader `functions/index.mjs`, `scripts/deploy.sh`, `.env.example`; livingwork `functions/src/index.ts`); state a secret naming rule (`<PRODUCT>_DATABASE_URL`) as a recommendation, since the two references differ
-- [ ] Task 6: `isolated-test-database` (dual-reader `vitest.config.ts` and commit `27666b1`, livingwork `vitest.config.ts`); the per-worktree DB part goes under `## Unproven` because no reference exists (spec seed table: NOT FOUND)
-- [ ] Task 7: Process recipe `new-project` (`kind: process`): ask the name and stack, `find_recipe`, show the chosen recipes and why, `bootstrap_project`, write files, hand the user the checklist, verify with `make help` and `make db-local`
-- [ ] Task 8: Process recipe `extract-recipe` (`kind: process`): REQ-16 criteria, find-before-add, draft, check, human OK, `save_recipe`; and the retire path (REQ-17)
-- [ ] Task 9: `lc-recipe-check` passes on all nine; every seed recipe has `verified` set
+- [x] Task 1: `vertex-gemini-adc` (references: dual-reader `geminiGenerator.ts`, tokentalos `llm_clients.js`); `## You run` holds `gcloud auth application-default login` and the role grant command
+- [x] Task 2: `browser-tts-unlock-voice-binding` (otralingo `AudioUnlocker.tsx`, dual-reader `audioUnlocker.ts` and `speechSynthesisClock.ts`); `files/audioUnlocker.ts` template from the dual-reader version
+- [x] Task 3: `vertex-imagen-retry-gcs-fallback` (the_hero_journey `image-generation.ts`, dual-reader `vertexImagenGenerator.ts`)
+- [x] Task 4: `makefile-local-run` (dual-reader and otralingo Makefiles); `files/Makefile.tmpl` with `help`, `install-all`, `env-file`, `db-local`, `db-seed`, `db-reset`, `dev`, `test-all`, `stop-all`, `deploy`
+- [x] Task 5: `postgres-local-neon-prod-secret-manager` (dual-reader `functions/index.mjs`, `scripts/deploy.sh`, `.env.example`; livingwork `functions/src/index.ts`); state a secret naming rule (`<PRODUCT>_DATABASE_URL`) as a recommendation, since the two references differ
+- [x] Task 6: `isolated-test-database` (dual-reader `vitest.config.ts` and commit `27666b1`, livingwork `vitest.config.ts`); the per-worktree DB part goes under `## Unproven` because no reference exists (spec seed table: NOT FOUND)
+- [x] Task 7: Process recipe `new-project` (`kind: process`): ask the name and stack, `find_recipe`, show the chosen recipes and why, `bootstrap_project`, write files, hand the user the checklist, verify with `make help` and `make db-local`
+- [x] Task 8: Process recipe `extract-recipe` (`kind: process`): REQ-16 criteria, find-before-add, draft, check, human OK, `save_recipe`; and the retire path (REQ-17)
+- [x] Task 9: `lc-recipe-check` passes on all nine; every seed recipe has `verified` set
 
 **Impact**: All seven seed conventions are written down, each pointing at working code.
 
+## Phase 3c: The library as a Claude plugin (added 2026-11-17, after reading the Claude plugin docs)
+
+**Problem**: Recipes are skills, and a plugin marketplace is a git repo: Claude Code and claude.ai already provide discovery, install, updates and org sharing for skills, so building our own search and install tooling may be redundant ("don't out-engineer Claude").
+**Solution**: Package `~/Code/lc-recipes` as a plugin and its own marketplace, then measure native discovery before deciding on Phases 4-6.
+
+- [x] Task 1: `.claude-plugin/plugin.json` (`skills: ["./recipes"]`) and `.claude-plugin/marketplace.json` (source `./`) in the library repo; no top-level `bin/` (it would stop claude.ai and Cowork installing). `claude plugin validate . --strict` passes on both (lc-recipes commit e5eca05)
+- [x] Task 2: Verified without installing: `claude --plugin-dir ~/Code/lc-recipes plugin details lc-recipes` lists all 9 recipes as skills and projects about 1.2k always-on tokens for all nine (110-160 each), about 0.75-1.4k per skill when invoked
+- [ ] Task 3 (HUMAN): `claude plugin marketplace add ~/Code/lc-recipes` then `claude plugin install lc-recipes@lc-recipes` (these edit the user's Claude settings, so they are not done here); `/reload-plugins`
+- [ ] Task 4 (HUMAN, needs a real session): native-discovery test. In a fresh Claude Code session with the plugin installed and NO recipe named in the prompt, run the Phase 1 task ("set up hosting and an API deploy config for a new web app called pinecone ...") 3 times and score with the frozen rubric in `baseline.md`; also run `claude plugin eval` once evals exist (add `evals/` cases from the baseline prompt). Pass = the recipe fires on its own in at least 2 of 3 runs and the output scores like the pasted-recipe arm
+- [ ] Task 5: Decision, recorded in `index.md`: if native discovery works, drop `find_recipe`, `get_recipe` and `bootstrap_project` (keep Phase 2's checker and scanner, and the advice log for accountability); otherwise resume Phase 4 from the parked code. The Phase 4 code stays uncommitted in the worktree until then
+
+**Impact**: Recipes reach Claude on every surface that loads plugin skills, with no server to run or deploy.
+
 ## Phase 4: `find_recipe` and `get_recipe`
 
 **Problem**: Claude needs to search the library and read one recipe on demand.
diff --git a/conductor/tracks/AM-10107-laneconductor-recipe-library-discoverable-skills-bootstrap-project/spec.md b/conductor/tracks/AM-10107-laneconductor-recipe-library-discoverable-skills-bootstrap-project/spec.md
index b8d74008..6a643d7f 100644
--- a/conductor/tracks/AM-10107-laneconductor-recipe-library-discoverable-skills-bootstrap-project/spec.md
+++ b/conductor/tracks/AM-10107-laneconductor-recipe-library-discoverable-skills-bootstrap-project/spec.md
@@ -59,6 +59,42 @@ Every path is relative to `/home/meller/Code/`.
 | 7 | `isolated-test-database` | FOUND (lesson) | `dual-reader/vitest.config.ts` (`env: { DATABASE_URL: ...dual_reader_test }`, comment "wiped the shared `dual_reader` DB mid-session, twice"), commit `27666b1` "fix: isolate test suite from the shared interactive dev database", `dual-reader/conductor/tech-stack.md:176`; also `livingwork/vitest.config.ts:17-19` (`livingwork_test`) | Tests that truncate tables must never point at the interactive dev DB; a forced test-DB override wins even when the shell sourced `.env`. |
 | 7 | | NOT FOUND | (no code) | A **per-worktree** database (one DB per worktree or preview) is not implemented in any sibling repo. `dual_reader_test` is still shared by every worktree. The recipe states that part as unproven advice with no reference. |
 
+## Connector recipes (added 2026-11-17; Claude connectors only; FFU, not part of the seven-seed pass)
+
+The same recipe format fits **how to build a Claude connector**. Three of this owner's apps already contain
+a working version of the same pieces, so the references exist today. These are candidates for Phase 9
+(plan.md) and do not change the seven seed recipes or their acceptance criteria.
+
+**Scope: Claude connectors only.** This track still assumes a Claude custom connector (remote MCP with OAuth).
+Making the same layer work for other agents (other clients, OpenAPI, capability URLs) is out of scope here; it is
+explored in the Colfiti demo and article tracks (10110, 10113).
+
+### Why recipes first, a kit later
+- A **recipe** is cheap and available now: Claude reads it and adapts it to the target app. Its weakness is
+  drift: three apps hold three copies.
+- A **connector kit** (a shared library) is the right end state only when the same fix has to be made in several
+  copies. Rule: when one defect or change is applied to a second copy of the same connector piece, extract that
+  piece into a shared package and turn the recipe into "use the package". The Extract and retire step of this
+  track already covers the move.
+
+### Candidate recipes and references (paths confirmed with `ls`/`grep` on 2026-11-16)
+Commits: fiti 27f2efe, coachai e1f4acc4, otralingo 141239f0. Paths relative to `/home/meller/Code/`.
+
+| # | Recipe (name) | Status | Reference | What it proves |
+|---|---|---|---|---|
+| 8 | `claude-connector-oauth-mcp` | FOUND | `fiti/functions/src/mcp.js`, `oauth.js`, `fiti/web/authorize.js` + `authorize-logic.js` | A remote MCP server (stateless Streamable HTTP) with OAuth 2.1 (dynamic client registration, PKCE) and a static `/authorize` page. Fiti accepts only Claude's callback URLs (`oauth.js`, `CALLBACKS`). |
+| 8 | | FOUND | `coachai/server/connector/mcp.mjs`, `oauth.mjs`, `origin.mjs`, `index.mjs` | The same pieces mounted next to an existing authenticated app. Pitfall (from `coachai/docs/claude-connector.md`): mount BEFORE pino-http, CORS and the authenticated block so OAuth query strings are not logged. Unverified here: re-read `server/index.mjs` when writing the recipe. |
+| 8 | | FOUND | `otralingo/functions/backend/src/connector/oauth.ts`, `mount.ts`, `tokens.ts`, `clients.ts`, `cleanup.ts` | A TypeScript version with token and client stores and a cleanup job. |
+| 9 | `connector-guidance` | FOUND | `coachai/server/connector/instructions.mjs` + `tools/guidelines-tools.mjs` (`get_session_guidelines`) | Behaviour delivered as data: the instructions say "call the guidelines tool before you reply", and the tool returns the mentor's instructions, what is known about the person and the safety rubric. |
+| 9 | | FOUND | `fiti/functions/src/fiti.js` (`INSTRUCTIONS`, `PROMPTS`) and `fiti/functions/src/tools.js` | Server `instructions` plus MCP prompts, and tool descriptions that each carry two to five real example sentences (`fiti/docs/design-decisions.md`, DA-011). |
+| 9 | | NOT FOUND | (no code, owner observation) | "Put the rule in three places: the tool description, the server instructions and the tool result; the result is the most reliable channel" is an observation from building the Otralingo connector. It is not written down in any repo doc. The recipe records it as an unverified lesson. |
+| 10 | `connector-invite-and-terms-gate` | FOUND | `fiti/functions/src/invites.js`, `terms.js`, `links.js`, `limits.js` | Invite-only allowlist, three invitations each, terms acceptance checked on every call, and a connection that can only start after the person presses "Allow a new Claude connection" on their own page. |
+| 10 | | FOUND | `coachai/docs/claude-connector.md` | The connector never creates users: the identity must already be a provisioned, active user who accepted the terms. |
+
+### Not recorded in recipes
+Credentials (firm rule above), user data, and anything about Fiti's health content: Fiti is invite-only and its repo
+may be a reference for code only.
+
 ## Requirements
 
 ### Format
diff --git a/conductor/tracks/AM-10107-laneconductor-recipe-library-discoverable-skills-bootstrap-project/test.md b/conductor/tracks/AM-10107-laneconductor-recipe-library-discoverable-skills-bootstrap-project/test.md
index 7785b75e..1aaa0d77 100644
--- a/conductor/tracks/AM-10107-laneconductor-recipe-library-discoverable-skills-bootstrap-project/test.md
+++ b/conductor/tracks/AM-10107-laneconductor-recipe-library-discoverable-skills-bootstrap-project/test.md
@@ -24,30 +24,30 @@ checkout (track 10082 hazard).
 ## Test Cases
 
 ### Phase 1: One recipe by hand, and the baseline (manual, observable)
-- [ ] TC-1.1: Every `reference` in `shared-gcp-firebase-site` passes `git -C <repo> cat-file -e <commit>:<path>` - expected: all 4 exist
-- [ ] TC-1.2: `description` + `when_to_use` length <= 1,536 (`wc -c` on the two values); `metadata` is a YAML map; no key under `metadata` equals a frontmatter field name - expected: all true
-- [ ] TC-1.3: `grep -nE` with every REQ-12 pattern over the recipe folder - expected: no match
-- [ ] TC-1.4: AC-3: the folder copied to `~/.claude/skills/shared-gcp-firebase-site/` shows in a fresh Claude Code session's skill list with no frontmatter warning; the copy is then removed - expected: listed, then gone
-- [ ] TC-1.5: Baseline setup: a scratch dir `/home/meller/Code/lc-recipe-baseline` with its own `git init`, no CLAUDE.md, no connector, no sibling repos mentioned. Prompt, identical in every run: "Set up hosting and an API deploy config for a new web app called pinecone (a Vite SPA plus an Express API on Cloud Functions, Postgres in prod). Don't deploy; write the config files and tell me exactly which commands I need to run." - expected: setup recorded in `baseline.md`
-- [ ] TC-1.6: Run A (plain Claude): 3 fresh sessions with the prompt only - expected: the produced files and reply saved per run
-- [ ] TC-1.7: Run B (recipe): 3 fresh sessions with the prompt plus "Use this recipe:" followed by the recipe's SKILL.md text - expected: the produced files and reply saved per run
-- [ ] TC-1.8: Score every run on the 7-point rubric (one point each, judged from files and reply): R1 uses project `laneconductor-site`, no new GCP project; R2 hosting target `pinecone` mapped to site `pinecone-laneconductor`; R3 Functions `codebase: "pinecone"`; R4 every deploy command scoped with `--only hosting:pinecone,functions:pinecone:<fn>`; R5 rewrite written `/api/**`, not `/api**`; R6 health check under `/api/...`, not a bare `/healthz`; R7 no credential handled by Claude (sign-in, secret creation and deploy are listed for the user, no value in any file) - expected: **recipe beats plain Claude** when the median of B is at least the median of A + 2 and every B run scores R7. Otherwise the gate in plan.md Phase 1 Task 7 applies.
+- [x] TC-1.1: Every `reference` in `shared-gcp-firebase-site` passes `git -C <repo> cat-file -e <commit>:<path>` - expected: all 4 exist
+- [x] TC-1.2: `description` + `when_to_use` length <= 1,536 (`wc -c` on the two values); `metadata` is a YAML map; no key under `metadata` equals a frontmatter field name - expected: all true
+- [x] TC-1.3: `grep -nE` with every REQ-12 pattern over the recipe folder - expected: no match
+- [ ] (HUMAN) TC-1.4: AC-3: the folder copied to `~/.claude/skills/shared-gcp-firebase-site/` shows in a fresh Claude Code session's skill list with no frontmatter warning; the copy is then removed - expected: listed, then gone
+- [x] TC-1.5: Baseline setup: a scratch dir `/home/meller/Code/lc-recipe-baseline` with its own `git init`, no CLAUDE.md, no connector, no sibling repos mentioned. Prompt, identical in every run: "Set up hosting and an API deploy config for a new web app called pinecone (a Vite SPA plus an Express API on Cloud Functions, Postgres in prod). Don't deploy; write the config files and tell me exactly which commands I need to run." - expected: setup recorded in `baseline.md`
+- [x] TC-1.6: Run A (plain Claude): 3 fresh sessions with the prompt only - expected: the produced files and reply saved per run
+- [x] TC-1.7: Run B (recipe): 3 fresh sessions with the prompt plus "Use this recipe:" followed by the recipe's SKILL.md text - expected: the produced files and reply saved per run
+- [x] TC-1.8: Score every run on the 7-point rubric (one point each, judged from files and reply): R1 uses project `laneconductor-site`, no new GCP project; R2 hosting target `pinecone` mapped to site `pinecone-laneconductor`; R3 Functions `codebase: "pinecone"`; R4 every deploy command scoped with `--only hosting:pinecone,functions:pinecone:<fn>`; R5 rewrite written `/api/**`, not `/api**`; R6 health check under `/api/...`, not a bare `/healthz`; R7 no credential handled by Claude (sign-in, secret creation and deploy are listed for the user, no value in any file) - expected: **recipe beats plain Claude** when the median of B is at least the median of A + 2 and every B run scores R7. Otherwise the gate in plan.md Phase 1 Task 7 applies.
 - [ ] TC-1.9 (optional, second baseline): the same A/B procedure for `vertex-gemini-adc` with the prompt "Add Gemini text generation to this Node API" - rubric: uses Vertex mode (`vertexai: true`), no API key in code or `.env`, `GCP_PROJECT`/`GCP_REGION` from env, `gcloud auth application-default login` given as a user step - expected: recorded either way
 
 ### Phase 2: Format checker and secret scanner
-- [ ] TC-2.1: A valid recipe fixture - expected: `{ ok: true, errors: [] }`
-- [ ] TC-2.2: Folder `foo-bar`, `name: foo` - expected: error on `name`
-- [ ] TC-2.3: An undocumented top-level field (`stack:` at top level) - expected: error naming the field and saying it belongs under `metadata`
-- [ ] TC-2.4: `metadata: "x"` (not a map) and `metadata.paths` (reused field name) - expected: one error each
-- [ ] TC-2.5: `metadata.kind: skill` - expected: error (only `recipe` or `process`)
-- [ ] TC-2.6: `description` + `when_to_use` of 1,537 characters - expected: error; 1,536 - expected: ok
-- [ ] TC-2.7: Body sections out of order, or `## You run` missing on a `kind: recipe` - expected: error; a `kind: process` recipe needs neither `## You run` nor `reference`
-- [ ] TC-2.8: Body over 8,000 characters - expected: error
-- [ ] TC-2.9: Secret scanner: one fixture line per REQ-12 pattern (fake values built at test time, never committed as literals) - expected: each detected with file and line, and the output never contains the matched text
-- [ ] TC-2.10: Scanner negatives: `postgresql://postgres:postgres@localhost:5432/x`, `DATABASE_URL=` (empty), `GCP_PROJECT=laneconductor-site` - expected: no match
-- [ ] TC-2.11: Reference resolver over fixture repos: `origin` `git@github.com:o/r.git` and `https://github.com/o/r` both resolve `o/r`; a folder named `r` whose origin is `o/other` does not (V6) - expected: as stated
-- [ ] TC-2.12: Freshness: path present and unchanged since the commit -> `fresh`; path changed at HEAD -> `possibly_stale` + `reference_changed_since_verified`; path deleted -> `stale` + `reference_missing`; repo not found -> `possibly_stale` + `reference_unresolvable`; `verified` 91 days old -> `verified_older_than_90d`; `verified: null` -> `stale` + `verified_missing`
-- [ ] TC-2.13: `lc-recipe-check` exits 0 on the Phase 1 recipe and 1 on a fixture with any error
+- [x] TC-2.1: A valid recipe fixture - expected: `{ ok: true, errors: [] }`
+- [x] TC-2.2: Folder `foo-bar`, `name: foo` - expected: error on `name`
+- [x] TC-2.3: An undocumented top-level field (`stack:` at top level) - expected: error naming the field and saying it belongs under `metadata`
+- [x] TC-2.4: `metadata: "x"` (not a map) and `metadata.paths` (reused field name) - expected: one error each
+- [x] TC-2.5: `metadata.kind: skill` - expected: error (only `recipe` or `process`)
+- [x] TC-2.6: `description` + `when_to_use` of 1,537 characters - expected: error; 1,536 - expected: ok
+- [x] TC-2.7: Body sections out of order, or `## You run` missing on a `kind: recipe` - expected: error; a `kind: process` recipe needs neither `## You run` nor `reference`
+- [x] TC-2.8: Body over 8,000 characters - expected: error
+- [x] TC-2.9: Secret scanner: one fixture line per REQ-12 pattern (fake values built at test time, never committed as literals) - expected: each detected with file and line, and the output never contains the matched text
+- [x] TC-2.10: Scanner negatives: `postgresql://postgres:postgres@localhost:5432/x`, `DATABASE_URL=` (empty), `GCP_PROJECT=laneconductor-site` - expected: no match
+- [x] TC-2.11: Reference resolver over fixture repos: `origin` `git@github.com:o/r.git` and `https://github.com/o/r` both resolve `o/r`; a folder named `r` whose origin is `o/other` does not (V6) - expected: as stated
+- [x] TC-2.12: Freshness: path present and unchanged since the commit -> `fresh`; path changed at HEAD -> `possibly_stale` + `reference_changed_since_verified`; path deleted -> `stale` + `reference_missing`; repo not found -> `possibly_stale` + `reference_unresolvable`; `verified` 91 days old -> `verified_older_than_90d`; `verified: null` -> `stale` + `verified_missing`
+- [x] TC-2.13: `lc-recipe-check` exits 0 on the Phase 1 recipe and 1 on a fixture with any error
 
 ### Phase 3: Seed recipes
 - [ ] TC-3.1: `lc-recipe-check /home/meller/Code/lc-recipes` - expected: exit 0, 9 recipes (7 seed + `new-project` + `extract-recipe`)
@@ -103,5 +103,5 @@ checkout (track 10082 hazard).
 ## Acceptance Criteria
 - [ ] All `node --test test/recipes-*.test.mjs` tests pass, and 10106's own suite still passes
 - [ ] `lc-recipe-check` passes on the real library
-- [ ] The Phase 1 baseline verdict is recorded (recipe beats plain Claude, or the gate fired)
+- [x] The Phase 1 baseline verdict is recorded (recipe beats plain Claude, or the gate fired)
 - [ ] No regressions in the connector's existing tools
diff --git a/conductor/tracks/AM-10108-lane-runner-skill-run-a-track-through-its-lanes-with-sub-agents-in-worktrees/index.md b/conductor/tracks/AM-10108-lane-runner-skill-run-a-track-through-its-lanes-with-sub-agents-in-worktrees/index.md
index 85865d1b..5166ebe0 100644
--- a/conductor/tracks/AM-10108-lane-runner-skill-run-a-track-through-its-lanes-with-sub-agents-in-worktrees/index.md
+++ b/conductor/tracks/AM-10108-lane-runner-skill-run-a-track-through-its-lanes-with-sub-agents-in-worktrees/index.md
@@ -3,7 +3,7 @@
 **Lane**: done
 **Lane Status**: success
 **Progress**: 100%
-**Phase**: Closed as superseded: the minimal lane-runner note was folded into the laneconductor skill (ops/working-a-track.md, routed from the index and the 'run track N' trigger) and delivered with track 10109 (merged 260c9c6e). Verified: routing and a simulated plan run read only the index + lane file; the user reports the skill works as usual. Not built: any scheduler/orchestration (withdrawn by decision).
+**Phase**: Closed as superseded: the minimal lane-runner note was folded into the laneconductor skill (ops/working-a-track.md, routed from the index and the 'run track N' trigger) and delivered with track…
 **Type**: dev
 **Merge Mode**: direct
 **Auto Run**: no of the base plugin across the track is empty
- [ ] TC-7 (REQ-8): the real run on 10154 prints a table whose lane totals are within a few percent of the transcript's own totals
- [ ] TC-8 (REQ-9): every number in the post is traceable to the real output, and the status line moved from draft to reviewed

## Acceptance Criteria
- [ ] The script runs on a real finished track and the numbers match the transcript totals
- [ ] No prompt, message or file content appears in any output
- [ ] The board shows the tab; no base plugin text changed
