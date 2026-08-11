# FU-20260811-operational-window-note-length — Decide whether the shared operational-window note should be disclosed rather than printed

- **Status:** Open
- **Raised:** 2026-08-11 — branch `claude/diver-page-ui-refinements-rn50sm`, while trimming the counter check-in page on the note "Check in is still a little inelegant and wordy"
- **Kind:** question
- **Effort:** S
- **Touches:** `src/components/OperationalWindowNote.tsx`, `src/i18n/locales/en-US/staff/shared.json`, `src/app/shop/[shopSlug]/check-in/page.tsx`, `src/app/shop/[shopSlug]/page.tsx`

## What I noticed

Counter check-in's header was trimmed in that branch: the description went from two sentences to
one, the search box lost its bordered card and its hint line, and the queue's three stacked texts
("Ready at the counter" / "Today's departures and the next boat." / "26 divers") became one heading
plus a count. What is now the longest block of prose on the page, by some margin, is the one thing
the page does not own — `OperationalWindowNote`:

> Everything here covers the next 7 days of departures — Today and Check-in work from one shared
> list. Counter mode shows who could walk up right now: arrivals from the last 6 hours through the
> next 36 hours.

At 390px that is four lines of muted text between the page title and the first diver, on all three
readiness surfaces (Today, Today's by-departure view, Check-in). It is reference information: true,
load-bearing for understanding why a diver appears on one list and not another, and read once.

## Why it isn't already done

It is deliberately shared, and the component says why: those three surfaces read the same evidence
through the same horizon, they each used to print their own bespoke window sentence, and "saying it
once, identically, in the same place on all three is what makes the shared model visible rather
than merely true." Shortening or hiding it on Check-in alone would undo exactly that. Doing it on
all three is a change to two surfaces nobody asked about in that round, with its own visual
baselines, so it wants to be its own decision rather than a drive-by inside a check-in cleanup.

## Proposed change

Keep it shared and identical; change only how much of it is *printed at rest*. Give
`OperationalWindowNote` a `<details>` whose summary is a short standing line — the horizon alone
("Next 7 days of departures", plus "· counter mode" where a lens narrows it) — with the full
sentence and the lens clause behind it. The pivots row stays visible: it is navigation, not
explanation. That preserves the one-place-one-wording invariant, keeps the model discoverable, and
gives all three surfaces back three lines above the fold.

Not proposed: deleting the note, or giving Check-in a shorter variant of it. The second is the
exact drift the component was created to end.

## Prompt

```text
Read docs/product/follow-ups/FU-20260811-operational-window-note-length.md, then
src/components/OperationalWindowNote.tsx and its three call sites (grep for
OperationalWindowNote under src/app/shop).

Put the window sentence behind a disclosure as described there: a short summary line at rest, the
full note and lens clause on open, pivots always visible. New copy goes in
src/i18n/locales/*/staff/shared.json under shared.operationalWindow.* — both locales in the same
change or pnpm check:locale fails. The constraint that makes this non-obvious: the note must stay
byte-identical across Today, Today's ?view=departures, and Check-in — that sameness is the feature
(read the component's own doc comment), so nothing surface-specific may creep into the summary
beyond the lens clause the component already models.

Done means all three surfaces show the same short line, open to the same full text, and
`pnpm check` is green. This moves pixels on three baselined surfaces: run
`pnpm e2e e2e/visual.spec.ts --reporter=line` and account for each diff in the PR description.
Delete docs/product/follow-ups/FU-20260811-operational-window-note-length.md as part of the change.
```
