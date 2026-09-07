# 20260907-persona-bots-file-under-a-ceiling — A weekly persona walk may file three issues, and stops entirely at a full inbox

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

`docs/product/personas.md` is a standing frame: fifteen personas, each with a "hold the line on"
list, meant to be re-read before shipping anything that touches their surfaces. Nothing re-reads it
on a schedule. Its own archived predecessor
([the 2026-07-30 review](../../product/archive/ux-personas-20260730-findings.md)) was a human pass
that has not been repeated, and the surfaces it walked have moved a great deal since.

N-61 in [improvement-ideas-20260907.md](../../product/assessments/improvement-ideas-20260907.md)
asks for a weekly agent run that walks each persona's flows against the demo and files
`needs-triage` issues with screenshots. It is marked **Build now**, with one thing flagged as an
owner's call: *issue volume against a one-person inbox*.

That flag is the whole design problem. Fifteen personas over forty-odd surfaces, with an axe scan on
each, can produce a great deal every week. The inbox on the other end is one person, and
`pnpm gates` already ages it because it already rots. A bot that files freely does not add coverage;
it converts a triage queue into a wall, and the first thing that happens to a wall is that nobody
looks at it — including at the entries a human wrote. The failure is not hypothetical enough to
leave to a later tuning pass, because by the time the volume is visible the damage (an inbox
somebody has stopped reading) is already done.

There is a second failure with a shorter fuse. `pnpm check:follow-ups` reads the **live** tracker
inside every pull request's `pnpm check`. A single malformed `needs-triage` issue reddens every open
PR in the repository until somebody fixes it by hand — which happened for real (issue #1097), from
one hand-written issue. A bot filing unattended every Monday is a machine for producing that.

## Decision

Build it, with the volume policy in code rather than in intention, and with the generator
validating its own output against the guard that would otherwise catch it in front of everyone else.

**The walk.** `scripts/persona-bots/walk.spec.ts` opens every surface `personas.md` names, as the
persona who lives on it — anonymously for the diver-facing ones, signed in as the role the persona
holds for the staff ones, and in Spanish for Ingrid, whose findings are invisible in English. It
runs the e2e fleet's own machinery under a config of its own, exactly as
`scripts/simulate-day/` does and for the same reasons. It is weekly and it is not part of any gate.

**Probes are deterministic or they are not probes.** Each one answers yes or no from the rendered
DOM, the response status, or axe's own rule set: the WCAG 2.0 A/AA + 2.2 AA scan
`e2e/a11y.spec.ts` already runs, a skip link, a message key that reached the screen instead of a
sentence, a page that did not render, a browser console error the app itself raised, and a public
page that does not name its shop. The persona doc's softer lines — is the refusal's reason *true*,
is the jargon explained — stay a human's reading. A bot guessing at those would file opinions, and
an opinion is exactly what a full inbox cannot afford.

**A sixth probe was written and withdrawn**, and it is the clearest illustration of where the line
sits. Leo's entry asks that content images reserve their space; an `<img>` with neither
`width`/`height` nor `loading="lazy"` looks like the test for that, and is not. The dry runs found
two shapes that reserve their space perfectly and fail it — `next/image` with `fill`, absolutely
positioned inside a box that already has a size, and a plain `<img>` sized by a Tailwind class —
because whether the layout shifts depends on the *specified* style, which a computed style read
after load cannot recover. It was reporting correct code, weekly. `pnpm check:image-sizes` holds
the neighbouring rule over the source, where the answer is readable.

**The ceiling.** In `scripts/persona-bots/findings.mjs`, and unit-tested:

1. A finding *class* is one issue however many surfaces it fires on. A contrast rule failing on
   eleven pages is one issue naming eleven pages. This is the largest lever by a long way.
2. A class that already has an open issue gets a **comment**, never a second issue — so an aging
   entry carries evidence it is still live rather than only a date.
3. A class whose issue is **closed is never filed again**, ever. Suppressions are printed in the run
   summary, so this is visible rather than silent.
4. **Three new issues per run.** Twelve a month, worst case, and in practice far fewer once (2) and
   (3) start applying. What does not fit is reported and dropped rather than queued: a queue only
   moves the flood a week, and if the finding still matters next Monday the walk finds it again.
5. **Forty open `needs-triage` issues stops the bot filing at all.** Past that the human is already
   behind and the ages `pnpm gates` prints are the thing to read, not another finding. The bot
   yields to the inbox; the inbox never yields to the bot.
6. A run that did not complete files nothing.

**Every body is validated before anything is filed.** `scripts/persona-bots.mjs` imports
`findIssueProblems` from `scripts/check-follow-ups.mjs` — the same function `pnpm check:repo` runs
over the live tracker — and refuses to file a class whose rendered body does not pass, printing why.
`scripts/persona-bots/findings.test.mjs` puts every probe the registry can report through the same
function, and asserts every path the `**Touches:**` line names exists on disk, so the failure is
caught in `pnpm test` rather than in production.

**It fails open, every way it can fail.** No browser, no build, a walk that did not finish, a `gh`
that cannot list the tracker, a body the guard refuses — each prints `DID NOT RUN` or `DID NOT FILE`
with the reason and exits 0. Nothing here is a gate, and a scheduled job that goes red for an
unreachable API trains everyone to ignore the one that goes red for a real finding.

## Alternatives considered

- **File freely and tune later.** Rejected in the Context: by the time the volume is visible the
  inbox has already been abandoned, and abandoning it costs the human-written entries too.
- **Reopen a closed issue when the finding returns**, rather than suppressing it permanently. This
  is the more obvious reading of "prefer amending an existing issue over filing a near-duplicate",
  and it is rejected on purpose: a close is a human's judgement, and re-opening it every Monday is
  an argument the bot always wins by attrition. Suppression is strictly more conservative, it is
  reported rather than silent, and reopening is one click for a human who disagrees. The cost is
  real and named: a defect that is genuinely fixed and later regresses is never re-filed. If that
  bites, the fix is to reopen only issues closed as *completed* — not to reopen everything.
- **A queue, so a finding over the ceiling files next week.** Rejected: it defers the flood instead
  of refusing it, and a finding that has stopped reproducing should stop being filed.
- **Let the run fail red when it cannot file.** Rejected: see above.
- **One issue per surface rather than per class.** Rejected: it multiplies volume by the number of
  pages for no extra information — the class *is* the work, and the surfaces are its evidence.
- **A model reading the screenshots and judging them against each persona's prose.** The most
  faithful reading of "persona bots", and out of scope here: it needs a budget, a provider decision
  and an ADR of its own, and it produces exactly the unfalsifiable findings the ceiling exists to
  keep out of the inbox. The deterministic walk is the half that can ship without an owner
  decision, and it is the half whose findings are reproducible by opening a URL.

## Consequences

The persona frame gets re-read every week by something that does not get bored, and its findings
arrive with the surface URL, the persona whose line they break, and a screenshot. The tracker gains
at most three bot-written issues a week and often none.

Costs: the walk is another Playwright run to keep working (it uses the fleet's helpers, so it breaks
the way the fleet breaks), and the artifact holding the screenshots expires after 30 days while the
issue does not — mitigated by every filed prompt telling the session to re-capture with
`node scripts/screenshot.mjs <path>`, which is reproducible for as long as the surface exists.

Revisit the numbers — three, five, forty — once there is a month of real runs to look at; they are
constants in one file with tests around them, and moving them is a one-line change plus the reason.
Revisit the suppression rule if a real regression is found to have been silently swallowed by it.
