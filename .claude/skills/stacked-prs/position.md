# Stacked PRs: where am I in the stack

Part of the **stacked-prs** skill ([SKILL.md](SKILL.md)). Read it when you need your layer, the top, or a fork, and before writing a layer's PR body.

## Where am I in the stack

**Read it from git, never from a record of it.** `node scripts/stack-map.mjs` prints the stack HEAD
is in: the layers bottom to top, the top, any other tip above HEAD (a fork two sessions made), the
sub-branches merged into a layer (`-l2-core` into `-2`), and each layer's own paths; `--json` is the
same record for a machine. Every prompt's context line carries the position (`stack: layer 2 of 4,
top origin/claude/<slug>-4`), and the session-start block names the top.

It derives all of that from the remote refs: a layer below is a remote branch HEAD contains and
`origin/main` does not, a layer above is one that contains HEAD, a layer sits on HEAD's first-parent
chain and a sub-branch is merged in through a second parent. So it is exactly as fresh as the last
fetch, and the session-start hook fetches `main` and `claude/*` (with `--prune`, so a merged layer
drops out) for that reason. Two designs were weighed and refused. A committed stack manifest file
that each PR updates is one more shared file every layer edits, stale the moment a layer merges and
a conflict on every rebase — the problem it would exist to remove. A `STACK` block in each PR body
read live would put a GitHub call on every prompt, and a hook cannot count on one: `gh`'s GraphQL
is refused in cloud sessions and `gh` is not signed in everywhere a session runs.

What git cannot say is intent: which branch you *mean* to cut next, and the paths you mean to own.
Those stay where they were — the draft PR body's position line below and the issue's claim.

Every body states its position and what is beneath it, because a reviewer who lands on layer 3 from
a notification has no other way to find the bottom:

```
Layer 2 of 3 — based on `claude/<slug>-1-schema` (#641). Above: `claude/<slug>-3-surface` (#643).
Review and merge bottom-up.
```
