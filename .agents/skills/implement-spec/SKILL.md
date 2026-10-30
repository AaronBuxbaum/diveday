---
name: implement-spec
description: "Implement the result of the to-spec and to-tickets skills in code."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The issue tracker should have been provided to you. If not, use `AGENTS.md` and the provider contract it links to for the repository's tracker instructions.

The goal is the entire spec implemented on a single **integration branch**, with every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

Work in the integration session by default. Delegate independent tickets when parallel work is useful, the repository's delegation rules allow it, or the user requests it. Keep no more than three subagents in flight, and give each a fresh context.

## Steps

1. Read the spec and tickets to understand the task graph.

2. Explore the work shared by the tickets yourself. If you delegate implementation, save shared exploration notes outside the repo where every implementer can read them; exploration needed for one ticket belongs to that ticket's implementer.

3. Create the integration branch using the repository's worktree and stack rules. If work closes through PRs or the user requests one, open a draft PR with the first commit and mark it as closing the spec and tickets.

4. Implement ready tickets in the integration session unless you delegate under the rule above. For each delegated ticket, use an **implementer subagent** in its own worktree and branch. Each implementer:
   - confirms its worktree is based on the integration branch before starting, and resets onto it if not;
   - invokes the `tdd` skill to build the ticket;
   - merges the integration branch tip into its own branch before reporting done

5. Once an **implementer subagent** completes, merge its branch into the integration branch yourself. The implementer already merged the integration tip, so this is mechanical; if it conflicts, send the branch back to that implementer, who knows the code, rather than to a new merger.

6. If this changes the **frontier** of available tickets, apply the same delegation rule and worker limit to the newly ready tickets.

7. Once all tickets are complete, review the integration branch with the `verify` and `code-review` skills, then run the reviewer roles AGENTS.md requires for the surfaces touched through the active provider's supported review mechanism. Fix review findings in one assigned worker when delegation is warranted.

8. If a draft PR exists, mark it ready for review. Otherwise, resolve each ticket the way the issue tracker closes work, and report the integration branch.

9. Clean up all **implementer subagent** worktrees.
