# es-ES — terminology and register

The Spanish bundles in this folder (`diver.json`, `staff/<namespace>.json`) are one voice, not two, and they are
written for a **mostly Latin American** audience. This file records the choices a 2026-08-03 sweep
made (review finding I18N-5) so the next translator does not re-litigate them string by string.

Rules that outrank everything below: key names and key order never change, only values; every ICU
placeholder (`{name}`, `{count, plural, …}`, `{hasShop, select, …}`) survives verbatim; and a key
added here is added to `../en-US/` in the same change. `pnpm check:locale` fails on any of those.

## Who writes the Spanish

**The agent writing the feature writes the Spanish, in the same change.** There is no translation
queue, no `TODO: translate`, and no waiting on a native reviewer — a key missing from one locale
fails `pnpm check:locale`, so a string that ships in English ships in Spanish or does not ship.
That is a deliberate call (2026-08-13) about where the bar sits before there are paying shops: a
same-day imperfect Spanish page beats a perfect one that is three releases behind the English.

What that buys is a whole-product Spanish surface. What it costs is that nobody with Spanish as a
first language has read most of it. So:

- **This file is the memory.** Every terminology decision below was made once and is binding, which
  is what stops two agents rendering the same word two ways. Add to it when you settle something
  new; never re-litigate what is already here.
- **Match the register, do not improve it.** Short, warm, second person. If a sentence needs to be
  clever in English, it may be plain in Spanish — a translation that reaches for the joke and misses
  is worse than one that states the thing.
- **Regional vocabulary follows the market**, which is Latin America and the Caribbean. Where Spain
  and Latin America differ, take Latin America; where the Caribbean has its own word for a fish or a
  reef feature, take the Caribbean one (see the field-guide section below).
- **Anything with legal or medical weight is exempt** and stays English pending a human sign-off —
  the waiver body and the medical questionnaire, below.

A native review is still worth having and is not blocked by any of this: the bundles are one file
per locale, so a reviewer can read them end to end without touching code. That is a decision for
whoever is selling into a Spanish-speaking market, not a gate on shipping.

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
not let a find-and-replace on "tienda" eat it. `scripts/check-shop-word.mjs` (in `pnpm check:repo`) now
refuses `tienda` in any value here, anchored on a word boundary so `trastienda` — and `entiendas`,
in the waiver's own English-only notice — still pass. It was added on 2026-08-21 after six strings
turned up still carrying the word this section had already removed, one of them the sentence
explaining the certification question on all three public forms.

**It now guards six of this file's decisions, not one.** The same thing had happened to four more
of them by 2026-09-04 (issue #1316): `descargo` and `liberación` for the waiver, `punto de
buceo`/`punto de inmersión` for a dive site, guillemets, and a `viaje` that should have been a
`salida` — twenty-nine strings between them, one of them a settings heading reading "Puntos de
buceo". Every rule in that file quotes the section of this README it enforces, and each is paired
in `check-shop-word.test.mjs` with the near-miss it must **not** take (`trastienda`, `punto de
venta`, `punto de pronóstico`, `país`). A decision recorded here and not checked there has, on the
evidence, about a fortnight.

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

## The tide turns at **la estoa**, and it comes in and goes out as **marea entrante / saliente**

Settled 2026-09-07 with the tide window (ADR 20260907-noaa-tide-predictions). Slack water is
**la estoa** — the word a Caribbean or Mexican captain uses for the turn, and the one that does not
collide with anything: *marea muerta* is a neap tide and *repunte* is the moment it turns rather
than the window either side. Flood and ebb are **marea entrante** and **marea saliente**, never the
textbook *flujo* / *reflujo*, which read as physics rather than as water a diver can feel.

| English | Spanish |
| --- | --- |
| slack (water) | la estoa |
| at slack water | en la estoa |
| on the flood | con marea entrante |
| on the ebb | con marea saliente |
| the tide window | la ventana de marea |
| NOAA tide station | estación de mareas NOAA |

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

  **The manifest's checkpoint track abbreviates it below `sm`**, and that is deliberate rather than
  drift: *Muelle* / *Inm. 2* (`shared.rollCallCheckpoint.departureShort` / `.afterDiveShort`)
  against *Antes de zarpar* / *Después de la inmersión 2*. At boat size the full Spanish forms
  overrun a 390px track and the row reads as two lines, which is the whole of issue #1320; even
  *Inmersión 2* does not fit three options across. The abbreviation keeps the sanctioned noun
  instead of reaching for a shorter one, the full name is on screen *below* the track in the
  roll-call heading (`manifest.checkpointRollCallHeading`, *Pase de lista · Después de la inmersión
  2*) at every width and in every state, and nothing else may use the short keys. Not the summary
  panel above the track — it says *Pase de lista completo* once the checkpoint closes, and names no
  checkpoint at all from then on. Do not expand them back.
- **el punto** survives only for a literal coordinate: the marine forecast's offshore
  point (`diveSites.form.forecastLegend`, "punto de pronóstico"). Never for the place itself.

*Briefing* keeps its English form where crews already use it (`shared.tripDiveFields.footerNote`),
and *ficha* below no longer names a dive-site record — it was doing the job the English word
"briefing" wrongly did.

## A departure is **la salida** — in the staff bundles

Settled 2026-09-04 (issue #1316) by counting rather than by argument: the staff bundles said
**salida** 302 times and **viaje** 7. The seven were strays, not a second convention, and they sat
next to keys already saying *salida* — `page.backToTripGuests` read "participantes del viaje" in a
file whose other nine mentions all said *salida*.

| English | Spanish |
| --- | --- |
| the trip / this trip | la salida / esta salida |
| trip guests | los participantes de la salida |
| trip packing checklist | lista de equipo de la salida |
| post-trip (recap, tips) | posterior a la salida |

The noun is **feminine**, like *la exención*: `la`/`una`/`esta`, and `cancelada`, `programada`,
`llena`, `próxima`.

**`diver.json` is deliberately exempt, and `scripts/check-shop-word.mjs` scopes the rule to
`staff/` to say so.** That bundle uses *viaje* about thirty times in its marketing, switching-guide
and demo copy, where the English is loose in the same way — "book a trip", "post-trip recap" — and
the word is doing a different job: an outing a diver takes, not a row on the schedule board. A
diver reading "reserva un viaje" is not being told about a database record. Narrowing that copy is
a decision about diver-facing voice and belongs to whoever is writing the marketing pages; it is
not a terminology violation and this file does not call it one.

## Crew are counted one by one: **tripulante / tripulantes**

The shop home's evening line names who came home — "salieron 8 buceadores y 2 tripulantes,
volvieron 10" (issue #1346) — and the count noun there is the same one the manifest and the trip
bundles already use, singular and plural, one person at a time.

**Not the collective *tripulación*.** English gets away with "4 crew" because *crew* is both; in
Spanish *tripulación* is the body of people, so "2 tripulación" is ungrammatical and "una
tripulación de 2" turns a count into a description. The evening line sits beside a diver count
that inflects, and the two halves of one sentence have to inflect the same way.

Keep the verb-first shape that line uses (*salieron … volvieron …*) rather than translating the
English "out / back" as adjectives: Spanish states this as something the people did.

## The supervision ratio is **la ratio**, feminine, and it is *excedida* rather than *fuera*

DiveDay counts two different ratios and both reach a Spanish reader (`docs/product/glossary.md`
warns not to confuse them): the agency's published training cap, which refuses seats, and the
shop's own diver:divemaster target, which binds nothing.

- **The noun is `ratio`, and it is feminine** — *la ratio*, as `staff/shared.json` already renders
  it in the entry-level cap sentence. LatAm instructors say it colloquially, and *proporción* is the
  word agency course materials use; the two are both defensible and the point of this row is that
  the bundle picks one. Anything agreeing with it agrees in the feminine: *ratio excedida*.
- **Exceeding it is `excedida`, never `fuera de`.** *Fuera de* reads both ways in Spanish —
  *fuera de rango* is "past it", but *fuera de cupo* is "excluded from it" — and the second reading
  is the opposite of the fact. So the chip is **"Ratio de alumnos excedida"**, and it says *de
  alumnos* because the other ratio sits one column away wearing **"Bajo el objetivo"** (issue #1125).
- **Never *fuera de proporción*.** In Spanish that means *disproportionate*, which is a judgement
  about the shop rather than a count of divers.

A crew shortfall on a course session is a requirement, not a state: **"El curso necesita
instructor"**, not *"Sin instructor"*. A fun dive without an instructor is an ordinary day; a course
session without one cannot take a single enrolment, and *sin* describes the harmless one.

## A taster dive is **un bautismo**; **iniciación** names the entry-level course

Settled 2026-09-11, reading the two ratio chips above side by side. They sit in the same column of
the same week and they decide who a manager goes to find: the entry-level cap (Open Water training,
8 per instructor, +2 per certified assistant) is closed by a divemaster, and the intro-session cap
(DSD / Try Scuba, 2 per instructor, no assistant bonus) is closed by **another instructor and
nothing else** (`docs/product/glossary.md`).

The Spanish named them the other way round. **Curso de iniciación (al buceo)** is what a Spanish
speaker calls the entry-level certification course — the one the *other* chip governs — so "Ratio de
iniciación excedida" beside "Ratio de alumnos excedida" read as one fact stated twice, and a manager
picking between them had no way to tell which crew member would fix it. The trade word for a
first-time taster dive is **bautismo (de buceo)**, also *bautismo submarino*, and it is read that way
across Latin America and the Caribbean.

| English | Spanish |
| --- | --- |
| an intro session / intro course (DSD, Try Scuba) | un bautismo (de buceo) |
| on this intro session | en este bautismo |
| Over intro ratio | Ratio de bautismo excedida |
| Intro-course status | Estado de bautismo de buceo |

The noun is **masculine**: `el`/`un`/`este`, and anything reaching back to it agrees (`lleno`,
`excedido`, `programado`).

**`iniciación` is not banned — it is the entry-level sense now**, which is why
`trips.depthWarningNoCard` still says *el límite de iniciación* for the depth an Open Water card
carries. `scripts/check-shop-word.mjs` refuses only *sesión / ratio / clase de iniciación*, the
shapes that were naming a bautismo, and leaves *curso de iniciación* and *límite de iniciación*
alone.

## The wetsuit is **el neopreno**; **el traje seco** is the drysuit

Settled 2026-09-12, the day the drysuit got a size field of its own. Until then the Spanish called the
wetsuit *Traje* — the item label on the diver's kit picker, on the diver's packing list and on the
staff one, and *Talla de traje* on both fit forms — and *traje* on its own is just "suit". The moment
**Talla de traje seco** landed directly under **Talla de traje**, a diver reading the two had no
reliable way to tell that the first one meant the wetsuit, on the form that decides what comes off the
rental wall for them. *Neopreno* is the word a Spanish-speaking shop says out loud, everywhere the
market is, and it cannot be read as the other suit.

| English | Spanish |
| --- | --- |
| wetsuit (kit list, fit form, packing list) | el neopreno |
| Wetsuit size | Talla de neopreno |
| a 3 mm wetsuit | un neopreno de 3 mm |
| drysuit | el traje seco |
| Drysuit size | Talla de traje seco |

The noun is **masculine**: `el`/`un`/`este`, and anything reaching back to it agrees (`corto`,
`completo`, `húmedo`).

**`traje` is not banned — it names the dry one now.** *Traje seco* is exactly right and must not
change, *traje estanco* survives in the drysuit's own jargon hint, and a *traje de baño* is a
swimsuit. `scripts/check-shop-word.mjs` refuses the two shapes the wetsuit labels actually used: a
*talla de traje* with no *seco* after it, and a string that is nothing but the word *Traje*.

## The waiver is **la exención**

One document, one word — settled 2026-08-14, after a sweep found the marketing bundle promising to
carry a shop's *descargos* across into a product whose every screen says *exención*. Every
diver-facing namespace (`waiver`, `ready`, `booking`, `demo`, `account`, `notifications`,
`seatClaim`, `capability`, `fallback`) already said **exención**, so the marketing and switching-guide
copy moved to match the product rather than the reverse. **"Descargo" is not a synonym in this
bundle** — it appears nowhere and should not come back.

| English | Spanish |
| --- | --- |
| the waiver | la exención |
| signed waivers | exenciones firmadas |
| a waiver on file | una exención archivada |
| native waivers | exenciones nativas |
| waiver / medical documents | documentos de exención / médicos |
| medical waivers | exenciones médicas |

The noun is **feminine**, which is the whole reason this is worth writing down: every article,
demonstrative and adjective reaching back to it moves with it — `la`/`una`/`esta`, and
`firmada`, `aceptada`, `importada`, `nativa`, `versionada`, `marcada`, `fechada`.

This covers what the app *calls* the document. The waiver **body** and the medical questionnaire
are still English pending human sign-off — see "Deliberately left alone" below.

## The field guide: `marineLife.*` is content, not chrome

`diver.json`'s `marineLife` namespace is 148 species × three strings plus 18 category words, and it
is the only block in either bundle that is **content a diver reads about the world** rather than
words the app says about itself. It is here because a shop *picks* species from DiveDay's catalog
and does not write them (ADR 20260813-marine-life-is-diveday-copy) — the row stores a slug, so the
same saved briefing reads in Spanish to one diver and English to the next.

Two things follow for whoever edits it:

- **Common names are regional, and this catalog is the wider Caribbean.** Where Latin
  America and Spain disagree, take the Caribbean name — *palometa* for the permit, *rabirrubia* for
  the yellowtail snapper, *cherna*/*mero* for the groupers, *sábalo* for the tarpon. The Latin
  binomial is in `src/db/marine-life-catalog.ts`, never in a bundle, and it is the tiebreak: check
  it before renaming anything.
- **The `tip` field is an instruction to a diver in the water**, so it takes the same tú imperative
  as the rest of the bundle (*observa*, *acércate*, *no te arrodilles*), and the safety-flavoured
  ones — the scorpionfish, the fire coral, the long-spined urchin, every protected species — say
  the same thing the English says, no softer.

One category label is narrower than its code and deliberately so: `eel` reads **Morena**, because
all three species under it are morays and "anguila" would tell a diver less. Add a non-moray eel to
the catalog and that label has to be revisited — it is the one place here where the Spanish is more
specific than the English.

`src/db/marine-life-catalog.test.ts` fails if a species loses its Spanish, gains copy for a slug the
catalog dropped, or ends up with a description identical to the English one.

## The diver's shelf is **el casillero**

Settled 2026-09-10 with the shelf itself (slice 20t of ADR 20260908-one-hand). The English "shelf"
is the diver's own page at one shop — their next departure, their days in the water, and what the
shop holds for them.

**Not *estante*,** which is a plank of wood and says nothing about whose things are on it. **Not
*ficha*,** which this file already gives to a *person's record* on the staff side: one word for two
surfaces, one of them staff-facing and one of them a link on a diver's phone, is the exact collision
the *centro* and *sitio de buceo* sections exist to prevent. **El casillero** is the locker a diver
is handed at a dive centre — concrete, warm, unmistakably theirs, and read the same way across Latin
America and the Caribbean.

| English | Spanish |
| --- | --- |
| your shelf | tu casillero |
| the shelf link | el enlace de tu casillero |
| send the link (staff) | enviar el enlace |
| forget this phone | olvidar este teléfono |

The noun is **masculine**: `el`/`un`/`este`, and anything reaching back to it agrees (`abierto`,
`enviado`, `guardado`).

## A seat the diver gave up is **cancelada**; only the shop **libera** one

Settled 2026-09-11 (dive-domain-expert review of the counter's no-show door). English already keeps
the two apart — a seat "given up" by the diver against a seat the shop "freed" — and the counter can
show both sentences minutes apart on the same screen, so Spanish may not answer both with *liberar*.
`checkIn.notice.noShowNotBooked` fires only on a cancellation, and `src/lib/no-show.ts` argues that
distinction is the whole difference between a courtesy and an accusation: somebody who told the shop
they were not coming is not a no-show.

| English | Spanish |
| --- | --- |
| that seat was given up (the diver cancelled) | esa reserva se canceló |
| the freed seat (the shop wrote the diver off) | la plaza liberada |

`src/i18n/no-show-copy.test.ts` fails if either sentence takes the other's verb, in either locale.

## How names sort: nothing to do here

`Ángel` lands between `Ana` and `Bea`, and `Ñuria` after `Nuria`, on every screen that lists people
by name — because `people.full_name` carries `COLLATE "und-x-icu"` in the database itself
(`drizzle/20260911200158_person-name-collation`), not because any query asks for it. Before that
migration the order came from whatever locale the server was created with, which meant the accented
names fell after `Zoe` in the test suite and nobody could say where they fell in production.

Nothing in these bundles affects it, and no copy change can break it. If a list ever comes back in
the wrong order, the column is the place to look, never the translation.

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
