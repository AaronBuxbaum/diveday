# 20260725-import-prior-visits — Import a diver's prior-shop booking history as inert, display-only records

- **Status:** Accepted
- **Date:** 2026-07-25
- **Supersedes (in part):** [20260725-import-specialty-cards](20260725-import-specialty-cards.md)'s
  scope note that "booking/trip/service history needs a full-shop importer, not a row edit", and the
  `IMPORT_HONESTY_TABLE` row it left behind ("Booking, trip & service history" → *Stays behind*).

## Context

The product owner asked whether "Booking, trip & service history" — the last capability-shaped row in
the published honesty table's *Stays behind* column — could realistically be imported, or some subset
of it.

It bundles three different things, and they have three different answers:

- **Service history** has no destination. Item-level inventory, booking assignment, and service
  history were deliberately removed in M5 as a half-maintained duplicate (`docs/product/vision.md`);
  a lightweight who-has-what register may return (roadmap §3) but does not exist. Nothing to import.
- **Trip records and receipts** should not be reconstructed. Writing `trips`/`bookings` rows from a
  competitor's export means inventing `capacity`, `plannedDives`, and a roll call that never
  happened here — a fabricated safety document — and `orders.stripeInvoiceId` is `notNull` + unique,
  so money history has no honest row at all.
- **The visits themselves** are genuinely available. Every export the switching guides already walk
  an owner through — FareHarbor's Bookings/Contacts reports, Rezdy's Sales/Orders report and Data
  export, EVE and DiveShop360 sales history, a shop's own spreadsheet — is one row per booking,
  carrying the customer, the date, what the trip was called, its status, and what was charged.

The assistant's first proposal was to import only a per-diver *summary* (visit count, first seen,
last seen). The product owner pushed back, and was right to: aggregating is where the fabrication
enters. An orders export contains cancellations, no-shows, and refunds, so "12 visits" is a claim the
file never made, while a list that carries each row's own status word is exactly what the file said.
The list also strictly contains the summary — counts fall out of it — and carries the signal a
summary destroys ("three trips to the wreck, always nitrox, every June"). Per-visit it is.

The safety edge here is not a gate — nothing in this data opens one — it is **interpretation**. A
booking record is evidence a seat was reserved, not evidence anyone got in the water. Staff read a
diver's history to judge recency and experience, and a migrated cancellation silently counted as a
dive is a wrong answer to a question the dock actually asks.

## Decision

- **A new `prior_visits` table holds one row per booking the prior system recorded**, shop- and
  person-scoped like every other domain table (migration `20260725142311_import-prior-visits`):
  `visitedOn` (date-only, shop-local), `title`, `statusLabel`, `amountLabel`, `sourceLabel`,
  `sourceReference`, `dedupeKey`, `importedAt`.
- **It is inert by construction, not by convention.** A prior visit points at no trip and no booking,
  so there is nothing to fabricate. Nothing in readiness, capacity, trip prep, manifests, roll call,
  or owner reporting reads this table; the only consumer is `getDiverProfile`, and
  `commitContactImport` writes it and no operational table (asserted in `src/db/import.test.ts`).
- **The source's status word is carried verbatim and never mapped** to a DiveDay booking status. The
  vocabularies are not the same, and a row that says "Cancelled" must keep saying it. The profile
  strikes such a row through (`priorVisitStanding`, deliberately conservative — anything unrecognized
  reads as a visit that stands), but the label itself is never rewritten.
- **The amount is display-only, and text is what makes that structural.** `amountLabel` holds the raw
  string the file wrote ("$180.00", "160,00 €") — no minor units, no currency column, nothing to sum.
  Storing a number would have put a plausible revenue figure one join away from the reporting
  dashboard, where it would be both wrong (mixed currencies, a foreign shop's pricing) and
  authoritative-looking. There is no number here to pick up by accident, and no locale to misread.
  The product owner asked for visible amounts; this is how they are visible without becoming data.
- **A visit needs a readable date or it is declined**, with a reason in the preview. `parseCardDate`
  is reused so a US-locale bookings export reads the way that shop's certification export already
  does. No date is ever invented — not today, not the import date — because a fabricated date puts a
  diver in the water on a day nobody claimed.
- **Re-import is idempotent on `dedupeKey`** (`prior_visits_shop_person_dedupe_unique`, written
  `onConflictDoNothing`): the prior system's own booking id when the file has one, otherwise the
  row's date/title/amount. Re-running an export as the roster grows is the normal thing an owner
  does, and doubling a diver's history is a number staff would read and believe. The fallback key
  knowingly collapses two indistinguishable same-day bookings into one visit — the safer of the two
  wrong answers, and the importer says so in that row's preview note rather than leaving it to be
  discovered.
- **The honesty table splits rather than flips.** "Past visits (what they booked, when)" is
  `included` and states both boundaries (never a trip on the schedule, never proof of a dive);
  "Receipts & service history" stays `stays-behind` with its own honest reason. All three rendering
  surfaces follow automatically.
- **The bundle exports it** (`prior_visits.csv`), because a shop's own history is its own to take
  back out — with a README note that these are booking records, that the labels are another system's
  words, and that the amounts were never summed into any DiveDay total.
- **Import bounds rise to 8 MB / 20,000 rows / 64 columns.** The old 2 MB / 5,000-row ceiling was
  sized for a contact list; a bookings export is one row per booking per diver and an order of
  magnitude larger. Still well under the 16 MB Server Actions body limit
  ([20260723-upload-transport-limit](20260723-upload-transport-limit.md)).

## Alternatives considered

- **Import a per-diver summary instead of per-visit rows** — rejected above: aggregation invents
  facts the file never stated (a cancelled booking counted as a dive), and destroys the pattern
  signal that makes the history worth having.
- **Reconstruct `trips` and `bookings` rows** — rejected. It requires inventing capacity, dive
  counts, and roll-call state; it puts trips this shop never ran on the schedule, in the Today queue,
  and in owner reporting; and `orders` cannot be honestly synthesized at all. The whole value of the
  history is available without touching an operational table.
- **Parse the amount into minor units with a currency column** — rejected. It makes "display-only" a
  convention that the next reporting query is free to break, and it has to guess a currency and a
  decimal convention from a file that states neither.
- **Normalize the status to a DiveDay booking status** — rejected. `booked`/`cancelled`/`no_show`
  mean specific things here, backed by roll call; another system's words mapped onto them would give
  a migrated row the standing of one this shop recorded.
- **A separate "history import" wizard** — rejected as unnecessary. A bookings export already
  carries the customer on every row, and the existing email-merge path (built for one-row-per-card
  certification exports) turns repeated rows into one diver plus their history. One importer, one
  preview, one transaction.
- **Import nothing, keep the row in *Stays behind*** — rejected. It was true of a contact CSV and
  false of the file the switching guides tell a FareHarbor or Rezdy shop to export, which is a
  bookings report. A regular of fifteen years arriving as a brand-new name is a bad first day on
  DiveDay, and the data to prevent it was already in the owner's hands.

## Consequences

- A shop can hand DiveDay its bookings export directly and get people *and* their history in one
  pass; the same file re-run later updates rather than doubles.
- The diver profile's "Shop history" now merges two sources on the shop's local calendar
  (`mergeShopHistory`), newest first, with a same-day tie going to the real booking. Long histories
  collapse past eight entries so a migrated regular doesn't bury the cards and sizes above.
- The "Shop history" stat tile counts bookings, not dives, and splits out the imported share.
- Anyone adding a reporting or readiness query must not reach into `prior_visits`. The table's own
  doc comment says so, and its exclusion from every operational path is what this ADR is for.
