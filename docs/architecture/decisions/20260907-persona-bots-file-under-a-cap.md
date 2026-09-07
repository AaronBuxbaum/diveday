# 20260907-persona-bots-file-under-a-cap — A weekly persona walk files into the tracker, under a hard cap

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

`docs/product/personas.md` is a standing evaluation frame: fifteen people, their surfaces, and a
"hold the line on" checklist each. It has been read by humans and by agents before shipping a
change since 2026-07-31, and it works — but only when somebody remembers to read it, and only about
the change in front of them. Nothing walks the whole set on a schedule, so the app's standing wear
(a control that shrank under a phone, a page that started rendering blank in one language, a link
that started answering 404) is discovered when a person happens to walk into it.

N-61 on the 2026-09-07 decision sheet proposes the machine version: a weekly agent run that walks
each persona's flows against the demo and files `needs-triage` issues with screenshots. The owner's
verdict is **Build now**, with one stated worry, and it is not about the walking:

> *Needs:* owner (issue volume against a one-person inbox).

That worry is correct and it is the hard part. Fifteen personas over forty-five stops with eight
lenses can see a great deal on any given Tuesday. A run with no policy would open forty issues on
its first Monday, twelve of them describing the same tap target; the second Monday it would open
them all again. The tracker is one person's, and `pnpm gates` already ages the `needs-triage` inbox
because that inbox is known to rot. A bot that floods it does not just waste attention — it makes
the whole inbox unreadable, and the first casualty is the follow-ups a human wrote by hand.

The neighbouring precedent is N-60's one-day simulation (`scripts/simulate-day/`, merged the same
week): the e2e fleet's own server, browser and helpers, under a config of its own, in a scheduled
workflow rather than the pull-request gate. That shape is settled and this reuses it. What the
simulation does not have to answer, and this does, is what happens to what it found.

## Decision

**A weekly workflow walks the fifteen personas and reports; a separate step decides what the
tracker hears, under three caps that bound the steady state.**

1. **The walk reports and never gates.** `scripts/persona-bots/walk.spec.ts` records a
   `stop-unreachable` finding where a persona cannot reach a surface and walks on. A non-zero exit
   means the harness broke, never that a persona found something. It is not under `e2e/`, it is not
   in `ci.yml`, and nothing it sees can redden a pull request. A persona walking a flow is an
   opinion about the product; a build gate is a fact about a diff, and conflating them would have
   the second-order effect of making people narrow the lenses to get green.

2. **A finding is a fingerprint, not an event.** `persona | lens | stop | normalised evidence`,
   hashed. Every id, digit and origin is normalised out, so the same defect keeps the same name
   across runs; the fingerprint is written into the issue body and read back from it. A fingerprint
   already open is never filed again.

3. **Three caps, in `scripts/persona-bots/lib.mjs`:** at most **three** new issues per run, at most
   **one per persona**, and — the one that actually bounds the total — **while ten persona issues
   are open, a run files nothing new at all**. The tracker can therefore hold at most ten of these
   at once, however long the run goes on finding things, and clearing them is what buys the next
   run its voice.

4. **A recurrence is re-confirmed at most every 28 days**, as one comment on the existing issue
   carrying a marker so the next run can tell its own word from a human's. Between those, a
   recurring finding is counted in the summary and nothing is written.

5. **Every run writes a summary naming what it held back and why.** A capped run that printed only
   its three issues would read as a clean week. This is the same discipline that made
   `check:follow-ups` report SKIPPED rather than `ok`: a mechanism that did not speak is not a
   mechanism that found nothing.

6. **A run that cannot read the open issues files nothing.** Deduplication is the whole safety
   mechanism; filing blind on a bad network day would put a copy of every standing finding into the
   inbox. It says so and exits clean.

7. **Screenshots live in the run's artifacts, not in the repository.** The issue links the run and
   names the file. Nothing under `personas/` is committed, which is also why the artifact retention
   (90 days) is stated in `docs/engineering/testing.md`: after that the link is dead and the issue
   body's quoted evidence is what remains, which is why the evidence is quoted rather than only
   pictured.

## Alternatives considered

**No filing: write a report and let a human read it.** The cheapest thing that could work, and what
`pnpm gates` does. Rejected because a weekly artifact nobody is paged about is a weekly artifact
nobody reads — the same argument AGENTS.md makes against leaving a thought in a closing message.
The tracker is where triage happens, so that is where a finding has to land. The summary still
exists, and it is where everything the caps held back is written down.

**File everything and let triage sort it.** What the idea's one-line description would produce read
literally. Rejected outright: it is exactly the failure the owner named, and it is not recoverable
— an inbox with forty bot issues in it stops being triaged at all, taking the hand-written
follow-ups with it.

**Cap by run only (say, five a week), with no inbox ceiling.** Simpler, and wrong in the steady
state: five a week is 260 a year against an inbox nobody has time to empty. The ceiling is what
makes the bound a *number* rather than a rate, and it makes the bot's own throughput depend on
triage, which is the correct feedback loop.

**Let an agent read each surface and judge it.** The most faithful reading of "persona bots" — an
agent forming an opinion in the persona's voice rather than a lens reporting a measurement.
Rejected for now on two grounds: a judgement that varies run to run cannot be fingerprinted, so
nothing deduplicates and cap 2 collapses; and an unattended agent filing prose opinions into a
tracker is a much larger trust question than a run that says "this control is 18px". The lens set
is deliberately mechanical and deliberately a subset of each persona's checklist. If the caps prove
comfortable, a judging pass over the *screenshots the walk already took* is the natural next slice.

**Nightly rather than weekly.** The simulation is nightly because a broken day is a regression that
should be caught against the commit that caused it. Standing wear is not that, and seven times the
runs against the same caps means only that more of what it sees is suppressed.

## Consequences

- The tracker gains a `persona-bot` label. Issues carrying it are ordinary `needs-triage`
  follow-ups in every other respect, and `pnpm check:follow-ups` validates what the bot writes with
  the same code it uses on what a session writes — `scripts/persona-bots/lib.test.mjs` runs the
  guard's own `findIssueProblems` over a rendered body for every lens, so a change to either side
  fails in the unit suite rather than on a Monday.
- `docs/product/personas.md` gains a second reader. `scripts/persona-bots/personas.test.mjs` pins
  the roster against the document's own headings, so a persona renamed or renumbered fails the
  suite instead of being quietly walked as somebody else, and every `Touches:` path the bot would
  write is asserted to exist.
- The bot's throughput is bounded by triage. If nobody empties the inbox, the walk still runs, still
  reports, and files nothing — which is the intended behaviour and is stated in the summary every
  week.
- The lens set is a subset of what the personas' checklists ask for, and will read as thin against
  them. That is deliberate; what it cannot see is not thereby fine, and the frame stays the thing a
  human reads before shipping.
- Adding a lens is cheap and adding a persona stop is cheap, so the pressure will be to add both.
  The caps mean that pressure lands on the summary rather than on the inbox, which is the right
  place for it.
