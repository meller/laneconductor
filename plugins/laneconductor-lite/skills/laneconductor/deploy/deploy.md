# deploy `[env]`

Run only when the user asks for it by name. Prefer `lc deploy [env]`; by hand:

1. Read `conductor/deploy.json`.
2. Locate the command for the requested `env` (default: `prod`).
3. Execute the command in the terminal with `stdio: inherit`.
4. Log the output to `conductor/logs/deploy-<env>-<timestamp>.log`.
