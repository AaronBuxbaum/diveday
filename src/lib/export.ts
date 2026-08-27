/**
 * Full-shop export bundle: RFC-4180 CSV serialization and ZIP assembly
 * (ADR 20260722-full-shop-export). Framework-free — the data arrives as plain
 * tables from src/db/export.ts and leaves as bytes the route can stream. The
 * CSV column sets written here are the documented contract the planned
 * importer, scheduled backups, and read API reuse; change them deliberately.
 */

import { strToU8, zipSync } from "fflate";
import { cachedFormatter } from "./intl-cache";
import { isManagedStorageUrl } from "./storage";

/** Everything a CSV cell can hold. Dates serialize as ISO 8601 UTC. */
export type CsvValue = string | number | boolean | Date | null | undefined;

export type ExportTable = {
  /** File name inside the bundle, e.g. "people.csv". */
  file: string;
  header: string[];
  rows: CsvValue[][];
  /** One line for the bundle README describing what the file holds. */
  note: string;
};

export type ExportFile = { name: string; content: string | Uint8Array };

/**
 * The bundle's file list and README notes, in bundle order. One definition so
 * the loader, the counts query behind the settings page, and the README can
 * never drift apart (a sync test enforces it).
 */
export const EXPORT_FILE_NOTES = {
  "shop.csv": "The shop profile, packing checklist, rental catalog, and rental prices.",
  "boats.csv": "The shop's boats and their passenger capacities.",
  "contacts.csv":
    "One flat row per person, shaped for another system's import wizard: names pre-split, the best certification record (current before expired, verified before pending, expiry included so the destination can enforce it), Nitrox status, rental sizes, and the most recent live signed waiver (accepted/date/source, medical_review holds excluded on purpose). The normalized files stay authoritative — this file exists so leaving never means hand-merging CSVs. Certifications imported from it should land unverified in the destination until its staff re-check the record; a waiver_accepted row should land trusted-and-marked-imported the same way this shop's own importer treats one. no_certification_declared_at is the date this diver said on a public form that they hold no certification at all — a Discover Scuba customer, a snorkeller, somebody yet to start a course. It is their own word and never a certification, level, or evidence. Blank means only that nobody has that answer on file, which is not the same as a diver who said no. It is also blank once the shop holds any certification for them, or once staff cleared it as never said; people.csv carries the raw stamp and its clearance separately.",
  "people.csv":
    "Everyone the shop knows — divers and staff — with their roles. no_certification_declared_at is the date the person said on a public form that they hold no certification at all; it is their own word and never a certification. Read it with the two columns beside it: no_certification_cleared_at set means staff said the person never gave that answer, and it is superseded. A blank no_certification_cleared_at with no_certification_cleared_by_person_id set is not a contradiction — it means staff corrected it once and the person has stated it again since, so the answer stands and that column records who disagreed. contacts.csv resolves all three into one cell.",
  "certifications.csv": "Certification records with their verification status.",
  "specialty_certifications.csv":
    "Specialty certifications (deep, wreck, night, drysuit) with verification status.",
  "nitrox_certifications.csv": "Nitrox (EANx) certifications with verification status.",
  "trips.csv":
    "Every trip ever scheduled, including cancelled ones, with sites and predicted conditions.",
  "trip_series.csv":
    "Recurring-trip cadences; every materialized instance is its own row in trips.csv carrying series_id. A blank ends_on means the trip simply keeps repeating.",
  "trip_series_skips.csv":
    "Dates removed from a recurring trip. One row per date staff deleted outright, so it is never put back on the board.",
  "trip_schedule_days.csv":
    "The meeting windows for each trip day; multi-day courses can have different times on each day.",
  "trip_dives.csv": "The ordered dives within each trip, with their sites.",
  "trip_requirements.csv":
    "Each trip's own boarding gates: waiver, minimum level, specialties, nitrox, payment. Not the whole gate — the effective requirement also composes in each visited dive site's gate (stricter minimum level wins, specialties union, nitrox if either says so); apply that composition in any system enforcing boarding from this export.",
  "trip_assignments.csv": "Which staff crewed each trip.",
  "staff_shifts.csv":
    "Dated staff availability windows; trip assignments remain the authoritative crew list.",
  "staff_credentials.csv":
    "Staff-owned ratings, insurance, and safety credentials, including their review status and renewal dates.",
  "bookings.csv":
    "Every booking with its trip, diver, and payment state. wants_nitrox is a request, never a fill authorization — honor it only against a verified Nitrox card, checked at fill time.",
  "waitlist_entries.csv":
    "Divers in line for full trips. A wait-list entry never consumed a seat and never appears on a manifest.",
  "trip_invitations.csv":
    "Staff outreach attached to a departure without claiming a seat: the source request or wait-list entry, the contact snapshot, and whether staff recorded an invitation attempt. Invitations never become bookings, capacity, readiness or manifest state by themselves.",
  "last_minute_list.csv":
    "Divers who opted in, shop-wide, to hear about last-minute deals, with the date range they said they're around. Distinct from waitlist_entries.csv: this is a general availability signal, not interest in one specific full trip.",
  "trip_last_minute_promos.csv":
    "Discount blasts sent on under-capacity trips: the discount percent, the code, when it expires, and how many divers it went to. Stripe coupon/promotion-code ids are excluded — provider linkage, useless outside this Stripe account.",
  "trip_last_minute_promo_recipients.csv":
    "Per-diver recipient audit log for last-minute promo blasts: who was sent each deal, when, and their email on file.",
  "booking_payment_events.csv":
    "Every recorded change to a booking's payment state, oldest first — what it moved to, what it moved from, the amount and currency at that moment, and which operation caused it (a checkout settling, a staff mark, a refund). bookings.csv carries only where each booking's money stands *now*, and a refund overwrites that in place, so this is the file that says how it got there. It records transitions, not writes: a webhook redelivered twice appends nothing the second time, and a refused write appends nothing at all — so a row here always means the state genuinely changed.",
  "booking_checkouts.csv":
    "Every pay-at-booking checkout attempt this shop started, settled or not — the amount asked, the discount applied and where it came from, and how the attempt ended (completed, expired, or a bank payment that failed after the fact). bookings.csv and orders.csv say what the shop was *paid*; this file is what it *asked for*, including the asks nobody finished. Read it that way: only a row with a completed_at is money, and an abandoned row is a diver who got as far as the payment page. The Stripe account id is excluded (provider linkage, useless outside this Stripe account) and so is the checkout link, which stopped working when the session expired.",
  "booking_checkout_bookings.csv":
    "Which seats each checkout was paying for, one row per seat, with the rental gear charged on that seat. A checkout covers a whole party, so a single attempt in booking_checkouts.csv can carry several rows here — and the per-seat gear figure lives nowhere else, since the checkout total has it already folded in.",
  "executed_dives.csv":
    "What each dive actually recorded after the boat left: site, times, depth, observed conditions, and fields explicitly not recorded.",
  "roll_call_events.csv":
    "The boarding and roll-call ledger — every head-count event, with who recorded it. Read it append-only and in checkpoint order (departure, then after each dive): within one checkpoint the newest event per booking wins, and a 'cleared' event erases that checkpoint's result. Then carry forward: an explicit 'not_boarded' fills every later checkpoint that has no explicit result of its own until an explicit 'boarded' breaks the chain — off the boat stays off the boat; a checkpoint with no result and nothing carried means awaiting. Never count 'boarded' rows naively; corrections would inflate the head count.",
  "roll_call_crew_events.csv":
    "The crew half of each head count: one staff member recorded one assigned crew member aboard, not aboard, or cleared, at one checkpoint. Read it exactly like roll_call_events.csv — append-only, newest row per person and checkpoint wins, a 'cleared' row erases that checkpoint's result, and a 'not_boarded' recorded at departure carries forward until an explicit 'boarded' breaks the chain. A checkpoint is not treated as closed while any assigned crew member has no result here, and a trip with nobody on its crew list does not close either — an empty crew list is a scheduling gap, not evidence that nobody else was aboard.",
  "buddy_pairs.csv":
    'Buddy teams staff recorded on each departure — one row per member, all members of a team sharing a pair_id, with who made the call and when. A team has two or more members, and member_kind says whether a row is a seated diver (booking_id set, person_id is the diver) or a crew member (crew_person_id set, person_id is that crew member and booking_id is empty): a divemaster leading a group holds no booking, and one crew member may lead several teams on one departure, so crew ids repeat across pair_ids by design. A diver appears at most once per departure. Teams are display and attention state on the roll call ("someone is back aboard and someone is not"), never a gate: they play no part in readiness, boarding, or the head count in roll_call_events.csv. Dissolving a team deletes its rows, so this file holds the teams standing at export time — the history of how they got that way is DiveDay\'s own operational record and is not exported.',
  "waiver_templates.csv":
    "Every waiver template version, full text included — signed records reference these.",
  "waiver_materiality_decisions.csv":
    "The accountable staff assertion for each published waiver version: whether the edit changed the bargain, who chose, and when. This is audit history, not an inferred diff.",
  "waiver_records.csv":
    "Issued and signed waiver evidence; the signed text is the referenced template version and template_generation records the material terms generation the signer accepted. Only status 'completed' satisfies the waiver gate, and only while current (within a year of signing, against the shop's current release). 'medical_review' means a physician's sign-off is still outstanding — that diver is blocked from boarding, not merely flagged, even though the signature fields are filled in. signature_method 'imported' means the record was trusted from a prior shop's own acceptance during a contact import, never reviewed by this shop — imported_from_label and the import_source_*_url columns carry that record's provenance; only 'imported' rows ever populate them. integrity_hash and integrity_version carry the independent signed-metadata audit seal when present; unsealed legacy rows remain explicitly identifiable.",
  "rental_fit.csv": "Each diver's rental kit and sizes.",
  "dive_support_needs.csv":
    "What each diver said their dive needs set up — in-water support, help getting aboard or into the water, how the briefing should reach them, equipment to adapt, and anyone who must be on the same boat and team. Stated by the diver on their own readiness page, never asked at booking. It records what the dive needs, not what the person is: there is no condition, classification or medical answer in this file, and nothing in it gates a booking, a boarding, or any agency ratio.",
  "gear_items.csv":
    "The shop's own rental fleet, one row per physical unit — the shop's tag, kind, size, serial number, and whether it is in service or pulled for service. Status is the shop's own operational call, never a certification of anything. A deleted unit is here too, carrying its deleted_at stamp: the row and its history stay, so this file is the whole fleet the shop has ever tagged.",
  "gear_service_events.csv":
    "Each unit's care history, oldest first: manufacturer services, tank hydrostatic tests and visual inspections, O2-clean renewals, and dated condition notes, each with the deadline staff set for that clock. The newest event of a kind is that clock's current state. This is the shop's own maintenance record — proof of care for a unit, not a work order.",
  "gear_reservations.csv":
    "Which unit was assigned to a booking or directly to a counter-rental holder, and for what dates, with the handover and return stamps. A reservation is fulfillment, never money: the rental charge lives in order_line_items.csv and booking_checkout_bookings.csv. A row with an empty returned_at is a unit still out.",
  "closeout_leftover_decisions.csv":
    "Append-only carry/dismiss choices for close-out leftovers, with the staff actor and timestamp. The final close-out snapshot remains an in-product operational record; this file preserves the per-row choices that produced it.",
  "pre_departure_checklist_items.csv":
    "The shop's own pre-departure safety line, in the shop's own reading order (sort_order) — DiveDay authors none of it. A deleted item is here too, carrying its deleted_at stamp; its history in pre_departure_check_events.csv stays readable regardless.",
  "pre_departure_check_events.csv":
    "Append-only history of every tap against a checklist item, oldest first: status 'checked' or 'cleared' (an explicit undo of a mis-tap), who recorded it and when, and whether it was recorded live or synced from an offline device. The newest event per item is that item's current answer for the departure. Informs only — nothing here ever gated a departure from sailing.",
  "prior_visits.csv":
    "Visit history carried in from the shop's previous system when its divers were imported — one row per booking that system held, never a DiveDay trip. status_label and amount_label are that system's own words and figures, kept verbatim and never normalized: a row can say cancelled or no-show, so these are booking records, not evidence of a dive. amount_label is display text with no currency column and was never summed into any DiveDay total. Nothing here was ever read by boarding, capacity, or reporting.",
  "imported_payment_history.csv":
    "Unverified payment, refund, and receipt source history carried from a previous system. These rows are not DiveDay orders, booking payments, live Stripe charges, or reusable payment credentials. amount_cents and currency exist only where the source amount was clearly parsed; a matching-currency payment/refund can be included in a clearly labelled report aggregate, but every row remains source evidence that staff must review. receipt_document_url points to a re-stored document when one was available.",
  "internal_notes.csv":
    "The shop's own private notes about its divers and their bookings — what the front desk wrote down so the next person on the counter would know. Never shown to a diver, and never part of any gate: a note is context, not evidence, so nothing in readiness, boarding, or medical clearance has ever read one. They are here because they are the shop's own words about its own customers, and a shop that leaves without them arrives somewhere else having forgotten everything it knew.",
  "activity_events.csv":
    "The staff activity trail: who did what, to which trip or booking or about which diver, and when. Append-only and never edited, so reading it in order reconstructs how a departure got to the state the other files describe. The messages are DiveDay's own wording rather than something staff typed, and they are written in English regardless of what language the shop reads — a record of an action, not copy.",
  "notification_deliveries.csv":
    'Whether each diver actually got each message the shop sent them — booking confirmation, waiver request, trip reminder, conditions hold, recap — with what the email or SMS provider said came of it and, when something went wrong, why. One row per booking and message kind: a resend overwrites in place rather than appending, so this is the latest outcome per message, not a send history. It is here because "did this diver ever get their waiver request" is a question a shop has to be able to answer about its own past, sometimes years later, and no other file in this bundle can. The retry queue and rate-limit state behind it are not included — those are plumbing.',
  "orders.csv":
    "Shop-issued orders with their Stripe invoice references — reconcilable against the shop's own Stripe account, which stays the shop's.",
  "order_line_items.csv": "The lines on each order (trip fees, courses, rentals, nitrox, retail).",
  "tips.csv":
    "Crew tips a diver started from their post-trip recap page, with their Stripe references — reconcilable against the shop's own Stripe account, which stays the shop's. Only status 'paid' is real revenue; pending and expired rows are unfinished attempts.",
  "dive_sites.csv":
    "The shop's dive-site library, archived sites included. Image links stay readable while the DiveDay account is active.",
  "dive_site_creatures.csv":
    "Which species each dive site's field guide shows, in order. catalog_slug is the record; the name, category, description and tip are DiveDay's own words, rendered here in your shop's default language.",
  "dive_site_moments.csv":
    "Staff-moderated diver moments attached to dive sites, published and unpublished.",
  "recap_photos.csv":
    "Photos divers attached to their post-trip recap pages, by booking and trip. Image links stay readable while the DiveDay account is active.",
  "trip_recap_photos.csv":
    "Staff-only close-out photos by departure, including the staff member who uploaded each one. They were never automatically shared with divers; sharing needs its own audience decision.",
  "trip_reviews.csv":
    "Ratings and words from divers who provably dived — each row was written through that booking's own post-trip recap link, so there are no unverified reviews here. Only is_published rows were shown publicly and only those were counted in the shop's displayed average; a review carrying a comment stayed unpublished until staff released it, while a bare rating published on arrival. One row per booking: a diver revising their review updated it in place.",
  "review_moderation_events.csv":
    "Every time staff published or hid a review, and for a hide, the reason they stated. A review can appear more than once: a shop that hid one and later put it back has both rows. reason is a code (abusive, names_a_person, wrong_subject, spam, other) and reason_note carries the shop's own words, which 'other' requires. Kept because it is the shop's own record of decisions it made about its public page — and because DiveDay used it to decide whether to publish the shop's average as a machine-readable rating.",
  "dive_packages.csv":
    "The prepaid dive packages this shop sells, as configured: how many dives each one buys, its price, whether it covers every departure or fun dives only, and its inclusive end date (blank means it never lapses). A package with a deleted_at is one the shop stopped selling — the dives already bought against it are still in dive_package_entitlements.csv and still good.",
  "dive_package_entitlements.csv":
    'One row per dive a diver bought and has not yet taken, or took. A row with no booking_id is an unused dive the diver is still owed; one with a booking_id and consumed_at was spent on that seat. This is the file to read to answer "what does this shop still owe its divers" — the money was taken at purchase, on the order named in order_id.',
  "shop_promo_codes.csv":
    "Shop-wide discount codes as configured, with their validity window, scope, and redemption cap. status 'active' was live; 'disabled' was switched off by staff and 'failed' never minted at Stripe at all. The redemption history is in shop_promo_redemptions.csv.",
  "shop_promo_redemptions.csv":
    "Every time one of those codes was actually spent: which code, which checkout attempt in booking_checkouts.csv, and what the shop took on that sale. Read amount_charged_cents as \"what this code was worth on this sale\" — Stripe's own settled total where Stripe reported one, and otherwise the asking price less this code's own discount. It is not a full order total: another discount stacked by Stripe, or a later refund, is not reflected here, so reconcile against orders.csv for revenue and use this file for how a code performed.",
  "courses.csv": "The course catalog with public-page content, hidden courses included.",
  "course_inquiries.csv":
    "Course leads: someone asked about a course through the shop's public page and left their details, their experience level, and when they were hoping to go. Not a booking and never a seat — a lead that never converted still has a row here, which is the point of taking it with you. person_id is filled in only where the address exactly matched a diver the shop already had at the time; a lead with no match stays an unlinked name and email, and was never back-filled.",
} as const;

export type ExportFileName = keyof typeof EXPORT_FILE_NOTES;

/**
 * Would this diver-authored string execute as a formula in Excel/LibreOffice?
 * `=`, `@`, tab, and CR always count. A leading `+` or `-` counts only when
 * followed by anything beyond digits and phone punctuation: `+1 305 555 0100`
 * is an E.164 phone number a destination system must receive intact — the one
 * thing a purely numeric cell can do in a spreadsheet is display as a number,
 * never reach a DDE/command payload, which needs letters or pipes.
 */
function opensAsFormula(text: string): boolean {
  if (/^[=@\t\r]/.test(text)) return true;
  return /^[+-]/.test(text) && !/^[+-][\d\s()./-]*$/.test(text);
}

/** Serialize one cell: empty for null/undefined, ISO for dates, RFC-4180 quoting. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  let text = typeof value === "string" ? value : String(value);
  // Neutralize spreadsheet formulas (CSV injection): a *string* cell that
  // opens as a formula executes when the export opens in Excel or LibreOffice
  // — RFC-4180 quoting does not prevent it — and names on a public booking
  // are diver-controlled. The apostrophe is the spreadsheet "treat as text"
  // marker; the bundle README documents it. Numbers and phone-shaped strings
  // stay untouched so amounts and E.164 numbers import intact.
  if (typeof value === "string" && opensAsFormula(text)) text = `'${text}`;
  // Quote only when needed: embedded quote, comma, or line break.
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

/** Serialize a table to RFC-4180 CSV (CRLF line endings, header row first). */
export function buildCsv(header: string[], rows: CsvValue[][]): string {
  for (const row of rows) {
    if (row.length !== header.length) {
      throw new Error(`csv row has ${row.length} cells; header has ${header.length}`);
    }
  }
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** "2026-07-22" in the shop's own timezone — the date a human would say it is. */
export function exportDateStamp(now: Date, timezone: string): string {
  return cachedFormatter("dt", Intl.DateTimeFormat, "en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(now);
}

export function exportFileName(shopSlug: string, now: Date, timezone: string): string {
  return `diveday-export-${shopSlug}-${exportDateStamp(now, timezone)}.zip`;
}

/**
 * `<first 8 hex chars of the person id>` — enough to make two divers exported
 * from the same shop on the same day land in two different files, without
 * putting a diver's full id (or their name, which a filename survives outside
 * any access control DiveDay enforces) into a downloaded file's name.
 */
function personFileFragment(personId: string): string {
  return personId.replace(/-/g, "").slice(0, 8);
}

export function diverExportFileName(
  shopSlug: string,
  personId: string,
  now: Date,
  timezone: string,
): string {
  return `diveday-diver-export-${shopSlug}-${personFileFragment(personId)}-${exportDateStamp(now, timezone)}.zip`;
}

/**
 * Record families deliberately absent from the bundle, stated in the README —
 * an export that is quiet about its gaps is how migrations lose data.
 */
const NOT_INCLUDED = [
  "Offline manifest snapshots (device-side copies of the live records exported here).",
  "Notification retry queues, per-attempt logs, and provider rate-limit state — plumbing behind notification_deliveries.csv, which carries the outcome that actually happened.",
  "Stripe account linkage — the Stripe account itself already belongs to the shop, and an account id means nothing anywhere else.",
  "The day close-out trail and the buddy-team pairing trail — in-product operational records of a ritual and of how teams were formed; the teams that stood are in buddy_pairs.csv.",
  "Weather-cancellation cascade state (who had been messaged, who had been rebooked) — the cancellation itself is on the trip in trips.csv.",
  "Per-device push-notification credentials, which cannot be transferred between systems and are a credential besides.",
  "Internal reconciliation ledgers DiveDay keeps about its own work: payment-operation intents, the Stripe webhook-delivery ledger, media-deletion attempts, and the outstanding data-deletion requests an erasure still owes at Stripe. Each is a pointer into DiveDay's own infrastructure plus the state of work being done there — the last one is deliberate rather than incidental, because an obligation carried into a system that cannot discharge it would read as done.",
  "DiveDay's shared dive-site catalog templates (the shop's own copies export in dive_sites.csv).",
  "A pasted image URL a CSV references that was never stored through DiveDay (an external link, or a bundled template asset) — only files DiveDay's own storage actually holds can be bundled as bytes.",
  "Login accounts, password hashes, email-verification/password-reset tokens, and staff calendar-subscription links — credentials are never exported.",
  "The reading language DiveDay observed for a diver from their own booking or waiver link — something we inferred about them, not a record you entered, and not one a CSV could vouch for on the way back in. Every diver's language is re-learned the first time they use one of their own links again; until then their mail follows your shop's language, exactly as it did before.",
];

export type ExportBundleInput = {
  shopName: string;
  shopSlug: string;
  timezone: string;
  tables: ExportTable[];
  /** Every DiveDay-stored image or import-document URL referenced in `tables`, deduped. */
  photoUrls: string[];
};

/** {@link ExportBundleInput}'s per-diver twin — see `buildDiverExportBundle`. */
export type DiverExportBundleInput = {
  shopName: string;
  shopSlug: string;
  timezone: string;
  diverName: string;
  tables: ExportTable[];
  photoUrls: string[];
};

/** Assemble the bundle: one CSV per table plus a README.txt manifest. */
export function buildExportBundle(input: ExportBundleInput, now: Date): ExportFile[] {
  const files = input.tables.map((table) => ({
    name: table.file,
    content: buildCsv(table.header, table.rows),
  }));

  const readme = [
    `DiveDay full-shop export`,
    `Shop: ${input.shopName} (${input.shopSlug})`,
    `Exported at: ${now.toISOString()} (dates below are in ${input.timezone})`,
    ``,
    `Every file is UTF-8 CSV (RFC 4180). Timestamps are ISO 8601 in UTC.`,
    `Money columns are minor units (cents). Rows with a deleted_at value are`,
    `soft-archived history — kept so nothing is lost in a migration.`,
    `Text that would open as a spreadsheet formula (leading =, @, or a +/-`,
    `followed by anything beyond digits and phone punctuation) is prefixed`,
    `with an apostrophe so it always reads as text; strip it when importing`,
    `programmatically. Phone numbers like +1 305 555 0100 are never altered.`,
    ``,
    `Files:`,
    ...input.tables.map(
      (table) =>
        `- ${table.file} (${table.rows.length} ${table.rows.length === 1 ? "row" : "rows"}): ${table.note}`,
    ),
    ``,
    `Photos and imported documents: any image_url / *_url column above whose link is`,
    `DiveDay's own storage has a byte-identical copy under photos/, at the same`,
    `path as the URL — for example an image_url of`,
    `https://diveday-media.s3.us-east-1.amazonaws.com/recap/ab12-photo.jpg is also at`,
    `photos/recap/ab12-photo.jpg in this bundle. That copy survives after this`,
    `account closes; the URL itself does not. A link the CSV carries that was`,
    `never stored through DiveDay (an external link, or a bundled template`,
    `asset) has no file here — see "Not included" below.`,
    ``,
    `Not included in this bundle:`,
    ...NOT_INCLUDED.map((line) => `- ${line}`),
    ``,
    `Your data is yours. This export is available to every shop on every plan.`,
  ].join("\n");

  return [{ name: "README.txt", content: `${readme}\n` }, ...files];
}

/**
 * Every record family named in `loadDiverExportBundleInput` (src/db/export.ts)
 * that is deliberately absent from a diver's own bundle, and why — the same
 * discipline `NOT_INCLUDED` above holds the shop bundle to, so a diver reading
 * their own README can tell "not applicable" from "silently dropped".
 */
const DIVER_NOT_INCLUDED = [
  "Medical answers on any signed waiver — withheld pending a legal review of what a subject-access request should return; every other field of the signature is included.",
  "Internal staff notes about this diver. They were never shown to a diver and never gated anything; the shop's own words about its own customer stay the shop's.",
  "The staff activity trail. Its entries are English sentences generated at write time that routinely name a different diver — safely removing just that risk needs the same name-matching sweep the erasure path uses, and is a follow-up rather than reinvented here.",
  "Payment checkout attempts (as opposed to their outcome, which is in booking_payment_events.csv). One checkout can cover an entire party sharing a single Stripe session, so its email and totals may not be this diver's alone.",
  "Everything the shop-wide export excludes for the same reasons stated there: notification retry queues and provider logs, Stripe account linkage, the day close-out and buddy-pairing trails, weather-cancellation cascade state, push-notification credentials, DiveDay's own internal reconciliation ledgers, login accounts and credentials, and the reading language DiveDay inferred for this diver rather than one they stated.",
];

/** Assemble one diver's record bundle: one CSV per table plus a README.txt. */
export function buildDiverExportBundle(input: DiverExportBundleInput, now: Date): ExportFile[] {
  const files = input.tables.map((table) => ({
    name: table.file,
    content: buildCsv(table.header, table.rows),
  }));

  const readme = [
    `DiveDay diver record export`,
    `Shop: ${input.shopName} (${input.shopSlug})`,
    `Diver: ${input.diverName}`,
    `Exported at: ${now.toISOString()} (dates below are in ${input.timezone})`,
    ``,
    `Every file is UTF-8 CSV (RFC 4180). Timestamps are ISO 8601 in UTC.`,
    `Money columns are minor units (cents). Rows with a deleted_at value are`,
    `soft-archived history — kept so nothing is lost.`,
    `Text that would open as a spreadsheet formula (leading =, @, or a +/-`,
    `followed by anything beyond digits and phone punctuation) is prefixed`,
    `with an apostrophe so it always reads as text; strip it when importing`,
    `programmatically. Phone numbers like +1 305 555 0100 are never altered.`,
    ``,
    `This is everything this shop holds about this one diver — not the`,
    `whole shop's records, and never another diver's name or details.`,
    ``,
    `Files:`,
    ...input.tables.map(
      (table) =>
        `- ${table.file} (${table.rows.length} ${table.rows.length === 1 ? "row" : "rows"}): ${table.note}`,
    ),
    ``,
    `Photos and imported documents: any image_url / *_url column above whose link is`,
    `DiveDay's own storage has a byte-identical copy under photos/, at the same`,
    `path as the URL. A link that was never stored through DiveDay (an external`,
    `link, or a bundled template asset) has no file here.`,
    ``,
    `Not included in this bundle:`,
    ...DIVER_NOT_INCLUDED.map((line) => `- ${line}`),
  ].join("\n");

  return [{ name: "README.txt", content: `${readme}\n` }, ...files];
}

/** Zip the bundle (fflate deflate); content is small enough for sync work. */
export function zipExportBundle(files: ExportFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.name] = typeof file.content === "string" ? strToU8(file.content) : file.content;
  }
  return zipSync(entries);
}

export type ExportPhoto = { path: string; bytes: Uint8Array };

const PHOTO_FETCH_TIMEOUT_MS = 10_000;

/**
 * Turn a managed-blob URL into its in-bundle path: the same pathname the URL
 * already has, under `photos/`, so a reader can always find a CSV's
 * image_url at `photos${new URL(url).pathname}` without a lookup table.
 */
export function exportPhotoPath(url: string): string {
  return `photos${new URL(url).pathname}`;
}

/**
 * Best-effort fetch of every photo this shop's own blob storage holds, so the
 * bundle carries real image files rather than links that stop resolving once
 * the account closes (ADR 20260724-export-bundled-photos). Only
 * `isManagedStorageUrl` URLs are ever fetched — never an external or
 * staff-pasted link the CSVs might also carry — so this never makes a live
 * request to a host outside DiveDay's own storage. One photo failing to fetch
 * never fails the export; it is simply absent from `photos/`.
 */
export async function fetchExportPhotos(
  urls: readonly string[],
  fetchImpl: typeof fetch = fetch,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ExportPhoto[]> {
  // Arrow rather than a bare reference: `filter` passes the index as the
  // second argument, which would land in the predicate's `env` parameter.
  const unique = [...new Set(urls)].filter((url) => isManagedStorageUrl(url, env)).sort();
  const results = await Promise.all(
    unique.map(async (url): Promise<ExportPhoto | null> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PHOTO_FETCH_TIMEOUT_MS);
      try {
        const response = await fetchImpl(url, { signal: controller.signal });
        if (!response.ok) return null;
        const buffer = await response.arrayBuffer();
        return { path: exportPhotoPath(url), bytes: new Uint8Array(buffer) };
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }),
  );
  return results.filter((photo): photo is ExportPhoto => photo !== null);
}
