# H-20261022-reminder-fly-safe-in: What does the day-before reminder promise about flying?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**The fly-safe wait reached a diver only on the recap and on `/ready`, and the night-before reminder is the message a diver reads while booking the flight home.** The 2026-10-22 ux-delight sheet (item 1, call 2) offered: the rule in hours, or a clock time, which a late boat makes wrong.

## Decision

**Decided 2026-10-22 (Aaron: Recommended, in the project thread): the rule in hours.** "Plan to fly no earlier than 24 hours after your last dive, and longer if you make decompression stops", under the dock time, only on the reminder before the diver's last boat with the shop. The exact clock time stays on `/ready` and the recap.

## What shipped

The night-before email (`src/lib/notifications/diver-state-email.ts`) takes `flySafeHours` from `readReminderFlySafeHours` (`src/db/fly-safe-plan.ts`), the same planned rule `/ready` uses, and silent wherever it is (a snorkeler or rider, past no-decompression limits, a later boat booked).

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
