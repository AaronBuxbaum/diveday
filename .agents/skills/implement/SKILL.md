---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, review the work the way this repo does: the `verify` skill, then the reviewer agents in `.claude/agents/` that AGENTS.md requires for the surfaces touched.

Commit your work to the current branch.
