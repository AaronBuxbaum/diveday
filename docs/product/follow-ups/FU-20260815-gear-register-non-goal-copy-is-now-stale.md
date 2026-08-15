# FU-20260815-gear-register-non-goal-copy-is-now-stale — Decide whether to soften the "no individual rigs" public copy

- **Status:** Open
- **Raised:** 2026-08-15 — a real DiveShop360-shop inquiry (module list: rentals, inventory, work
  orders) prompted a strategy conversation that concluded the minimal gear register
  (`docs/product/features/roadmap.md` §3) is worth pursuing "in the near future," not just an
  audit finding to revisit someday.
- **Kind:** question
- **Effort:** S
- **Touches:** `src/i18n/locales/en-US/diver.json:2673` (`marketing.product.notCovered.gearSerials`),
  `src/i18n/locales/es-ES/diver.json:2673` (same key), `src/i18n/locales/en-US/staff/settings.json:484`
  (`importer.honesty.receiptsService`), `src/i18n/locales/es-ES/staff/settings.json:484` (same key)

## What I noticed

Two public/staff-facing copy surfaces assert, flatly and in a tone that reads as permanent, that
DiveDay will never track individual rental units:

- `/product` page, "An honest no" section (`notCovered.gearSerials`): *"DiveDay tracks every
  diver's sizes and builds the trip's packing list. It doesn't manage individual rigs or service
  history."*
- The CSV-importer's honesty list (`staff/settings.json`, `receiptsService`, shown to staff mid-import
  as "what will not come across"): *"Payment records stay with your processor; gear-service history
  has nowhere to land — DiveDay tracks sizes, not individual rigs."*

Both are accurate **today** — `rental_fit_profiles` really is sizes-only, per its own schema comment
("the shop tracks no equipment inventory... never a reservation of a particular item"). But in the
same session that surfaced this, the product owner said the gear register (item-level units,
assignment/reservation per booking date range, a service-due flag) is something DiveDay may build
soon, not a permanent non-goal. I added a new, firmly-decided `notCovered.workOrders` entry
declining repair tickets/work orders in this same change (that one *is* a stable no), but left these
four strings alone rather than guess at the right framing for something still unresolved.

## Why it isn't already done

No ADR exists for the gear register yet (`roadmap.md` §3 explicitly requires one — it reverses the
shipped M5 decision). Claiming "coming soon" in public copy ahead of that ADR would be a promise the
claims policy doesn't currently authorize (`commercial-outreach` skill: "if it doesn't trace to an
authorized decision, flag it as needing product-owner sign-off rather than drafting it as settled").
But leaving the copy as a flat, permanent "no" is arguably no longer the honest version either, now
that the internal answer has shifted from "won't" to "not yet, and we're weighing it." This is a
tone/timing call for the product owner, not an engineering one.

## Proposed change

Ask the product owner which of these, then execute the four-string edit (English + Spanish, both
files, same change, per the i18n rule that a key's value changes together across locales):

1. **Leave as-is until the gear-register ADR lands**, then rewrite both entries in that ADR's own PR
   (delete this follow-up then). Safest against overpromising; costs nothing now.
2. **Soften now, without promising a date** — drop "It doesn't manage individual rigs or service
   history" for something like "DiveDay doesn't track individual rental units today" (English) and
   the equivalent tense shift in Spanish (`hoy` / `todavía`), which is still fully accurate and stops
   asserting permanence without claiming unbuilt work. I'd default to this option if asked to pick,
   since it costs one word of nuance and removes a claim that's already known to be uncertain
   internally.

Not proposing option 3 (remove the claim entirely and say nothing) — the importer's honesty list
exists specifically so staff aren't surprised by what doesn't come across, and silence there is worse
than an accurate "not yet."

## Prompt

```text
Read docs/product/features/roadmap.md §3 (minimal gear register) to check whether an ADR has since
been accepted for it. Read the four strings this follow-up names: src/i18n/locales/en-US/diver.json
(marketing.product.notCovered.gearSerials, currently line ~2673) and the matching es-ES key, plus
src/i18n/locales/en-US/staff/settings.json (importer.honesty.receiptsService, currently line ~484)
and its es-ES match. If the ADR has landed and gear-register work has shipped or is imminently
shipping, rewrite all four to say what DiveDay now does (or will do on a stated date) instead of a
flat "doesn't manage individual rigs" — keep en-US and es-ES in the same change, match the
established es-ES register (see src/i18n/locales/es-ES/README.md), and update
src/app/product/page.tsx's notCovered array only if a key is renamed. If no ADR exists yet, ask the
product owner whether to soften the tense (option 2 in this file) or leave it (option 1) rather than
picking unilaterally. Run node scripts/check-locale.mjs and pnpm check:copy after editing. Delete
docs/product/follow-ups/FU-20260815-gear-register-non-goal-copy-is-now-stale.md as part of the
change.
```
