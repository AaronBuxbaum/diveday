# A build spec, for a fresh worker

When a thread steers parallel layers ([working-rules.md](working-rules.md#parallel-work)), each
ticket or stack layer goes to a fresh worker, a subagent or a new thread, with one file written
from this template. The spec is the worker's whole brief. Write it so a session with none of your
context can finish the work from it alone, and save it beside the run's other notes (the
scratchpad, or the project's build folder), never in `docs/`.

Copy the block below and fill in every heading. A heading you cannot fill is a question to answer
before the worker starts.

```markdown
# <ticket or layer>: <one-line goal>

## Goal
What is true when this is done, in one or two sentences, for the person who uses it.

## Files owned
The paths this worker may change. Anything else is out of bounds; a needed change outside
them is handed back, not made.

## Constraints
The rules, ADRs and glossary lines this work must keep, the branch and base, the stack
position, and anything the worker must not do (push, open a PR, call a tool).

## Reproducibility and accepted decisions
Immutable base/head SHA, exact accepted product terms and decision provenance, route/capture/state
matrix for visual work, and current owner. Save these in `.agent-out/task-state/<branch>.json`.

## Done when
Checkable conditions, each one observable: a test that passes, a page that shows a state,
a guard that goes green. "Looks right" is not one.

## Verification
The exact commands to run, focused (`pnpm test <file> --reporter=dot`,
`pnpm e2e <spec> --reporter=line`, `node scripts/check-<name>.mjs`); then push, and CI is the gate.

## Hand back
Write the full result to <path>, then hand back that path plus at most ten lines: the commit
sha or why there is none, the files changed, each check and its result, review outcomes, and
what was not done. Include pending review/CI run IDs, process ownership and the next executable
command. Update the durable task state with `pnpm task:state <prepared-state.json>`.
```

The worker's result file is what the steering thread reads next; the steering thread does not
re-read the tree to learn what changed.
