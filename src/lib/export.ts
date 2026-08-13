/**
 * Full-shop export bundle: RFC-4180 CSV serialization and ZIP assembly
 * (ADR 20260722-full-shop-export). Framework-free — the data arrives as plain
 * tables from src/db/export.ts and leaves as bytes the route can stream. The
 * CSV column sets written here are the documented contract the planned
 * importer, scheduled backups, and read API reuse; change them deliberately.
 */

import { strToU8, zipSync } from "fflate";
import { cachedFormatter } from "./intl-cache";
import { isManagedBlobUrl } from "./storage";

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
  "contacts.csv":
    "One flat row per person, shaped for another system's import wizard: names pre-split, the best certification card (current before expired, verified before pending, expiry included so the destination can enforce it), Nitrox status, rental sizes, and the most recent live signed waiver (accepted/date/source, medical_review holds excluded on purpose). The normalized files stay authoritative — this file exists so leaving never means hand-merging CSVs. Certifications imported from it should land unverified in the destination until its staff re-check the card; a waiver_accepted row should land trusted-and-marked-imported the same way this shop's own importer treats one.",
  "people.csv": "Everyone the shop knows — divers and staff — with their roles.",
  "certifications.csv": "Certification-ladder cards with their verification status.",
  "specialty_certifications.csv":
    "Specialty cards (deep, wreck, night, drysuit) with verification status.",
  "nitrox_certifications.csv": "Nitrox (EANx) cards with verification status.",
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
  "bookings.csv":
    "Every booking with its trip, diver, and payment state. wants_nitrox is a request, never a fill authorization — honor it only against a verified Nitrox card, checked at fill time.",
  "waitlist_entries.csv":
    "Divers in line for full trips. A wait-list entry never consumed a seat and never appears on a manifest.",
  "last_minute_list.csv":
    "Divers who opted in, shop-wide, to hear about last-minute deals, with the date range they said they're around. Distinct from waitlist_entries.csv: this is a general availability signal, not interest in one specific full trip.",
  "trip_last_minute_promos.csv":
    "Discount blasts sent on under-capacity trips: the discount percent, the code, when it expires, and how many divers it went to. Stripe coupon/promotion-code ids are excluded — provider linkage, useless outside this Stripe account.",
  "booking_payment_events.csv":
    "Every recorded change to a booking's payment state, oldest first — what it moved to, what it moved from, the amount and currency at that moment, and which operation caused it (a checkout settling, a staff mark, a refund). bookings.csv carries only where each booking's money stands *now*, and a refund overwrites that in place, so this is the file that says how it got there. It records transitions, not writes: a webhook redelivered twice appends nothing the second time, and a refused write appends nothing at all — so a row here always means the state genuinely changed.",
  "booking_checkouts.csv":
    "Every pay-at-booking checkout attempt this shop started, settled or not — the amount asked, the discount applied and where it came from, and how the attempt ended (completed, expired, or a bank payment that failed after the fact). bookings.csv and orders.csv say what the shop was *paid*; this file is what it *asked for*, including the asks nobody finished. Read it that way: only a row with a completed_at is money, and an abandoned row is a diver who got as far as the payment page. The Stripe account id is excluded (provider linkage, useless outside this Stripe account) and so is the checkout link, which stopped working when the session expired.",
  "booking_checkout_bookings.csv":
    "Which seats each checkout was paying for, one row per seat, with the rental gear charged on that seat. A checkout covers a whole party, so a single attempt in booking_checkouts.csv can carry several rows here — and the per-seat gear figure lives nowhere else, since the checkout total has it already folded in.",
  "roll_call_events.csv":
    "The boarding and roll-call ledger — every head-count event, with who recorded it. Read it append-only and in checkpoint order (departure, then after each dive): within one checkpoint the newest event per booking wins, and a 'cleared' event erases that checkpoint's result. Then carry forward: an explicit 'not_boarded' fills every later checkpoint that has no explicit result of its own until an explicit 'boarded' breaks the chain — off the boat stays off the boat; a checkpoint with no result and nothing carried means awaiting. Never count 'boarded' rows naively; corrections would inflate the head count.",
  "roll_call_crew_attestations.csv":
    "A retired record, kept because the statements in it were made about departures that sailed: how many crew a named staff member counted aboard at a checkpoint, out of how many the trip had assigned at that moment. DiveDay no longer asks for this count and writes no new rows — roll_call_crew_events.csv, which names each crew member, is the whole crew half of a head count now. Newest row per trip and checkpoint wins; earlier rows are re-counts kept as evidence. crew_assigned is what the assignment list said when the count was taken, so it can differ from trip_assignments.csv today.",
  "roll_call_crew_events.csv":
    "The per-person half of each crew head count: one staff member recorded one assigned crew member aboard, not aboard, or cleared, at one checkpoint. Read it exactly like roll_call_events.csv — append-only, newest row per person and checkpoint wins, a 'cleared' row erases that checkpoint's result, and a 'not_boarded' recorded at departure carries forward until an explicit 'boarded' breaks the chain. A checkpoint is not treated as closed while any assigned crew member has no result here, and a trip with nobody on its crew list does not close either — an empty crew list is a scheduling gap, not evidence that nobody else was aboard.",
  "buddy_pairs.csv":
    'Buddy teams staff recorded on each departure — one row per member, all members of a team sharing a pair_id, with who made the call and when. A team has two or more members, and member_kind says whether a row is a seated diver (booking_id set, person_id is the diver) or a crew member (crew_person_id set, person_id is that crew member and booking_id is empty): a divemaster leading a group holds no booking, and one crew member may lead several teams on one departure, so crew ids repeat across pair_ids by design. A diver appears at most once per departure. Teams are display and attention state on the roll call ("someone is back aboard and someone is not"), never a gate: they play no part in readiness, boarding, or the head count in roll_call_events.csv. Dissolving a team deletes its rows, so this file holds the teams standing at export time — the history of how they got that way is DiveDay\'s own operational record and is not exported.',
  "waiver_templates.csv":
    "Every waiver template version, full text included — signed records reference these.",
  "waiver_records.csv":
    "Issued and signed waiver evidence; the signed text is the referenced template version. Only status 'completed' satisfies the waiver gate, and only while current (within a year of signing, against the shop's current release). 'medical_review' means a physician's sign-off is still outstanding — that diver is blocked from boarding, not merely flagged, even though the signature fields are filled in. signature_method 'imported' means the record was trusted from a prior shop's own acceptance during a contact import, never reviewed by this shop — imported_from_label and the import_source_*_url columns carry that record's provenance; only 'imported' rows ever populate them. integrity_hash and integrity_version carry the independent signed-metadata audit seal when present; unsealed legacy rows remain explicitly identifiable.",
  "rental_fit.csv": "Each diver's rental kit and sizes.",
  "prior_visits.csv":
    "Visit history carried in from the shop's previous system when its divers were imported — one row per booking that system held, never a DiveDay trip. status_label and amount_label are that system's own words and figures, kept verbatim and never normalized: a row can say cancelled or no-show, so these are booking records, not evidence of a dive. amount_label is display text with no currency column and was never summed into any DiveDay total. Nothing here was ever read by boarding, capacity, or reporting.",
  "internal_notes.csv":
    "The shop's own private notes about its divers and their bookings — what the front desk wrote down so the next person on the counter would know. Never shown to a diver, and never part of any gate: a note is context, not evidence, so nothing in readiness, boarding, or medical clearance has ever read one. They are here because they are the shop's own words about its own customers, and a shop that leaves without them arrives somewhere else having forgotten everything it knew.",
  "activity_events.csv":
    "The staff activity trail: who did what, to which trip or booking, and when. Append-only and never edited, so reading it in order reconstructs how a departure got to the state the other files describe. The messages are DiveDay's own wording rather than something staff typed, and they are written in English regardless of what language the shop reads — a record of an action, not copy.",
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
  "trip_reviews.csv":
    "Ratings and words from divers who provably dived — each row was written through that booking's own post-trip recap link, so there are no unverified reviews here. Only is_published rows were shown publicly and only those were counted in the shop's displayed average; a review carrying a comment stayed unpublished until staff released it, while a bare rating published on arrival. One row per booking: a diver revising their review updated it in place.",
  "review_moderation_events.csv":
    "Every time staff published or hid a review, and for a hide, the reason they stated. A review can appear more than once: a shop that hid one and later put it back has both rows. reason is a code (abusive, names_a_person, wrong_subject, spam, other) and reason_note carries the shop's own words, which 'other' requires. Kept because it is the shop's own record of decisions it made about its public page — and because DiveDay used it to decide whether to publish the shop's average as a machine-readable rating.",
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
  /** Every DiveDay-stored image URL referenced anywhere in `tables`, deduped. */
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
    `Photos: any image_url / *_url column above whose link is`,
    `DiveDay's own storage has a byte-identical copy under photos/, at the same`,
    `path as the URL — for example an image_url of`,
    `https://xyz.public.blob.vercel-storage.com/recap/ab12-photo.jpg is also at`,
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
 * `isManagedBlobUrl` URLs are ever fetched — never an external or
 * staff-pasted link the CSVs might also carry — so this never makes a live
 * request to a host outside DiveDay's own storage. One photo failing to fetch
 * never fails the export; it is simply absent from `photos/`.
 */
export async function fetchExportPhotos(
  urls: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<ExportPhoto[]> {
  const unique = [...new Set(urls)].filter(isManagedBlobUrl).sort();
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
