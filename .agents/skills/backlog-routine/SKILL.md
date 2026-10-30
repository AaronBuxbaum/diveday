---
name: backlog-routine
description: Work the ready-for-agent backlog unattended, ticket after ticket, refetching main and re-reading CI between each. Use when asked to run the backlog or keep building unattended.
---

# Work the backlog, ticket after ticket

One at a time, from a freshly fetched `main` each time — and stacked on the ticket before it when
that one has not merged yet.

## This does not stop after one ticket

The loop below is a loop. Finishing a ticket is step 9, and step 9 goes back to step 1 — with a
fresh `git fetch`, a look at what CI made of the pull requests already open, a re-read of the queue,
and the next ticket claimed. **A turn that builds one
ticket and then reports has not run this routine**, and the queue it was pointed at is not
measurably shorter: it grows by roughly one issue per session as agents file what they noticed.

It ends in exactly one of these states, and nothing else:

- the queue holds nothing an agent may take — every remaining issue is `ready-for-human`, blocked on
  a human decision, or claimed by a live session;
- something needs the human and cannot proceed without them (a merge, a credential, a call only
  they can make) — say which, and stop;
- the person running it says stop.

"I have opened N pull requests" is not one of them. Neither is "the next ticket would be #764":
either build it or say why you are not.

## The loop

Each step in full, with its commands and incidents: [loop.md](loop.md).

1. **Fetch.** `git fetch origin main` before every ticket, not once per session.
2. **Read what GitHub says about the pull requests you already opened** (REST: `gh api`, never
   `gh pr`): checks and review threads. A red check on your own branch is fixed now, on the branch
   that owns the defect (`reg` excepted: explain each diff image). Answer every open review thread:
   fixed, declined with a reason, or filed. An open `automation/durations-refresh` pull request gets
   an empty commit and push to start CI. Once green, name it as ready and stop for the human to
   merge.
3. **Pick** from `ready-for-agent` (REST), skipping `in-progress`; a claim `pnpm gates` reports
   **stale** is free to take.
4. **Refuse the ones that are not yours**: a *Blocked by* a human decision gets `ready-for-human`
   and a comment saying why.
5. **Claim**: `in-progress` and the `## Claim` comment naming this ticket's own layer as `Branch:`.
6. **Check the premise before building it**: reproduce it first; when it does not survive, say so
   in the PR and the issue, and build what the evidence supports.
7. **Cut the branch from the previous ticket's, commit once, open the draft PR** ([stack.md](stack.md)),
   then build it.
8. **Verify**: `pnpm check:repo`, `pnpm lint`, `pnpm typecheck`, the specs `pnpm e2e:affected`
   names, then push (CI is the gate); look at every surface you changed; read each visual
   diff against its image (`pnpm visual:report --commit <sha>`).
9. **Finish the PR** (body, position line, diff explanation, `Closes #n` under "## Follow-ups
   filed"), `gh pr ready` it, and **go back to step 1** without summarising or asking.

## Reference

- [loop.md](loop.md) — every step in full: the REST commands, the durations-refresh PR, reading review threads, refusing human-blocked tickets, checking the premise.
- [stack.md](stack.md) — cutting each ticket's branch from the previous one, the PR body's position line, visual reports on a stack, *When a stack is the wrong shape*, and *When a lower layer goes red*.

## What ends a turn

Done, filed, or handed over — never an intention (AGENTS.md's rule about queues that live in a
message).

- **You cannot merge.** `gh pr merge` is blocked by the permission classifier. Name the PRs that are
  ready and stop; do not work around it.
- **Ask GitHub what is open at the moment you write it down, never your own memory of opening it.**
  These merge fast: one session's closing message listed seven pull requests as awaiting review and
  every one of them had already merged — the human went looking for them and found nothing.
  Reading the open pull requests for your own login (step 2's REST list) immediately before writing
  the summary is the whole fix, and step 2's check-runs read tells you whether anything is red.
- **Anything you notice and do not do** becomes a `needs-triage` issue written for a reader with
  none of your context — not a line in the closing message. **At most ten per run**
  ([issue-tracker.md](../../../docs/agents/issue-tracker.md)'s Rules say what to do past ten).
- **A failing or flaky test is part of the work**, even when it is not yours and even when it is
  green on the rerun. Root-cause it; never widen a timeout to make it pass.
