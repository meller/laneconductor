# deploy `[env]`

Run only when the user asks for it by name. A deploy changes something live, so say which environment and which
command you are about to run and wait for a yes first.

Before step 1, offer the stack's deploy pack if it is missing (usually silent, never blocking):

<!-- generated: skill offers for this lane -->

1. Read `conductor/deploy.json`.
2. Locate the command for the requested `env` (default: `prod`).
3. After the yes, run the command in the terminal and show its output.
4. Log the output to `conductor/logs/deploy-<env>-<timestamp>.log`.
