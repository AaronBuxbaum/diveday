# Waiting — the entries nobody here can move

The [follow-up register](../README.md) one folder up is an inbox: every file in it is waiting on
Aaron's judgment, and reading one costs him a decision. This folder is for the entries where that
is not true — where the next move belongs to somebody outside this repository entirely.

Three shapes qualify, and they are the only three:

- **An upstream release.** The workaround is already shipped and correct; it becomes deletable when
  a dependency fixes the bug it works around.
- **A third party's answer.** A request has been made (or must be made by a person), and nothing
  moves until it is answered.
- **A measurement that needs traffic we do not have yet.** The decision is genuinely blocked on
  numbers, and deciding it on taste in the meantime is the wrong trade.

What does **not** belong here is an entry that is merely hard, large, unscheduled, or waiting on a
call *Aaron* owns. Those are triage, and triage lives upstairs — an entry he has read and
deliberately deferred says `**Status:** Parked` with a `**Parked:**` line, in the inbox, where he
will meet it again.

## Why the split exists

An inbox is only read if reading it is worth the reader's time. Three entries that cannot move for
another six months, sitting between the ones that can, teach a reader that most of the folder is
noise — and the cost of that lesson is not those three entries, it is the ones underneath them.
Moving them out is not filing them away: `pnpm gates` still ages this folder beside the inbox, so a
thing that has been "waiting on upstream" for a year is visible as exactly that.

## The one extra rule

Every entry here carries a `**Waiting on:**` line, and it has to answer two questions:

1. **What event unblocks this?** Named specifically — a release, a reply on a particular thread, a
   funnel pair carrying numbers.
2. **How would a reader check whether it has happened?** A changelog to read, an issue to open, a
   dashboard and the runbook that explains it.

Without (2) the entry is indistinguishable from one nobody got round to, which is the thing this
folder exists to prevent. `pnpm check:follow-ups` refuses a `Waiting` entry without that line, and
refuses one whose line is too short to have answered both halves. Everything else — the four
sections, the `Touches:` paths, the runnable prompt — is exactly the same as upstairs, including
that the prompt must name this file at *this* path.

## Moving an entry in or out

- **In:** `git mv` it here, change `**Status:**` to `Waiting`, add the `**Waiting on:**` line, and
  update the path in its prompt's delete instruction (it now has `waiting/` in it).
- **Out:** the moment somebody in this repo owes the next move — the release landed, the answer
  came back, the numbers exist — `git mv` it back up, restore `**Status:** Open`, drop the
  `**Waiting on:**` line, and fix the prompt path again. An entry that has become actionable and
  stayed down here is worse than one that was never filed.
- **Closed** is the same as upstairs and has the same two ends: do the work and delete the file, or
  decide against it and delete the file. Never mark one done in place.
