# FU-20260821-a-deleted-gear-unit-has-no-record-to-read — Decide whether a deleted unit's record stays readable

- **Status:** Open
- **Raised:** 2026-08-21 — bringing the gear register under every-delete-is-soft (branch `claude/gear-delete-not-retire-7f3a2c`, the PR that removed `retired`)
- **Kind:** question
- **Effort:** S
- **Touches:** `src/db/gear.ts`, `src/app/shop/[shopSlug]/gear/[id]/page.tsx`, `src/app/shop/[shopSlug]/gear/page.tsx`, `src/i18n/locales/en-US/staff/gear.json`, `src/i18n/locales/es-ES/staff/gear.json`

## What I noticed

Deleting a gear unit now keeps the whole row — its `gear_service_events` and every
`gear_reservations` window stay attached — which is the entire reason the delete is soft. But
`getGearItemDetail` filters `deleted_at is null`, so `/shop/<slug>/gear/<id>` **404s** for a
deleted unit. The service history a shop kept is therefore unreadable while the unit is deleted:
the only thing the register's new Deleted view offers is Restore.

The case that goes wrong: a shop deletes "Reg #4", a customer six months later asks when that
regulator was last serviced, and the staffer has to restore the unit onto the live register (where
it re-enters every picker) to read its history, then delete it again.

The diver roster answers this differently — a deleted diver's record page still renders, with a
badge and a Restore button (`divers.removed.*`) — so the two pillars disagree today.

## Why it isn't already done

Scope. The change I was given was the soft delete, the removal of `retired`, and the reservation
refusal; a read-only record page for a deleted unit is a second surface with its own copy, its own
empty/disabled-form decisions (every form on that page writes, and all of them refuse a deleted
row), and its own visual capture. It is also a product call rather than a mechanical one: the
alternative is that "deleted" means gone from the app entirely until restored, and the export
bundle (which carries deleted units and their history) is where a records question gets answered.

## Proposed change

Under "make it readable": drop the live filter from `getGearItemDetail` and instead pass
`item.deletedAt` into the page, which renders a Deleted badge in the header, replaces the Status
card with a single Restore control, and hides the details/service forms rather than rendering
controls that are guaranteed to be refused. Mirror `divers.removed.*` for the words, and add a
visual capture beside `gear-register-deleted`.

Under "leave it as-is": say so in the gear ADR's 2026-08-21 amendment, so the next reader does not
read the 404 as an oversight, and check the export bundle's `gear_items.csv` note is enough of an
answer for the records case.

I am **not** proposing letting a deleted unit stay assignable, searchable, or countable — every
operational read stays `deleted_at is null` whichever way this goes.

## Prompt

```text
Read docs/architecture/decisions/20260820-every-delete-is-soft.md and the 2026-08-21 amendment at
the bottom of docs/architecture/decisions/20260815-minimal-gear-register.md, then
src/db/gear.ts (getGearItemDetail, restoreGearItem, listDeletedGearItems) and
src/app/shop/[shopSlug]/gear/[id]/page.tsx.

A deleted gear unit keeps its whole service and rental history, but its record page 404s, so the
only way to read that history is to restore the unit onto the live register. A deleted diver's
record, by contrast, still renders with a Deleted badge and a Restore button (see
src/app/shop/[shopSlug]/divers/[personId]/ and the divers.removed.* keys).

Decide which of the two DiveDay means, and make the tree say it. If a deleted unit's record should
be readable: stop filtering deleted rows in getGearItemDetail, pass the stamp into the page, and
render a read-only record — Deleted badge in the header, one Restore control, and no write forms
at all (every writer in src/db/gear.ts refuses a deleted row, so a rendered form would be a button
that cannot work). Words go in src/i18n/locales/{en-US,es-ES}/staff/gear.json in the same change
(pnpm check:locale fails otherwise); read src/i18n/locales/es-ES/README.md for register. Do not
say "archived" or "retired" anywhere a person reads — pnpm check:repo's soft-delete line refuses
both. If instead the 404 is the right answer, write that into the gear ADR's amendment with the
reason and change no code.

Done when: pnpm check is green, and either a test proves the deleted unit's record renders its
service history with no write forms plus a visual capture beside gear-register-deleted (add it to
scripts/route-coverage.json), or the ADR states the decision. Delete
docs/product/follow-ups/FU-20260821-a-deleted-gear-unit-has-no-record-to-read.md as part of the
change.
```
