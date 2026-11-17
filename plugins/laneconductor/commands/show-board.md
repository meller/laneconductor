---
description: Open the existing board and give its link (never regenerates it)
---
Show the existing board. Read only: never regenerate or republish it.

1. Find the stored board URL (`board.artifact_url` in `.laneconductor.json`; step 2 of the skill file `ops/board.md`).
2. Open the stored board and give me the link, when the snapshot was generated (its read time) and the privacy note: the board is private, it is a snapshot, and sharing it shares the documents of the tracks that are not done.
3. If no board URL is stored, say so and suggest `refresh-board`; do not create one.

Open it with the Artifact tool, action `open`, with the stored URL, and give me the link. Never call `publish` or regenerate anything here.
