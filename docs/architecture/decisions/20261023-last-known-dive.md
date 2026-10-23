# 20261023-last-known-dive — A diver's last known dive is a day staff record, shown as the latest of that and the shop's own

- **Status:** Accepted
- **Date:** 2026-10-23
- **Amends:** [20260821-currency-is-what-catches-people](20260821-currency-is-what-catches-people.md)

## Context

Aaron (2026-10-23): shops care a lot about the date of a diver's last known dive, want to update it
on the diver's page, and when a diver dives with the shop that date is the most recent known dive.
The 2026-08-21 ADR kept currency off the person, as a band on each booking, because a band given in
March goes stale by November and a date invites a diver to invent precision.

## Decision

- **`people.last_dive_on`**, a calendar day a staff member writes on the record: a dive anywhere,
  read off a logbook or a computer at the counter. A day stays true, so it does not go stale the way
  a band does. Staff-only; no diver-facing writer.
- **The record shows the latest of three** (`lastKnownDive`, `src/db/last-dive.ts`): the recorded
  day, the diver's own last dive day with the shop (`numberedDiveDay`, on a departure that is back,
  pool sessions excluded, on the day it came back), and the latest imported visit that happened
  (`priorVisitStanding`). A trip with the shop moves it forward with nobody typing; nothing moves it
  back.
- **A recorded day earlier than the shop's evidence is still stored**, and the save says the later
  day still shows, so withdrawn evidence (a late no-show) falls back to the true fact, not nothing.
- **The `/ready` band stays on the booking**, untouched. The record shows it beside the date only
  when it was given for a trip after the known day, as unverified.
- **Gates nothing.** Warning ink at five years and more, the gap the band already marks.
- Erasure takes it; a merge keeps the later day; the shop export carries it.

## Alternatives considered

- **A person-level band.** Rejected for the original reason: it goes stale.
- **Only the derived day with the shop.** Misses every dive elsewhere, which is most of a visiting
  diver's diving.
- **Refusing a day older than the shop's evidence.** Lost the fact if that evidence was withdrawn.

## Consequences

- The roster's "Last dived" sort and "Not back in 12 months" stay about the shop alone: they ask
  who came back, not who dived.
- A save or clear writes no activity line yet, and the date is not on the roster or prep list;
  both are follow-ups.
