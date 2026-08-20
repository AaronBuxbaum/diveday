# FU-20260820-per-booking-rental-ticket-print-view — Build the printable per-booking rental ticket the gear ADR named

- **Status:** Open
- **Raised:** 2026-08-20 — the gear-register build; the ADR's "Print rental tickets" piece was deliberately not built (see its 2026-08-20 amendment)
- **Kind:** half-done
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/prep/page.tsx`, `src/db/gear.ts` (`listTripGearAssignments`), a new print route or view

## What I noticed

ADR 20260815-minimal-gear-register scoped "a printable per-booking view listing assigned units
and sizes, same print pattern already used for the offline-manifest print view." What shipped is
the prep page's assignment panel, which prints *per departure* with the packing list — good for
the morning load, but not a slip you can hand one diver at the counter with their three units on
it. The DiveShop360-shop inquiry that motivated the register asked for rental tickets by name.

## Why it isn't already done

Deliberate scope cut to keep the first slice reviewable; the departure-level print covers the
crew's need, and a per-diver slip raises a small design question worth answering awake: it must
not look like a waiver or receipt (one shop-wide waiver is an invariant — CR-015; billing stays
on orders), so its framing ("what you're borrowing, bring it back by …") wants a moment of copy
care in both locales.

## Proposed change

A print-styled view reachable from a booking's row on the Guests tab and from the assignment
panel — likely `/shop/[shopSlug]/trips/[id]/prep?ticket=<bookingId>` rendering just that
booking's open assignments (unit tags, sizes, due-back date, shop name), `print:` styled like the
trip packet. Not proposing: a second waiver template, any signature capture, or any money on the
slip.

## Prompt

```text
Read docs/architecture/decisions/20260815-minimal-gear-register.md (the "Print rental tickets"
piece and the 2026-08-20 amendment), src/app/shop/[shopSlug]/trips/[id]/prep/page.tsx, and the
trip print packet at src/app/shop/[shopSlug]/trips/[id]/print/page.tsx for the print pattern.
Build a printable per-booking rental ticket listing that booking's open gear assignments (tag,
kind, size, due-back date) with doors from the Guests tab row and the prep assignment panel.
Constraints: it must not resemble a waiver (one shop-wide waiver — CR-015) and carries no money;
copy lands in src/i18n/locales/{en-US,es-ES}/staff/gear.json in the same change. Add a visual
capture and a route-coverage entry if it is a new route. Done means pnpm check green and
pnpm e2e e2e/gear.spec.ts passing. Delete
docs/product/follow-ups/FU-20260820-per-booking-rental-ticket-print-view.md as part of the change.
```
