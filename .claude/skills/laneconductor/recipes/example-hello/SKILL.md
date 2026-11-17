---
name: example-hello
description: A synthetic example recipe that shows the recipe format and the apply flow; it solves nothing real and is never recommended for a real stack. Use it to see what a recipe looks like.
when_to_use: Use only when the person asks to see an example recipe or to try the apply flow. It matches the stack tag example-hello and no real stack tag.
paths: HELLO.md, hello.config.json
metadata:
  kind: recipe
  stack:
    - example-hello
  prerequisites:
    - Nothing is needed; this recipe only writes two small files.
  reference:
    - repo: example/hello-recipe
      path: hello.config.json
      commit: "0000000"
      proves: a made-up file; this recipe is synthetic and cites no real project
  verified: 2026-11-17
---

## Why this works for you

This recipe is a teaching example, not a solved problem. It exists so the format, the matching and the apply flow can be shown and tested without any private or real project. It was not verified in real use.

## Recommendation

- Write `HELLO.md` from the template (the `{{project_name}}` variable is filled from the interview).
- Write `hello.config.json` as it is.

## Claude does

- Render `files/HELLO.md.tmpl` with `project_name` and write `HELLO.md` and `hello.config.json` into the project.
- Report both paths, and report a conflict if another recipe writes the same path.

## You run

1. Read `HELLO.md` and delete both files when you are done with the example. (No sign-in, secret or deploy is involved.)

## Pitfalls

- Never recommend this recipe for a real stack; it matches only the tag `example-hello`.

## Unproven

- Everything: it is synthetic.
