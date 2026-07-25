# 20260725-import-specialty-cards — Import specialty cards verified, but hold the specialty gate until a staff confirm

- **Status:** Accepted
- **Date:** 2026-07-25
- **Supersedes (in part):** [20260724-import-verified-cards](20260724-import-verified-cards.md)'s
  "`specialty_certifications` is unchanged because a contact file has no specialty column to import
  from" scope note and its "specialties stay gated (not imported)" mitigation.

## Context

The product owner asked to move rows out of the published honesty table's "Stays behind" column into
"Comes across" — across every switching surface at once, which one shared array
(`IMPORT_HONESTY_TABLE`) already makes possible. Of the three rows sitting there, only one was a real
capability gap rather than a boundary we intend to keep: specialty cards. Payment methods stay with
the processor by design, and booking/trip/service history needs a full-shop importer, not a row edit.

The premise the old row rested on — "a contact file has no column for them" — was true of a single
contact CSV and false of the file the switching guides actually tell shops to export. The EVE and
DiveShop360 guides both walk an owner through a **separate certification export**, which holds one
row per card; that is exactly where "PADI Deep Diver" lives. So the importer was declining data the
guides were already asking for.

The safety edge is sharper here than for a ladder card. A specialty is not a rung, it is the thing
that authorizes a materially riskier dive: the deep gate is what keeps an uncarded diver above 18 m.
20260724 accepted "an imported card clears the boarding/depth gate" partly *because* specialties were
still gated — that mitigation disappears the moment specialties import. The assistant put the choice
to the owner as three postures (clears on import like a ladder card / verified but gate holds until
confirm / imports `pending`), and the owner chose the middle one. Recorded as **H-23** in
`docs/product/human-decisions.md`.

Two smaller gaps surfaced while reading the same path and are fixed here because leaving them would
make the new row's copy false: a card's **expiry was silently dropped** on import (nothing mapped to
`certifications.expires_at`, so every migrated card was valid forever despite the honesty table
saying "expiry still applies"), and **`people.dive_insurance` was exported but not importable**, so
DiveDay's own export did not round-trip.

## Decision

- **Specialty cards import `verified` and flagged imported.** `specialty_certifications` gains the
  same two nullable columns `certifications`/`nitrox_certifications` already carry — `imported_at`
  and `imported_from_label` (migration `20260725043149_import-specialty-cards`).
  `commitContactImport` writes them exactly like a level card, and a specialty card already live on
  that diver is never touched (`specialtySkippedExisting`).
- **The specialty gate holds until the one-tap confirm.** This is the one place a specialty is
  stricter than the ladder. `specialtyBlocker` (`src/lib/readiness.ts`) clears a requirement only on a
  verified, unexpired card that is either hand-entered (`importedAt` null) or confirmed
  (`reviewedAt` set); an imported-unconfirmed card reports the new
  `specialty_import_unconfirmed` blocker, ranked ahead of `pending`/`missing` because the diver is one
  tap from cleared. Expiry outranks it: an imported card past its refresher date reports
  `specialty_expired`. The hold lives in the readiness layer — where every specialty gate is
  evaluated — not in the written `status`, so the fact that the prior system checked the card is not
  thrown away to express it. Boarding never waits; only the dive that requires the specialty does.
- **An agency number identifies the diver, not the card** — so the specialty table is re-keyed on
  `(shop, agency, specialty, lower(identifier))`. A PADI diver's Deep and Wreck cards carry the same
  PADI number (glossary — "C-card": agency, level, cert/diver number), and the old key allowed only one
  specialty card per diver per shop: the second was refused by `createSpecialtyCertification` and
  silently skipped by the importer, and the remedy this ADR's first draft offered ("give each card its
  own number") does not exist at any agency. With the specialty in the key, a `Specialties` cell naming
  "Deep, Wreck" imports **both** cards under the diver's one number, and a specialty column
  legitimately uses the row's `certification_number` when it has no number column of its own.
- **A repeated email is the same diver, not a duplicate row.** A certification export lists one row
  per card, so a three-card diver appears three times — and the original rule ("duplicate of an earlier
  row, skipped so the first wins") discarded every card after the first, which is exactly the file the
  guides tell a shop to export. A later row whose email an earlier row already brought in is now
  `action: "merge"`: its cards, waiver, and sizes are written onto that diver, its contact fields are
  left as the first row gave them, and it is counted (`rowsMerged`, "Extra card rows") rather than
  reported as skipped.
- **Specialty detection runs before `normalizeLevel`**, so "Advanced Wreck Diver" reads as the wreck
  specialty (a penetration rating) rather than the Advanced Open Water rung. The test is on what the
  level column *says*, not on which column supplied the row's specialty — otherwise a row carrying both
  a `specialty` column and a specialty-named `certification_level` files that rating as a verified AOW
  card, which clears its gate on the spot.
- **The refresher-due date comes across, including a past one — and an unreadable one fails
  closed.** A new `certification_expires_at` field feeds `certifications.expires_at` and
  `specialty_certifications.expires_at` (nitrox carries no such column, so it is never applied
  there). `parseCardDate` reads the formats real exports emit — `05/04/2030` (month-first, as the
  US-locale systems in the guides write), `25/12/2030` (day-first when the first part cannot be a
  month), `4-May-2030`, `May 4, 2030`, ISO — not ISO alone, which would have left the most common
  real format unread. A date already past imports as-is and lands as a card that is due, because an
  overdue card on file is a fact readiness must see. A value present but **unreadable, or
  unbelievable** (year outside 1900–2200 — `9999-12-31` is how a card silently becomes valid forever)
  lands the row's cards `pending` rather than upgrading them to no-expiry: an unreadable gate input is
  not a pass. Staff-facing copy calls this the **refresher-due** date, never a card expiry — C-cards
  do not expire (glossary, H-08); only the CSV column name keeps the `expires_at` spelling, since it
  is the export's round-trip contract.
- **A source that says "not verified" is believed.** The verified-on-import posture rests entirely on
  the prior system having checked the card. Where the file's own status column says it had not
  (`unverified`, `pending`, `expired`, `no`, …), the card imports `pending` for staff review — still
  flagged imported, because provenance is a fact either way. `certification_status` was previously
  mapped, shown to the owner as a recognized column, and then ignored.
- **Card numbers are bounded (2–120 characters), and every card insert is conflict-tolerant.** The
  bulk path had no length bound where the hand-entry form has one, and the unique indexes are btrees
  over `lower(identifier)`: a single 2,000-character cell overflows a btree tuple and aborts the whole
  5,000-row transaction with an opaque error. Out-of-range numbers now decline that one card with a
  reason, and each insert carries `onConflictDoNothing` so a staffer entering a card by hand
  mid-import cannot lose the migration.
- **"Already on file" and "held by another diver" are reported apart.** The pre-read maps carry the
  `personId` holding each number, so a number live on a *different* diver in the shop is counted as
  `cardsHeldByAnotherDiver` and named as such. The card is not written either way (the unique index
  forbids it), but reporting it as "already on file" tells an owner a diver is carded when they are
  not.
- **Dive insurance comes across** as the free text the file holds (`dan`, `insurance`,
  `dive_insurance`, …) into `people.dive_insurance`, filled non-destructively like phone — never a
  gate, just the detail a crew wants in an incident.
- **An imported specialty card is visibly distinct on the diver's record.** It reads
  "certified · confirm to clear" in a warning tone rather than the plain green "certified" a
  hand-verified card gets, and it counts toward the profile header's "needing a look" — a `verified`
  status that does not clear its gate must not be pixel-identical to one that does.
- **The honesty table moves one row and adds one.** "Specialty cards (deep, wreck, night, drysuit)"
  becomes `included` and states the confirm-before-the-dive rule and which columns carry it;
  "Dive insurance (DAN)" is a new `included` row; the certification-card row now says expiry travels.
  Payment methods and booking/service history stay `stays-behind`. All three rendering surfaces (both
  switching pages, the in-app wizard) follow automatically.

## Alternatives considered

- **Clear the gate on `verified`, like a ladder card** — the strongest "comes across" claim and
  consistent with 20260724; rejected by the owner because a spreadsheet typo would then clear a deep
  dive, and the depth gate is the one specialties exist to enforce.
- **Import specialty cards `pending`** — safest and simplest (no readiness change at all), but it
  discards the same "the prior shop checked this" premise 20260724 was built on, and the honest table
  row would have read "comes across, then re-verify everything" — barely a move out of Stays behind.
- **Fabricate per-specialty card numbers so a multi-specialty cell can import** (e.g. `12345-wreck`)
  — rejected outright, and no longer needed: re-keying on the specialty means the diver's real number
  carries every one of their specialty cards.
- **Keep the old unique key and tell shops to give each specialty card its own number** — what the
  first draft said; withdrawn on `dive-domain-expert` review as advice no PADI/SSI/NAUI/SDI/TDI shop
  can follow, since the number is the diver's.
- **Keep treating a repeated email as a duplicate row** — would have left the published "specialty
  cards come across" claim false for the very one-row-per-card file the guides ask a shop to export.
- **Drop a past refresher-due date rather than import it** — rejected: it hides a real fact and
  preserves the pre-existing bug where a migrated card never comes due.
- **Parse ISO dates only** — rejected: EVE runs on a US-locale Windows box and spreadsheets write the
  machine's locale, so ISO-only silently discarded the common case, and discarding it produced a card
  with no refresher date at all.
- **Move the payment or history rows too** — declined. Card data stays with the processor as a
  boundary, not a gap; history needs a full-shop importer, which is a milestone rather than a row.

## Consequences

Easy: the switching pages can say specialty cards come across, which is now true for the certification
file the guides already ask a shop to export; a migrating shop's deep/wreck/night/drysuit divers stop
being invisible to the readiness engine; and a migrated ladder card can finally expire.

Hard, and worth a future owner's attention: the readiness engine now has two different rules for an
imported card — a ladder card clears on `status`, a specialty card needs `reviewedAt`. That asymmetry
is deliberate and documented at both sites (`schema.ts`, `specialtyBlocker`), but it is the kind of
thing a later change can flatten by accident. A shop that imports specialties and never confirms them
will see `specialty_import_unconfirmed` on every specialty trip; the Today queue groups those as
"Confirm imported specialties" so the work is visible rather than mysterious.

Left deliberately for a later change, and named here so it is not mistaken for an oversight — the
first two of these were closed the same day by
[20260725-imported-card-sighting](20260725-imported-card-sighting.md) (H-24): the
one-tap **Confirm card** asserts nothing in particular — it stamps `reviewedAt` with no prompt and no
attestation, where "Mark certified" means a staffer looked the number up with the agency. The
`dive-domain-expert` review recommends the confirm state what it asserts ("I've seen this diver's Deep
card"), and no bulk confirm; that is a product decision on top of H-23, not part of it. Also open:
there is no edit affordance for a card's refresher-due date anywhere (only Add and Delete), so fixing a
mis-mapped date means delete-and-retype, which destroys the imported provenance; and the preview does
not tally how many cards land already past their refresher date, which an owner would rather learn
before Saturday than at the dock. `normalizeLevel` mapping anything containing "advanced" to Advanced
Open Water (so TDI Advanced Nitrox imports as an AOW card that *does* clear its gate) is a pre-existing
defect on the level path, unchanged here and worth its own fix.

Escape hatch: to make specialties clear on import like ladder cards, delete the
`importedAt`/`reviewedAt` clause and the `specialty_import_unconfirmed` branch from `specialtyBlocker`
— nothing else changes. To back the whole thing out, stop writing `row.specialty` in
`commitContactImport` and restore the `stays-behind` honesty row; the columns can stay (they are
nullable and harmless). Card expiry and dive insurance are independent of the specialty decision and
would be kept in either direction.
