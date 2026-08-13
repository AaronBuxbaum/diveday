# FU-20260813-es-marketing-says-descargo-app-says-exencion — Settle one Spanish word for "waiver" across the marketing bundle

- **Status:** Open
- **Raised:** 2026-08-13 — the `/product` design pass, trimming `marketing.capabilities.*` in both locales
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/i18n/locales/es-ES/diver.json`, `src/i18n/locales/es-ES/README.md`

## What I noticed

A Spanish-reading buyer is told about two different documents.

Every diver-facing namespace in `src/i18n/locales/es-ES/diver.json` calls a waiver an
**exención**: `waiver.*` (11 strings), `ready.*` (6), `booking.*` (3), `demo.*` (3), plus
`account`, `notifications`, `seatClaim`, `capability`, `fallback`. That is the word on the screen
a diver actually signs.

`marketing.*` says **descargo** in 32 strings — 29 of them in `marketing.guides.*` (the whole
Smartwaiver switching guide, plus FareHarbor's and Rezdy's), two in `marketing.features.ready.*`
(rendered by `FeatureGroupsGrid` on `/` and `/pricing`), and one in `marketing.price.item1`. So
the switching guide that promises to bring a shop's signed *descargos* across leads to a product
whose every button says *exención*.

I fixed the half of it that was inside one page: `marketing.capabilities.*` is rendered only by
`src/app/product/page.tsx`, and `/product` was saying "exención" in its own prose
(`marketing.product.heroDescription`, `readinessDescription`) and "descargo" in the capability
index directly underneath. Those 44 lines now say exención.

## Why it isn't already done

The remaining 32 strings are other pages' copy — the switching guides, the homepage feature grid,
the pricing page — and this session owned `/product`. Rewriting them from a product-page branch
would collide with any in-flight work on those surfaces, and the guides in particular are
carefully-cited competitive copy where a find-and-replace is not obviously safe (`descargo` also
appears inside sentences describing *Smartwaiver's own* records, where naming the incumbent's
artifact may read better).

It also wants a line in `src/i18n/locales/es-ES/README.md`. That file already settles *el centro*,
*sitio de buceo*, and *plaza* precisely so the next translator does not re-litigate them; waiver
is the same shape of decision and is simply missing from it.

## Proposed change

Pick **exención** — it is what the app says, it is the majority across the bundle as a whole, and
the marketing surface is the one that should sound like the product rather than the reverse — and
sweep the remaining 32 `marketing.*` strings, reading each one rather than replacing blind:
`descargos firmados` → `exenciones firmadas`, and watch the agreement (`el descargo` is masculine,
`la exención` is feminine — `firmado`/`firmada`, `este`/`esta`, `uno`/`una`).

Then add a row to the terminology table in `src/i18n/locales/es-ES/README.md` so it is settled:
the waiver is **la exención**, and *descargo* is not a synonym in this bundle.

Not proposed: touching `en-US`, and not proposed as a `sed -i` over the file — three of the
Smartwaiver strings describe the incumbent's own artifact and want a human eye on whether the
sentence still reads.

## Prompt

```text
In src/i18n/locales/es-ES/diver.json, the marketing namespace calls a waiver "descargo" in 32
strings while every diver-facing namespace (waiver, ready, booking, demo, account, notifications,
seatClaim, capability, fallback) calls it "exención" — so a Spanish switching guide promises to
carry a shop's "descargos" into a product whose every screen says "exención".

Read src/i18n/locales/es-ES/README.md first: it is the record of settled terminology (el centro,
sitio de buceo, plaza) and the rule that key names and key order never change, only values.

Change the remaining "descargo"/"descargos" strings under marketing.* to "exención"/"exenciones",
reading each sentence rather than replacing blind — the noun's gender flips, so every adjective,
article and demonstrative reaching back to it has to move too (firmado→firmada, este→esta,
un→una). Three strings under marketing.guides.smartwaiver.* describe Smartwaiver's *own* records
rather than DiveDay's; decide per string whether naming the incumbent's artifact reads better and
say why in the commit. Do not touch en-US.

Then add the decision to the terminology table in src/i18n/locales/es-ES/README.md: the waiver is
"la exención"; "descargo" is not a synonym in this bundle.

Done when: node scripts/check-locale.mjs passes, `pnpm check` is green, and grepping the es-ES
bundle for "descargo" returns only strings a human deliberately kept. Delete
docs/product/follow-ups/FU-20260813-es-marketing-says-descargo-app-says-exencion.md as part of the
change.
```
