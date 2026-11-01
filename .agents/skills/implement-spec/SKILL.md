---
name: implement-spec
description: "Implement a spec's whole ticket graph on one integration branch, fanning out subagents only for independent tickets. One spec or ticket: implement."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The issue tracker should have been provided to you. If not, read `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md` (AGENTS.md's route map links both; the "Agent skills" section of `CLAUDE.md` points only at the canonical skill index and the provider contract).

The goal is the entire spec implemented on a single **integration branch**, with every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** are an exception, not the default (working-rules "Delegating"): build the tickets in this context, one after another, and delegate only independent frontier tickets that can run in parallel, at most three at once, or when the user asked for subagents (then do as asked).

## Steps

1. Read the spec and tickets to understand the task graph.

2. Explore only what the tickets share, yourself, and save it as markdown notes in a directory outside the repo that every implementer can read. Exploration a single ticket needs belongs to that ticket's implementer, who keeps what it learns in its own context; a separate exploration subagent would only relay those facts second-hand.

3. Create the integration branch. If the issue tracker closes work through PRs, or the user asks for one, open a draft PR after the first merge in step 5 (a branch with no commits ahead of main can't open one), marked as closing the spec and tickets.

4. Implement each ticket on its own branch off the integration branch: yourself, in order, or with one **implementer subagent** per independent ticket under the rule above, each in its own worktree made from the shell (never `EnterWorktree`). Whoever builds a ticket:
   - confirms its worktree is based on the integration branch before starting, and resets onto it if not;
   - loads the `tdd` skill (the host's skill mechanism; in Claude Code, the Skill tool) to build the ticket, running one focused test file per cycle and never the full suite;
   - merges the integration branch tip into its own branch before reporting done

5. Once a delegated **implementer subagent** completes, merge its branch into the integration branch yourself. The implementer already merged the integration tip, so this is mechanical; if it conflicts, send the branch back to that implementer, who knows the code, rather than to a new merger.

6. If this changes the **frontier** of available tickets, pick up the next one, or start more **implementer subagents** for independent ones within the cap of three.

7. Once all tickets are complete, review the integration branch with the `verify` skill and the reviewer agents AGENTS.md requires for the surfaces touched (defined in `.claude/agents/`; a provider without agents reads each file as the brief for a fresh context). Fix the issues raised by the review yourself, or in a single **implementer subagent** if you delegated.

8. If a draft PR exists, mark it ready for review. Otherwise, resolve each ticket the way the issue tracker closes work, and report the integration branch.

9. Clean up any **implementer subagent** worktrees.
