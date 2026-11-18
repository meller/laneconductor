# Spec: Plugin reads its own files without a confusing permission prompt

## Problem Statement

When a user runs `/laneconductor:setup` (or any command that reads a file from the plugin's own install folder, `~/.claude/plugins/cache/...`), Claude Code asks "Allow this read outside the working directories?" with four options. Two of them change a permanent, global setting ("keep allowing any reads outside the working directories" / "block reads outside the working directories from now on"). A new user cannot tell what the question means, and one wrong answer (block) would break every LaneConductor command in every project. Seen on 2026-11-18 in the Fiti PLUG first run of setup; the user called the questions "very unclear".

Goal: a plugin command should be able to read its own files without any prompt, or with at most a clear one.

Options to evaluate, in this order:
1. Declare read-only tools in the skills' and commands' frontmatter (`allowed-tools: Read, Grep, Glob`) and check whether that covers the plugin's own folder; the directory portal must still validate it.
2. Inline the small amount of text a command needs into the command/skill body, so fewer reads leave the project (setup.md, ops/new-project.md, lane guides first).
3. Have the connector (laneconductor-parallel) serve the guides, which it already does through get_context; the base plugin must stay Markdown-only.
4. README and setup message: one line saying which option to choose if the prompt still appears (allow once, not the permanent ones). Never ask users to change their permission settings for us.

Also fix the wording of the setup interview in the same pass if it is still unclear: one message with everything pre-filled and detected (name, stack, test command, lint, tracks folder with a "private" option for public repos), "reply ok or tell me what differs", nothing written until ok.

## Symptom

(To be filled in.)

## Steps to reproduce

(To be filled in.)

## Expected result

(To be filled in.)

## Actual result

(To be filled in.)

## Suspected area

(To be filled in.)

## Environment

(To be filled in.)
