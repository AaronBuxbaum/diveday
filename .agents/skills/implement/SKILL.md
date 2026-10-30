---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Use the `tdd` skill where possible, at pre-agreed seams.

Run typechecking and focused test files regularly. The full suite belongs to CI.

Once done, review with the `verify` and `code-review` skills. Run any reviewer roles AGENTS.md
requires for the surfaces touched through the active provider's supported review mechanism.

Commit your work to the current branch.
