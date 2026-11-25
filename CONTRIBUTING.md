# Contributing to LaneConductor

Thanks for looking. LaneConductor is a personal project and a pattern I am exploring, so
this page is short on purpose.

## Where to start
- A question, an idea, or "this worked for me": GitHub Discussions.
- A bug, or something that does not match the docs: an issue, with the steps to reproduce.
- A change to the code or the docs: open a discussion or an issue first, then a pull request.

I answer myself, so it may take a little while.

## How the repository is built
- The plugins are generated from `connector/src`: edit the sources there, then run
  `node scripts/build-plugin.mjs`. Do not edit the generated files under `plugins/` by hand.
- Run the tests before you open a pull request: `cd connector && node --test "test/*.test.mjs"`.
- Keep a change small and say what it changes and why. No secrets, keys or personal data
  in any file, including test files.

## License and your contribution
LaneConductor is under the Elastic License 2.0 (see [LICENSE](LICENSE)).
By sending a contribution you confirm that you wrote it, or have the right to submit it,
and you give the owner of this repository the right to use, modify and distribute it
under this license or any other license, including a commercial one.
If you cannot agree to that, please do not send code; an issue or a discussion is always welcome.

## What helps most
Measurements. If you run `/laneconductor:explain` on your own agent runs, I would like
to hear what it showed.
