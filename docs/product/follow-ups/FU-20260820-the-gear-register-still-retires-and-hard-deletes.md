# FU-20260820-the-gear-register-still-retires-and-hard-deletes — Bring gear units under every-delete-is-soft, and teach the checker the word "Retire"

- **Status:** Open
- **Raised:** 2026-08-20 — trimming `gear.empty.body` after the product owner asked why the copy skill had not caught it
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/db/schema.ts`, `src/db/gear.ts`, `src/app/shop/[shopSlug]/gear/`, `src/i18n/locales/en-US/staff/gear.json`, `src/i18n/locales/es-ES/staff/gear.json`, `scripts/check-soft-delete.mjs`, `docs/architecture/decisions/20260820-every-delete-is-soft.md`

## What I noticed

The gear register ships exactly the two-action model that ADR
[20260820-every-delete-is-soft](../../architecture/decisions/20260820-every-delete-is-soft.md)
abolished, and it shipped it the same day the ADR landed. Two separate problems, one surface:

**1. "Retire" is on a button.** `gear.unit.status.retire` is "Retire", `retiring` is "Retiring…",
and `gearItemStatus` (`src/db/schema.ts:4070`) carries `"retired"` as an enum value. The ADR's
sentence is not ambiguous: *"Not Archive, Unarchive, Deactivate, **Retire**, Hide, or 'soft delete'
in anything a person reads — button, confirm, toast, notice, filter, empty state."*

**2. `gear_items` has no `deleted_at`, so deleting a unit is a hard delete.** No soft-delete
column, no partial index over live rows, no `deleted_at is null` in the reads. The warning the UI
showed until this change — "Deleting removes its service and rental history too" — was telling the
truth, which is the problem: under the ADR every delete a user points at is soft, and the service
and rental history is exactly the kind of thing the ADR exists to keep.

**Why no check fired.** `scripts/check-soft-delete.mjs` matches
`/archiv|unarchiv|deactivat|soft[-_]?delete/i` against the message bundles. "Retire" is not in that
regex, in either language — Spanish `retirar` even less so. So the written rule is stricter than
the script that is supposed to enforce it, and the one surface that broke the rule is the one the
script cannot see.

This change removed the *steer* from the delete warning ("A unit that earned its keep gets retired
instead") because it pointed a reader at banned vocabulary. It deliberately did **not** rename the
Retire button, because renaming a control without changing what it does would make the label lie.

## Why it isn't already done

It is a schema change plus a domain-model decision, arriving in the middle of a copy trim. Two
questions want an answer before code:

- **Is `retired` a lifecycle state or a soft delete wearing a bad name?** They are not the same
  thing. A retired BCD is one the shop still owns and still has history for but will not rent — a
  real operational state, like `needs_service`. If that is what it is, the fix is to *rename* it
  for the reader (the ADR bans the word, not the concept — "Out of service" or similar) and add a
  genuine `deleted_at` beside it. If instead `retired` was only ever how somebody said "delete but
  keep the row", then it collapses into `deleted_at` and the enum loses a value.
- **What does deleting a unit do to its reservations?** `gear_reservations` joins a unit to a
  booking, guarded by the `gear_reservations_no_overlap` exclusion constraint. `deleteTrip` refuses
  a departure carrying bookings rather than cascading; the gear equivalent needs the same call made
  deliberately.

My recommendation: `retired` is a real state and should keep existing under a permitted name, and
`gear_items` should gain `deleted_at` like every other user-deletable table.

## Proposed change

1. Add `deleted_at` + `deleted_by_person_id` to `gear_items`, a partial index over the live rows,
   and `deleted_at is null` to every read in `src/db/gear.ts`. `deleteGearItem` stamps instead of
   deleting; history survives, and the delete warning goes away entirely rather than being reworded.
2. Rename the `retired` **words** (not necessarily the enum) to something the ADR permits, in both
   locales. Keep the state.
3. Widen `scripts/check-soft-delete.mjs`'s `KEY_PATTERN` and both locale value patterns to cover
   retire/retiring/retired and Spanish `retirar`/`retirad`, so the script matches the rule the ADR
   actually wrote. Expect it to find other hits; fix or exempt each with a reason.

Do **not** delete the `retired` state to "simplify". A shop with a BCD it will never rent again but
must keep the service history for is the case the state exists for.

## Prompt

```text
Read docs/architecture/decisions/20260820-every-delete-is-soft.md and
docs/architecture/decisions/20260815-minimal-gear-register.md first, then src/db/gear.ts and
src/db/schema.ts's gearItems / gearItemStatus / gearReservations.

Two defects, one surface. (a) gear_items has no deleted_at, so deleteGearItem is a hard delete and
destroys the unit's gear_service_events and gear_reservations history — against the every-delete-is-
soft ADR. (b) "Retire"/"Retiring…" is user-facing vocabulary that same ADR bans outright, and
scripts/check-soft-delete.mjs never caught it because its regex is only
archiv|unarchiv|deactivat|soft-delete.

Add deleted_at + deleted_by_person_id to gear_items with a partial index over live rows, thread
`deleted_at is null` through every read in src/db/gear.ts, and make deleteGearItem stamp rather than
delete. Decide explicitly what happens to a unit that has future gear_reservations — deleteTrip
(src/db/trips-schedule.ts) refuses rather than cascades, and the same call should be made here on
purpose, with a test either way. Generate the migration with `pnpm db:generate`; it is additive, so
the destructive-migration guard should stay quiet.

Then keep the `retired` STATE but rename what a person reads: the ADR bans the word, not the
concept — a BCD the shop still owns but will not rent is a real operational state, not a delete.
Both locales change in the same commit or pnpm check:locale fails; read
src/i18n/locales/es-ES/README.md for register.

Finally widen scripts/check-soft-delete.mjs to match the rule the ADR actually states: add
retire/retiring/retired to KEY_PATTERN and to the en-US value pattern, and retirar/retirad to the
es-ES one. It will find hits beyond gear — fix each or exempt it with a written reason.

Done when: pnpm check is green, pnpm check:repo's soft-delete line passes with the widened patterns,
a test proves a deleted unit keeps its service history and disappears from the register, and you
have looked at /shop/blue-mantis/gear in light and dark (node scripts/screenshot.mjs, see the verify
skill). Delete docs/product/follow-ups/FU-20260820-the-gear-register-still-retires-and-hard-deletes.md
as part of the change.
```
