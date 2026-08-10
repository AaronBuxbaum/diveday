# FU-20260810-window-note-plain-words — Reword the operational-window note in staff-plain words

- **Status:** Open
- **Raised:** 2026-08-10 — calm-pass design session (branch claude/app-design-overhaul-r3lemn); noticed while surveying the shop home
- **Kind:** question
- **Effort:** S
- **Touches:** `src/i18n/locales/en-US/staff/shared.json`, `src/components/OperationalWindowNote.tsx`

## What I noticed

The sentence under the shop-home greeting reads "The next 7 days of departures — the same window
Today and Check-in both read." Principle 4 says the product never surfaces its own implementation
or process vocabulary, and "the same window … both read" is the app describing how its pages
consume a shared data model — a staffer standing at the counter doesn't think of Today as
something that "reads a window". The Check-in variant adds "Counter mode narrows it to arrivals
from 6 hours ago through the next 36 hours", which is precise but sounds like a config file.

## Why it isn't already done

The note's *presence* is a deliberate, documented decision (`OperationalWindowNote.tsx`: saying
the shared horizon identically on every readiness surface is what makes the shared model visible,
task 141) — so this is a wording question, not a remove-it question, and rewording means touching
every locale's bundle plus re-judging whether the reworded sentence still does the disclosure job
the component exists for. That's a copy decision worth its own focused change, not a rider on a
visual pass.

## Proposed change

Keep the sentence, its placement, and its identical-on-every-surface rule; swap the words for
what the fact means to the reader, e.g. "Everything here covers the next 7 days of departures —
Check-in works from the same list." and for the lens "Counter mode shows who could walk in now:
arrivals from the last 6 hours through the next 36." If the plainer sentence can't carry the
"cleared here is cleared there" promise, say why in the entry's closing PR and delete this as
considered-and-declined. Not proposing dropping the pivots line or the note itself.

## Prompt

```text
Read docs/design/principles.md (principle 4, "Never surface the implementation"),
src/components/OperationalWindowNote.tsx (its header comment explains why the note exists and
must stay identical across surfaces), and shared.operationalWindow in
src/i18n/locales/en-US/staff/shared.json. Reword `note` and `arrivalsLens` into staff-plain
language that keeps the promise "a diver cleared on one surface is cleared on the others"
without describing pages reading windows. Land the new wording in every locale's
staff/shared.json in the same change (es-ES: read src/i18n/locales/es-ES/README.md first) and
keep the {days}/{lookback}/{ahead} placeholders. Done when pnpm check (includes check:locale) is
green and the sentence on /shop/blue-mantis and /shop/blue-mantis/check-in reads like a
divemaster wrote it. Delete docs/product/follow-ups/FU-20260810-window-note-plain-words.md as
part of the change.
```
