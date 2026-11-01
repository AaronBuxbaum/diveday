---
name: implement
description: "Implement one spec or a few tickets yourself in this session. A whole ticket graph: implement-spec; a roadmap feature: new-feature."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Use the `tdd` skill where possible, at pre-agreed seams.

Run typechecking regularly, and one focused test file per change; CI runs the full suite.

Once done, review the work the way this repo does: the `verify` skill, then the reviewer agents (defined in `.claude/agents/`) that AGENTS.md requires for the surfaces touched.

Commit your work to the current branch.
