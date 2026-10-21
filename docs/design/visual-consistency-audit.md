# Visual and copy consistency audit

2026-10-21 · issue [#2887](https://github.com/AaronBuxbaum/diveday/issues/2887)

## Decisions

Aaron approved these conventions during the audit:

- Short status, summary, and empty-state fragments have no final period. Full sentences keep
  periods. The rule follows the rendered message, including plural and select branches, rather
  than the final character of its source string.
- The pickup field is **Hotel / lodging** in English and **Hotel / alojamiento** in Spanish.

The punctuation rule is recorded in [brand.md](brand.md#typography). No domain state, safety
qualification, permission, or persistence rule changes in this sweep.

## Copy coverage and method

All 100 message JSON files were included in structural scans: 50 per locale, with 11,405 leaf
strings each. The source review covered punctuation variants, heading capitalization, pending
labels, action spelling, physical-unit spacing, leading/trailing whitespace, and separator
variants. Candidates were checked against their rendering context: a collapsed diver-file
summary, a ledger value, a status, a control, or prose. ICU plural/select messages were reviewed
separately, including their resolved branch endings; a source string ending in `}` can still
render a fragment ending in a period.

The sweep changes **641 message values** across **355 keys** in **73 locale files**: 354 English
values and 287 Spanish values. The same keys and placeholders remain available in both locales.
The counts differ because a translated sentence can have a different grammatical shape.

| Category | Corrections |
| --- | --- |
| Fragment punctuation | 532 literal fragment values and 52 ICU fragment values lose their final periods. Internal punctuation and instructions remain. Examples: `workOrders.diver.ordersEmpty`, `orders.index.emptyAll`, `today.blockerRow.waiverNotSent`, and standalone roll-call count fragments. |
| Sentence punctuation | 43 complete-sentence values gain a final period. These include course-ladder paragraphs, first-run instructions, delivery-failure reasons, crew warnings and finite supporting copy. The rental-gear introductory sentence also starts with a capital. |
| Heading and field consistency | `Hotel Pickups` and `Hotel Pickup` use sentence case; both pickup-location fields use Aaron’s chosen label. |
| Pending labels | Inbox `Sending…` / `Enviando…` and rental-fit `Keeping…` / `Guardando…` use the same ellipsis as the app’s other pending controls. |
| Units | The gear-size example is `3 mm`, matching exposure-suit and preparation copy in both locales. No unit conversion changes. |
| Action spelling | `Resend invite` and `Confirmation email resent` use the existing `resend` spelling. Message keys stay the same. |

The reverse pass also checked missing sentence punctuation. A prose-context scan across the same
100 bundles produced 68 candidates, then rendering context separated standalone finite prose from
headings, controls, parenthetical hints, resolved ICU endings and pieces of composed paragraphs.
The final correction set includes 43 sentence additions and 10 further fragment corrections. The
first-run contact and profile descriptions are noun phrases without a main finite predicate; their
completed statuses and the short waiver-sent acknowledgement are fragments too. Their final periods
come off, while complete first-run instructions and standalone failure reasons gain periods.

The full manifest classifies the 641 values as 532 literal fragments, 52 ICU fragments, 43 sentence
additions, 13 formatting corrections and one spelling correction.

### Context preserved

- A full sentence such as “No orders match these filters.” keeps its period. So does an
  imperative error such as “Check the details and try again.”
- Headings, field labels and controls keep their label conventions. An imperative button such
  as “Save” is a control label; an independent instruction paragraph is prose.
- Multi-sentence notices keep their sentence punctuation, including their internal status clause:
  “Saved. The crew will have your sizes.” is prose, not a standalone “Saved” label.
- Sixty-one literal Spanish counterparts remain punctuated because they are full sentences:
  English “No orders yet” is a fragment; Spanish “Todavía no hay pedidos.” is a sentence.
  ICU branches were judged separately for the same reason. For example, Spanish
  `waiverExpired.one` is a sentence while its plural branch is a fragment.
- `Cant.` remains a Spanish quantity abbreviation, rather than being treated as a sentence-ending
  period. Brand/agency names, quoted third-party menu labels, and ICU quoting keep their spelling.
- Whitespace scans found 14 composed strings per locale with deliberate surrounding whitespace:
  suffixes, import-result prose, and a mailto body. Their composition remains intact.
- Composed paragraphs retain their separators. The boat count above Today joins a job sentence;
  checkpoint warnings join unmarked and missing-person counts; a certification detail joins its
  requirement sentence. Their periods separate clauses in the rendered paragraph. These were
  checked through the existing exact composition tests rather than judged as isolated strings.
- Legal and medical bodies and formal evidentiary prose retain their wording and punctuation.
  Multi-sentence message paragraphs retain their boundaries. Punctuation changes in safety
  summaries and complete warning sentences preserve every condition and qualification word.
- Existing collection list/edit/add work in [#2886](https://github.com/AaronBuxbaum/diveday/pull/2886)
  is the base of this branch and is not repeated as a second redesign.

### Changed values by bundle

A zero means the Spanish counterpart is already consistent or is a full sentence.

| Bundle | English | Spanish |
| --- | ---: | ---: |
| `diver.json` | 35 | 28 |
| `staff/activity.json` | 1 | 0 |
| `staff/backup.json` | 2 | 1 |
| `staff/benchFollowUp.json` | 7 | 5 |
| `staff/blowout.json` | 2 | 0 |
| `staff/boats.json` | 4 | 3 |
| `staff/calendar.json` | 2 | 2 |
| `staff/calls.json` | 1 | 1 |
| `staff/closeout.json` | 6 | 4 |
| `staff/counterRentals.json` | 7 | 7 |
| `staff/courses.json` | 7 | 5 |
| `staff/desk.json` | 5 | 4 |
| `staff/diveSites.json` | 8 | 6 |
| `staff/divers.json` | 26 | 18 |
| `staff/gear.json` | 17 | 14 |
| `staff/inbox.json` | 4 | 4 |
| `staff/incidents.json` | 14 | 7 |
| `staff/integrations.json` | 6 | 5 |
| `staff/lenses.json` | 4 | 3 |
| `staff/manifest.json` | 4 | 1 |
| `staff/orders.json` | 8 | 6 |
| `staff/participants.json` | 2 | 2 |
| `staff/promos.json` | 6 | 6 |
| `staff/reports.json` | 4 | 3 |
| `staff/reviews.json` | 10 | 10 |
| `staff/schedule.json` | 3 | 3 |
| `staff/seatDiver.json` | 1 | 1 |
| `staff/settings.json` | 40 | 36 |
| `staff/shared.json` | 17 | 14 |
| `staff/shopHome.json` | 12 | 11 |
| `staff/staffing.json` | 8 | 7 |
| `staff/today.json` | 23 | 23 |
| `staff/tripPrep.json` | 2 | 1 |
| `staff/tripSeries.json` | 1 | 0 |
| `staff/trips.json` | 33 | 27 |
| `staff/waiversStaff.json` | 4 | 2 |
| `staff/whatsapp.json` | 2 | 2 |
| `staff/workOrders.json` | 16 | 15 |

The other 12 English bundles and 15 Spanish bundles were included in the scans and produced no
confirmed correction within these categories. Coverage of source strings does not establish that
every runtime state has been photographed; rendered coverage is recorded in the
[visual pattern audit](visual-pattern-audit.md).

## Validation

The copy pass preserves key coverage and ICU arguments. `node scripts/check-locale.mjs` passes
with zero untranslated values; `node scripts/check-voice.mjs` passes with its four existing
baseline tells; `node scripts/check-copy.mjs` passes with zero hard-coded strings to extract.

Existing exact text assertions and browser locators were updated to the new messages. Arbitrary
component-test fixture strings remain arbitrary: a test of a component receiving “Saved.” as a
prop does not need changing when the live bundle now supplies “Saved”. Checks of multi-sentence
notices retain their original text assertions. No new copy-only tests or broader timeouts were
introduced.

The post-composition focused run passed **775 tests in 52 files**: `src/i18n`,
`checkpoint-gap-words`, and the existing ready-thread facts, sections, and spine tests. It preserves
the pinned Today paragraphs and keeps unmarked people separate from people marked not back aboard.

The final reverse-pass run passed **835 existing tests in 54 files** at one worker: `src/i18n` plus
the related waiver-send, diver waiver group, first-run copy and checklist, booking gear and embed
generator tests. No additional assertion rewrite was needed for these corrections: live-copy
checks already preserve the relevant semantics, and arbitrary fixture prose stays independent of
the message bundles. Final browser and visual-review results belong to the integration audit.
