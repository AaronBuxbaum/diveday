# es-ES — terminology and register

The Spanish bundles in this folder (`diver.json`, `staff.json`) are one voice, not two, and they are
written for a **mostly Latin American** audience. This file records the choices a 2026-08-03 sweep
made (review finding I18N-5) so the next translator does not re-litigate them string by string.

Rules that outrank everything below: key names and key order never change, only values; every ICU
placeholder (`{name}`, `{count, plural, …}`, `{hasShop, select, …}`) survives verbatim; and a key
added here is added to `../en-US/` in the same change. `pnpm check:locale` fails on any of those.

## The shop is **el centro**

One entity, one word. "Tienda" and "centro" were both in use for the dive shop — sometimes on the
same page — and the sweep settled on **centro** (masculine) everywhere:

| English | Spanish |
| --- | --- |
| the shop | el centro |
| your shop | tu centro |
| a shop / dive shop | un centro / un centro de buceo |
| shops (plural) | los centros |
| shop-wide | de todo el centro |
| founding shop | centro fundador *(not "fundadora" — the noun is masculine now)* |
| demo shop | centro de demostración |

Watch the agreement when you edit around it: `el`/`del`/`al`, `este`, `un`, and any adjective that
reaches back to it (`vacío`, `listo`, `lleno`, `precargado`, `completo`, `corto`).

**"Tienda" is not banned — it just means retail now.** When the English says *retail*, the Spanish
says **venta minorista**, and that distinction is the point of dropping the word for the entity:

| English | Spanish |
| --- | --- |
| retail lines / retail records / retail history | (líneas / registros / historial) de venta minorista |
| retail POS | POS minorista |
| POS / point of sale | POS / punto de venta *(never "TPV", which is peninsular)* |

`trastienda` (a shop's back office, as opposed to the counter) is a different word and stays — do
not let a find-and-replace on "tienda" eat it.

## Register: Latin-American-readable, warm, tú

- **Tú, never vosotros.** There are no `vosotros` forms in either bundle and none should appear.
  Address one reader: `revisa`, `toca`, `inténtalo`.
- **Quotation marks are `“ ”`, not `« »`.** Guillemets read as peninsular typesetting; curly double
  quotes match both the English source and Latin American usage.
- **Vocabulary swaps applied.** Keep going in this direction:

| Avoid (peninsular) | Use |
| --- | --- |
| TPV | POS / punto de venta |
| ordenador (de buceo) | computadora (de buceo) |
| coger | tomar |
| pulsar / pulsa / mantén pulsado | presionar / presiona / mantén presionado |
| a por (algo) | a buscar (algo) |
| apuntarse (a una lista) | inscribirse / anotarse |
| "también vale" | "también está bien" |
| comprobar / comprobación | verificar / revisar (see below) |

- **verificar vs. revisar.** *Verificar* is confirming a fact against evidence — a card, an age, a
  connection, readiness. *Revisar* is looking something over — a price list, an address, a browser
  setting, a page you were told to come back to. Both replace *comprobar*, which is understood
  everywhere but reads as Spain.

## A place you dive is **un sitio de buceo**

One concept, one word — the same rule as *el centro*, settled on 2026-08-05 alongside the English
**dive site** / **dive briefing** split (`docs/product/glossary.md`). Three terms were live for the
same row in `dive_sites`: *sitio de buceo* on the nav tab, the library title and the command
palette; *punto de inmersión* on the schedule builder, the trip header and the requirements note;
*punto de buceo* on the diver schedule card and the shop home's first-run checklist. A staffer who
picked a *punto de inmersión* on a trip and then went looking for it under *Sitios de buceo* was
reading two names for one thing — which is the exact confusion the English fix removes.

| English | Spanish |
| --- | --- |
| dive site | un sitio de buceo |
| dive sites | los sitios de buceo |
| the dive-site library | la biblioteca de sitios de buceo |
| site to be confirmed | sitio por confirmar |

**Two neighbours that are *not* this word, and must stay distinct:**

- **la inmersión** is one dive — one tank, in the water. `plannedDives`, "Dive 2", every roll-call
  checkpoint. A two-tank day is *dos inmersiones* at one *sitio*, or at two.
- **el punto** survives only for a literal coordinate: the marine forecast's offshore
  point (`diveSites.form.forecastLegend`, "punto de pronóstico"). Never for the place itself.

*Briefing* keeps its English form where crews already use it (`shared.tripDiveFields.footerNote`),
and *ficha* below no longer names a dive-site record — it was doing the job the English word
"briefing" wrongly did.

## Deliberately left alone

Not everything that looks peninsular is. These stay, and changing them would be a retranslation
rather than a terminology sweep:

- **plaza** for a seat on a boat (`plazas libres`, `última plaza`). Standard across Latin American
  tourism and diving. `cupo` is the alternative if a native reviewer ever disagrees — it would be
  ~80 strings across both bundles, so do it as one deliberate change, not opportunistically.
- **ficha** for a *person's* record, **tablilla** for a clipboard, **trastienda** for a
  back office, **escaparate** for a storefront, **eslogan**, **de maravilla** — idiomatic, widely
  read, and part of the voice the bundles already have. (*ficha* no longer names a **dive site**'s
  record — see the section above.)
- **The waiver body and medical questionnaire stay English.** That wording is legally reviewed;
  translating it is a human sign-off (H-01/H-03 in `docs/product/human-decisions.md`), not a
  translator's call.
- **Brand and agency names** — DiveDay, PADI, SSI, Open Water, C-card, Stripe, WhatsApp — and
  competitor product names and menu labels quoted from their own UI.

## When you add a string

Match the surrounding voice: short, warm, second person, no exclamation-mark padding. Say what
happened and what the reader can do next, in that order. Then run:

```bash
node scripts/check-locale.mjs   # coverage + ICU placeholder parity across locales
```
