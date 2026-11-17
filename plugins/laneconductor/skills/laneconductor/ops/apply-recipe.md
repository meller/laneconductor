# apply-recipe: apply a recipe the person chose

Run only when the person has chosen the recipe (in `new-project`, from `recipes`, or by naming it), normally from the
"Apply recipe X" track that `new-project` created. Never apply on your own, and never as a side effect of listing.

## Steps

1. **Read the recipe in full**: `recipes/<name>/SKILL.md` and the file list of its `files/` folder. Re-read its
   `Recommendation` and `Pitfalls`; they are the reason it is a recipe and not generic advice. Show the person its
   `verified` date and any freshness warning once more.
2. **Collect the variables.** The `{{var}}` names used in its `*.tmpl` files come from the interview answers (project
   name, ids the person chose). Ask for any that are missing, one at a time. A variable never gets a guessed value.
   Never ask for a credential, a token or a key: the recipe's secrets belong in the person's own steps.
3. **Plan the files.** Run `node <path>/lc-recipe-apply.mjs --recipe <recipe folder> [--recipe <another>] --target . --var k=v ...`
   WITHOUT `--write`. It prints what would be written, what already exists (never overwritten), the **conflicts** and
   the variables still missing. By hand: files under `files/` mirror the project paths; a file ending in `.tmpl` is
   rendered (drop the suffix, fill `{{var}}`), every other file is copied as it is.
4. **Conflicts are the person's decision.** When two recipes write the same path (even with identical content), report
   both recipe names and the path, write neither file, and ask which to keep or how to combine them by hand. Never
   merge silently. A file that already exists in the project is reported and left alone.
5. **Write** with the same command plus `--write` once the plan is clean and the person says yes. Then do what the
   recipe's `Claude does` section adds beyond writing files (edit a config, add a script entry), in the order it gives,
   and nothing it does not say.
6. **Show the person their steps.** Print the `You run` section as a numbered list for the person to run themselves:
   sign-in, secrets, deploys, anything that touches an account or costs money. Claude never runs these, never asks for
   the values they need, and never stores a secret. Put them as `(HUMAN)` tasks in the recipe's track if it has one.
7. **Verify what you can.** If the recipe has `metadata.smoke_check`, show the command and run it only after the person
   has done their steps and agreed. Report the real output.
8. **Record it.** Tick the tasks you did in the track's `plan.md`, add a comment to its `conversation.md` that names the
   recipe, the files written and any deviation from the recipe with the reason, and leave the commit to the person's yes.
   If the recipe turned out wrong or out of date, say so there and offer `add-recipe` to update it.

## Rules

- No recipe is applied without the person choosing it; no step of a recipe is skipped silently. A step you will not do
  is reported with the reason.
- The recipe's `You run` steps are shown, never executed.
- Files are never overwritten; two recipes on one path are a conflict, never a merge.
