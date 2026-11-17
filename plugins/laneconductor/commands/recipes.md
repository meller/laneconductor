---
description: List the recipes available (the shipped library and your own), optionally matching a stack
argument-hint: "[stack words]"
---
Recipes: `$ARGUMENTS` (nothing given means list them all). Read only; change nothing. The procedure is the skill file `ops/recipes.md` ("Find and rank").

1. Read both libraries in the documented order: the shipped one inside the skill, then my own (`recipes.path` in `.laneconductor.json` or the `LC_RECIPES` environment variable). Use the `lc-recipe-match` script when it exists.
2. Show at most five matches (all of them when I gave no words), each with its name, one line on why, its `verified` date and any freshness warning. If neither library exists, say so; that is a normal answer.
3. Recommend, never order: apply nothing. Applying a recipe is `ops/apply-recipe.md`, and only when I choose one.
