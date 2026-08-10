# FU-20260810-repeating-trip-cadence-editing — Let staff change a repeating trip's cadence without rebuilding it

- **Status:** Open
- **Raised:** 2026-08-10 — branch `claude/recurring-trips-unlimited-4t1h5i`, the open-ended recurring trips change (ADR 20260810-open-ended-recurring-trips)
- **Kind:** improvement
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/_components/SeriesSection.tsx`, `src/app/shop/[shopSlug]/trips/[id]/actions.ts`, `src/db/trips-series.ts`, `src/i18n/locales/en-US/staff/trips.json`, `src/i18n/locales/es-ES/staff/trips.json`

## What I noticed

A repeating trip's cadence is now decided once, in the board's add panel, and after that the only
things staff can change about the *run* are whether it repeats at all and whether its upcoming dates
are cancelled. The "Repeating trip" panel on `/shop/[shopSlug]/trips/[id]` shows the cadence as a
sentence ("Repeats weekly on Mon and Thu · keeps going") with no way to edit it.

The case that goes wrong: a shop adds Wednesday to its Monday-and-Thursday run for the summer. Today
they have to build a second repeating trip with a second name, or delete the first and rebuild it —
and deleting it is refused on any date that already has a diver on it, so in practice they end up
with two runs that mean one thing. The same applies to moving a standing charter from 08:00 to
07:30 for the season, or to giving an open-ended run an end date after the fact (the reverse — an
end date, then removing it — *is* possible today, via "Stop repeating" / "Start repeating again",
which is what makes the gap feel arbitrary).

## Why it isn't already done

Outside the scope I was given, which was "no limit" plus "specific weekdays". It is also not the
mechanical change it looks like: editing a cadence has to decide what happens to the dates *already*
on the board, and that is a product call rather than an engineering one.

Adding a weekday is easy and safe — the horizon roll simply proposes the new dates on its next pass
and `rollSeriesForward` is already idempotent. **Removing** one is not: the Thursdays already
materialized are real trips, some with divers, waivers, and deposits on them. Silently cancelling
them would be a bulk cancellation staff did not ask for; silently leaving them means the board
disagrees with the sentence describing it. Changing the departure *time* has the same shape, and is
worse — it moves an instant divers were told to show up at.

## Proposed change

Add an "Edit the repeat" disclosure to `SeriesSection`, reusing the `RepeatFields` component from
the board's add panel (extract it to a shared location, or accept the current per-day-chip markup
being duplicated — prefer extraction). Behind one server action, `updateSeriesCadenceAction`, which
calls a new `updateSeriesCadence` in `src/db/trips-series.ts`.

The rule I would apply, and the one worth a human's opinion before building it:

- **Weekdays added, or the end date pushed out:** just save the cadence and roll forward. New dates
  appear; nothing existing changes.
- **Weekdays removed, or the end date pulled in:** save the cadence, and show staff the list of
  already-materialized dates that no longer fit, with a count of how many carry bookings — as a
  *second, explicit* step ("These 6 upcoming Thursdays are still on the board. Cancel them too?"),
  never as a silent side effect of saving. Cancelling goes through the existing `setTripStatus`
  path so each stays reinstatable, and a date that already sailed is never touched.
- **Departure time:** leave it out of this change. Changing the time of dates divers have booked is
  a notification problem before it is a scheduling one, and `moveTrip` already handles it one date
  at a time.

Not proposing: a "cadence version history", or letting a cadence edit rewrite past instances. The
ADR's spine is that an instance is independent once materialized, and this must not become the
back door that rewrites siblings.

## Prompt

```text
Add cadence editing to a repeating trip in the DiveDay repo.

Read first, in this order:
- docs/architecture/decisions/20260810-open-ended-recurring-trips.md (the model: a series is a
  cadence plus an optional last date, materialized into a rolling window; instances are
  independent once created)
- src/db/trips-series.ts (`rollSeriesForward`, `materializeWindow`, `setSeriesRepeat`) and its
  test src/db/trips-series.test.ts
- src/app/shop/[shopSlug]/trips/[id]/_components/SeriesSection.tsx
- src/app/shop/[shopSlug]/schedule/board/_components/RepeatFields.tsx

Build: an "Edit the repeat" disclosure in SeriesSection that lets staff change the weekday set, the
week interval, and the end date of an existing repeating trip. Reuse RepeatFields (extract it
somewhere both surfaces can import — check pnpm check:architecture's layer rules before choosing
where). Add `updateSeriesCadence` to src/db/trips-series.ts and one server action beside the
existing series actions.

The constraint that makes this non-obvious: dates already on the board are real trips with real
divers. Widening a cadence (more weekdays, a later end date) may just save and roll forward.
NARROWING it must never cancel anything as a side effect of saving — save the cadence, then offer
the now-orphaned upcoming dates as an explicit second step showing how many carry bookings, going
through setTripStatus so each stays reinstatable. Never touch a date that has already sailed, and
never rewrite a sibling's details.

Leave the departure *time* out of scope — moving an instant divers were told to show up at is a
notification problem, and moveTrip already handles it per date.

Done when: staff can add and remove a weekday on an existing run from the trip page; narrowing
surfaces the orphaned dates rather than silently cancelling them; new unit tests in
src/db/trips-series.test.ts cover widen, narrow-with-bookings, and the idempotency of a roll after
the edit; the e2e walk in e2e/trip-series.spec.ts covers adding a weekday to an existing run; all
copy goes through src/i18n/locales/{en-US,es-ES}/staff/trips.json.

Run: pnpm check, pnpm test src/db/trips-series.test.ts --reporter=dot, and
pnpm e2e e2e/trip-series.spec.ts --reporter=line. Look at the panel in light and dark before
calling it done.

Delete docs/product/follow-ups/FU-20260810-repeating-trip-cadence-editing.md as part of the change.
```
