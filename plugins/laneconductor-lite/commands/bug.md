---
description: File a bug as a track (a bug form with a regression-test case)
argument-hint: <what is broken, and how to reproduce it>
---
File a bug track for: `$ARGUMENTS`. The procedure is the skill file `ops/tracks.md` (`reportaBug`).

1. Look through `conductor/tracks/` for a track that already covers the symptom; if one does, show it and ask whether to add a comment to it instead. Otherwise create the track by hand as `newTrack` describes, with `**Track Kind**: bug`, a short title and the problem in my words (the symptom, the steps to reproduce and the expected result), using the bug form in `ops/tracks.md` and `setup/templates.md` (Symptom, Steps to reproduce, Expected result, Actual result, Suspected area, Environment) and a regression-test case first in `test.md`.
2. Report the number and folder. Do not start fixing it unless I ask.
