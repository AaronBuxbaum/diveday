# FU-YYYYMMDD-short-slug — One line, imperative: what should happen

<!-- Status is Open in this folder. An entry blocked on somebody OUTSIDE this repo — an upstream
     release, a third party's answer, numbers that need traffic — belongs in waiting/ instead, as
     `Status: Waiting` with a `**Waiting on:**` line. Read waiting/README.md before moving one. -->

- **Status:** Open
- **Raised:** YYYY-MM-DD — what change surfaced it (PR number, branch, or task)
- **Kind:** question | improvement | risk | cleanup | half-done
- **Effort:** S | M | L
- **Touches:** `src/lib/example.ts`, `docs/product/example.md`

## What I noticed

The observation, concretely, with file paths and the behaviour a person would see. Written for a
reader who was not in the session and has no memory of the change that raised this. Name the case
that goes wrong, not the abstraction.

## Why it isn't already done

The honest reason: outside the scope I was given / needs a policy call I can't make / needs a
schema change that deserves its own review / I disagreed with the obvious approach and want a
second opinion. If it is a question, this is where the options and their trade-offs go, with a
recommendation.

## Proposed change

What to actually do, at the level of "which file, what shape". State what you are *not* proposing
if there is an obvious wrong turn nearby. If it is a question, state what you would do under each
answer.

## Prompt

```text
A self-contained instruction that can be pasted into a fresh session with zero context. It names
the files to read first, states the constraint that makes this non-obvious, defines done, and
names the checks to run (pnpm check, a focused test, e2e when a flow changed). Delete
docs/product/follow-ups/FU-YYYYMMDD-short-slug.md as part of the change.
```
