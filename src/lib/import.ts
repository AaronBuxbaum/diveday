/**
 * Contact CSV importer — the intake side of the portability wedge
 * (docs/product/competitive-strategy.md; the export ADR
 * 20260722-full-shop-export names this file's schema as the contract it
 * reuses). Framework-free and DB-free on purpose: the same preparation runs in
 * the browser for an instant preview and again on the server before a single
 * row is written, so the safety rules below are enforced in one place and
 * cannot be talked out of by the client.
 *
 * The rules are honesty, made mechanical:
 *   - An imported certification lands **verified and flagged imported** (ADR
 *     20260724-import-verified-cards): DiveDay assumes a card already in the
 *     shop's system was checked there, trusts it, and surfaces a one-tap staff
 *     confirm instead of re-capturing it as an unverified claim. The imported
 *     marker stays forever so it is never mistaken for a card this shop carded
 *     on sight; card expiry and fill-time re-checks still apply.
 *   - We never fabricate a card number. No number on the row → no card, and we
 *     say so — a made-up identifier would collide, and a card with no evidence
 *     is worse than no card.
 *   - A row that says the diver already accepted a waiver at the prior shop is
 *     trusted here too (ADR 20260724-import-waiver-acceptance, product-owner
 *     decision recorded in docs/product/human-decisions.md) — including its
 *     medical clearance. This is a deliberate reversal of the original
 *     fail-closed rule: the resulting record satisfies the waiver gate exactly
 *     like any other completed record, but is marked `imported` everywhere it
 *     shows so it is never confused with a release DiveDay itself watched a
 *     diver sign or a staff-witnessed paper copy.
 *   - Structured medical *answers* (individual questionnaire responses) are
 *     never imported and never fabricated — there is no source shape that
 *     maps onto this shop's own questionnaire. Only the accept/no-review-needed
 *     outcome is trusted, per the row above.
 *   - A nitrox card imports verified and flagged imported like any level card,
 *     and only against a real card number. Boarding clears immediately, but the
 *     actual enriched-air *fill* — the highest-consequence gate, and one no card
 *     expiry backstops — waits for a staff confirm that carries an explicit card
 *     sighting (`reviewedAt`; H-24); an imported-but-unconfirmed card gives plain
 *     air (src/db/nitrox.ts). A card entered by hand is unaffected.
 *   - A specialty card (deep, wreck, night, drysuit) imports the same way, and
 *     is the strictest of the three (ADR 20260725-import-specialty-cards):
 *     verified and flagged, but the specialty *gate* stays shut until a staffer
 *     confirms they have seen the card, because a specialty authorizes a materially
 *     riskier dive (deep gates depth past 18 m). An agency number identifies the
 *     diver, not the card, so a cell naming "Deep, Wreck" becomes both cards under
 *     that one number — `specialty_certifications` is keyed on the specialty too.
 *   - A technical or overhead-environment rating (Advanced Nitrox, Trimix, CCR,
 *     cave, deco procedures…) is **never** bent onto the recreational ladder. It
 *     imports as nothing and says so: a ladder card clears its gate on `status`
 *     alone, so reading "Advanced Nitrox" as Advanced Open Water — which the bare
 *     `/advanced/` rule used to do — hands out a clearance nobody granted.
 *   - A card's expiry comes across when the row carries a real calendar date,
 *     including one already in the past — an expired card on file is a fact
 *     readiness must see, and the alternative is a migrated card that looks
 *     valid forever.
 *   - A row that records a past booking becomes a **prior visit** (ADR
 *     20260725-import-prior-visits): one inert history row per booking the old
 *     system held, never a `trips`/`bookings` row. It needs a readable date or
 *     it is declined — a visit with no date can't be placed on a timeline, and
 *     no date is invented. The source's status word and money text are carried
 *     verbatim and un-mapped, because a booking is not a dive and the amount is
 *     display-only. Nothing here feeds a gate or capacity.
 *   - A source payment/refund or receipt becomes separate, **unverified
 *     imported payment history** (ADR 20260816-imported-payment-history-is-evidence).
 *     It never creates an order, a Stripe charge, a booking payment, or a
 *     payment credential. Only a source amount with a clear supported currency
 *     can contribute to the import-labelled financial aggregate; the raw label
 *     and all ambiguous rows remain visible in Orders without changing totals.
 *
 * The published honesty table (IMPORT_HONESTY_TABLE) states the same scope in
 * the shop owner's language; keep the two in step.
 */

/**
 * Explicit bounds (CR-016) — CSV parsing previously relied only on the
 * accidental byte ceiling of the framework's Server Action body limit
 * (see docs/architecture/decisions/20260723-upload-transport-limit.md), with
 * no cap on rows, columns, or a single cell's length. `prepareContactImport`
 * enforces these before parsing/mapping so an oversized file fails fast with
 * a friendly reason instead of racing the transport limit or the DB
 * transaction below. One shop's real roster (a few thousand divers) fits
 * comfortably under these; a bigger migration is a deliberately out-of-scope
 * "split the file" case, not a reason to remove the atomic single-transaction
 * commit in src/db/import.ts.
 */
import { type CertificationAgency, certificationAgency, type DiveSpecialty } from "@/db/schema";
import { isPlausibleDateOfBirth } from "./age";
import { type CalendarDate, isValidCalendarDate } from "./calendar-date";
import { currencyMinorUnits, isShopCurrency } from "./money";

/**
 * Sized for the largest file the switching guides actually ask an owner to
 * export. That used to be a contact list — a few thousand divers, one row each.
 * With prior visits (ADR 20260725-import-prior-visits) it is a **bookings**
 * export: one row per booking per diver, so a ten-year-old shop's file is an
 * order of magnitude larger than its roster. The old 2 MB / 5,000-row ceiling
 * rejected exactly the file the new columns exist to read.
 *
 * Still well under the 16 MB Server Actions body limit set in `next.config.ts`
 * (ADR 20260723-upload-transport-limit), which remains the real transport
 * ceiling — these are the app's own bounds, and they stay explicit rather than
 * inheriting whatever the framework happens to allow.
 */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;
/** A bookings export is column-heavy (per-item, per-fee, per-tax breakdowns). */
export const MAX_IMPORT_COLUMNS = 64;
export const MAX_IMPORT_CELL_LENGTH = 2_000;

/**
 * Certification agencies we can name; anything else lands as "other".
 *
 * *Is* the pg enum rather than a copy that mirrors it, so an agency added to
 * the database is one an import can immediately recognize — a hand-kept second
 * list is how a shop's honest CMAS card would have kept landing as "other"
 * after the column started accepting it (DOM-L1).
 *
 * Widening this list has **two** ways to go wrong, and only one of them is
 * about cells that already resolved:
 *
 *   - A cell that resolved to agency A must not start resolving to agency B.
 *     Order is what rules that out: `normalizeAgency` takes the first entry the
 *     cell names, the order here is the enum's declaration order, and every
 *     agency added has been appended after the ones already recognized.
 *   - A cell that resolved to **nothing** must not start resolving to an
 *     agency. That is the failure the order argument says nothing about, and it
 *     is the worse one: `other` comes with an `agency_unrecognized` issue, so
 *     the shop is *told*; a wrong agency is silent, and the staffer who cannot
 *     find the card in that agency's portal either refuses a certified diver at
 *     the rail or stops looking cards up at all. `normalizeAgency` matches whole
 *     tokens for exactly this reason — see its own note.
 */
export const IMPORT_AGENCIES = certificationAgency.enumValues;
export type ImportAgency = CertificationAgency;

/** Recreational ladder rungs; mirrors the certification_level pg enum. */
export const IMPORT_LEVELS = [
  "open_water",
  "advanced_open_water",
  "rescue",
  "divemaster",
  "instructor",
] as const;
export type ImportLevel = (typeof IMPORT_LEVELS)[number];

/** Canonical fields the importer understands. Everything else is left in the file, noted. */
export const IMPORT_FIELDS = [
  "first_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "date_of_birth",
  "emergency_contact_name",
  "emergency_contact_phone",
  "dive_insurance",
  "certification_agency",
  "certification_level",
  "certification_number",
  "certification_status",
  "specialty",
  "specialty_certification_number",
  "nitrox_certified",
  "nitrox_certification_number",
  "bcd_size",
  "wetsuit_size",
  "boot_size",
  "fin_size",
  "waiver_accepted",
  "waiver_signed_at",
  "waiver_source_name",
  "waiver_document_url",
  "medical_document_url",
  // Financial history comes before the generic prior-visit columns. Mapping is
  // first-match-wins, so a specific transaction/receipt export gets to claim
  // its own columns before a booking-history fallback sees them. We
  // intentionally do not map card number, CVC, PAN, or payment-method columns.
  "payment_date",
  "payment_status",
  "payment_amount",
  "payment_currency",
  "payment_direction",
  "payment_reference",
  "receipt_reference",
  "receipt_document_url",
  "stripe_reference",
  // Prior-visit columns, last on purpose: their aliases are the most generic in
  // the file ("date", "amount", "description"), and field claiming is
  // first-match-wins in this order, so every specific field gets its pick first.
  "visit_date",
  "visit_title",
  "visit_status",
  "visit_amount",
  "visit_reference",
  "internal_notes",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/**
 * Header aliases the rivals actually emit (DiveShop360 customer/cert exports,
 * DiveAdmin CSVs, Smartwaiver participant CSVs) plus a generic spreadsheet and
 * our own contacts.csv. Headers are normalized (lower-cased, punctuation and
 * whitespace collapsed to single underscores) before lookup, so "First Name",
 * "first-name", and "FIRST_NAME" all resolve here.
 */
const HEADER_ALIASES: Record<ImportField, string[]> = {
  first_name: ["first_name", "first", "firstname", "given_name", "given"],
  last_name: ["last_name", "last", "lastname", "surname", "family_name"],
  full_name: [
    "full_name",
    "name",
    "diver_name",
    "customer_name",
    "member_name",
    "contact_name",
    "participant_name",
  ],
  email: ["email", "email_address", "e_mail", "mail"],
  phone: ["phone", "phone_number", "mobile", "mobile_phone", "cell", "telephone", "phone_1"],
  date_of_birth: ["date_of_birth", "dob", "birth_date", "birthdate", "born", "date_of_birth_dob"],
  emergency_contact_name: [
    "emergency_contact_name",
    "emergency_contact",
    "emergency_name",
    "ice_name",
    "next_of_kin",
  ],
  emergency_contact_phone: [
    "emergency_contact_phone",
    "emergency_phone",
    "ice_phone",
    "next_of_kin_phone",
  ],
  // Free text as the diver carries it ("DAN #12345"). Never a gate — a safety
  // detail the crew wants on hand in an incident (docs/product/glossary.md).
  dive_insurance: [
    "dive_insurance",
    "insurance",
    "dive_accident_insurance",
    "insurance_provider",
    "dan",
    "dan_number",
    "dan_membership",
    "dan_member_number",
  ],
  certification_agency: ["certification_agency", "cert_agency", "agency", "certifying_agency"],
  certification_level: [
    "certification_level",
    "cert_level",
    "level",
    "certification",
    "cert",
    "highest_certification",
    "highest_cert",
    "certification_type",
    "rating",
  ],
  certification_number: [
    "certification_number",
    "cert_number",
    "certification_no",
    "cert_no",
    "diver_number",
    "c_card_number",
    "certification_id",
    "certification_identifier",
    "certification_card_number",
  ],
  certification_status: [
    "certification_status",
    "cert_status",
    "verified",
    "verification_status",
    "status",
  ],
  specialty: [
    "specialty",
    "specialties",
    "specialty_card",
    "specialty_cards",
    "specialty_certification",
    "specialty_certifications",
    "specialty_level",
    "specialty_type",
  ],
  specialty_certification_number: [
    "specialty_certification_number",
    "specialty_number",
    "specialty_cert_number",
    "specialty_card_number",
    "specialty_certification_no",
  ],
  nitrox_certified: ["nitrox_certified", "nitrox", "enriched_air", "eanx", "nitrox_certification"],
  nitrox_certification_number: [
    "nitrox_certification_number",
    "nitrox_number",
    "nitrox_cert_number",
    "eanx_number",
    "nitrox_card_number",
  ],
  bcd_size: ["bcd_size", "bcd"],
  wetsuit_size: ["wetsuit_size", "wetsuit", "suit_size", "exposure_suit"],
  boot_size: ["boot_size", "boot", "boots"],
  fin_size: ["fin_size", "fin", "fins"],
  waiver_accepted: [
    "waiver_accepted",
    "waiver_signed",
    "waiver_on_file",
    "liability_release_signed",
    "release_signed",
    "signed_waiver",
    "waiver_complete",
  ],
  waiver_signed_at: [
    "waiver_signed_at",
    "waiver_date",
    "release_signed_at",
    "waiver_signature_date",
    "signed_date",
    "date_signed",
  ],
  waiver_source_name: [
    "waiver_source_name",
    "waiver_source",
    "prior_shop",
    "previous_shop",
    "source_shop",
    "imported_from",
  ],
  waiver_document_url: [
    "waiver_document_url",
    "waiver_scan_url",
    "waiver_file_url",
    "waiver_pdf_url",
    "signed_waiver_url",
  ],
  medical_document_url: [
    "medical_document_url",
    "medical_history_url",
    "medical_scan_url",
    "medical_form_url",
  ],
  payment_date: [
    "payment_date",
    "paid_at",
    "paid_date",
    "transaction_date",
    "charge_date",
    "refund_date",
    "receipt_date",
  ],
  payment_status: [
    "payment_status",
    "transaction_status",
    "charge_status",
    "refund_status",
    "payment_state",
  ],
  payment_amount: [
    "payment_amount",
    "amount_paid",
    "total_paid",
    "paid_amount",
    "refund_amount",
    "refunded_amount",
    "transaction_amount",
    "charge_amount",
  ],
  payment_currency: ["payment_currency", "transaction_currency", "currency_code", "currency"],
  payment_direction: ["payment_direction", "transaction_type", "transaction_direction"],
  payment_reference: [
    "payment_reference",
    "payment_id",
    "transaction_id",
    "transaction_reference",
    "charge_reference",
  ],
  receipt_reference: ["receipt_reference", "receipt_id", "receipt_number", "receipt_no"],
  receipt_document_url: [
    "receipt_document_url",
    "receipt_url",
    "receipt_pdf_url",
    "receipt_file_url",
    "invoice_pdf_url",
  ],
  stripe_reference: [
    "stripe_reference",
    "stripe_invoice_id",
    "stripe_payment_intent_id",
    "stripe_charge_id",
  ],
  // The bookings/orders exports the switching guides walk an owner through:
  // FareHarbor's Bookings and Contacts reports, Rezdy's Sales/Orders report and
  // Data export, EVE and DiveShop360 sales history, and a shop's own spreadsheet.
  visit_date: [
    "visit_date",
    "trip_date",
    "booking_date",
    "tour_date",
    "activity_date",
    "departure_date",
    "dive_date",
    "date_of_visit",
    "order_date",
    "purchase_date",
    "sale_date",
    "start_date",
    "date",
  ],
  visit_title: [
    "visit_title",
    "trip_name",
    "tour_name",
    "activity_name",
    "product_name",
    "item_name",
    "booking_item",
    "experience",
    "trip",
    "tour",
    "activity",
    "product",
    "item",
    "description",
  ],
  visit_status: [
    "visit_status",
    "booking_status",
    "order_status",
    "reservation_status",
    "trip_status",
    "attendance",
    "attendance_status",
  ],
  visit_amount: [
    "visit_amount",
    "amount",
    "total",
    "total_amount",
    "order_total",
    "booking_total",
    "grand_total",
    "price_paid",
    "paid",
  ],
  visit_reference: [
    "visit_reference",
    "booking_id",
    "booking_reference",
    "booking_number",
    "booking_no",
    "order_id",
    "order_number",
    "order_no",
    "reservation_id",
    "confirmation_number",
    "confirmation_code",
    "reference",
  ],
  internal_notes: [
    "internal_notes",
    "internal_note",
    "notes",
    "note",
    "staff_notes",
    "staff_note",
    "customer_notes",
    "customer_note",
    "admin_notes",
    "admin_note",
    "diver_notes",
    "diver_note",
    "comments",
    "comment",
    "remarks",
    "remark",
    "general_notes",
    "memo",
    "memos",
  ],
};

/**
 * Columns whose presence means "there is medical/liability content here we are
 * deliberately not importing". Matched loosely so a shop is told, once, that
 * their health data stays behind rather than silently dropped.
 */
const MEDICAL_HEADER_PATTERN =
  /medical|health|rstc|allerg|physician|doctor|condition|diagnos|medication|liability|indemnif/i;

/**
 * A source may call a certification identifier a "card number", but that
 * exact generic header is indistinguishable from a PAN. Refuse the ambiguous
 * aliases at the mapping boundary instead of relying on every future alias
 * list to remember the payment-data rule. Explicit certification-prefixed
 * headers (and known `c_card_number`) remain safe certification evidence.
 */
const SENSITIVE_PAYMENT_HEADER_PATTERN =
  /^(?:card_number|card_no|pan|primary_account_number|cvc|cvv|security_code|payment_method(?:_id)?|(?:stripe_)?payment_method_id|payment_token|card_token|card_on_file_token)$/;

// `amount_cents` is a PostgreSQL `integer`. Parsing a value that JavaScript
// can represent but Postgres cannot would turn one hostile source cell into a
// failed import transaction, so leave that amount visible-but-unaggregated.
const POSTGRES_INTEGER_MAX = 2_147_483_647;

/**
 * Row identity for the published scope table below — the stable code each
 * rendering surface maps to its own bundle's words (codes-not-sentences, ADR
 * 20260731-domain-layer-copy-leaks). The diver-facing map is
 * `IMPORT_SCOPE_ROW_KEYS` in src/lib/migration-guides.ts; the staff importer
 * keeps its own staff-bundle map.
 */
export type ImportScopeRowId =
  | "contact"
  | "emergencyContact"
  | "diveInsurance"
  | "rentalSizes"
  | "certificationCard"
  | "specialtyCards"
  | "nitrox"
  | "signedWaivers"
  | "waiverDocuments"
  | "role"
  | "cardOnFile"
  | "pastVisits"
  | "paymentHistory"
  | "serviceHistory"
  | "diverNotes";

/**
 * Published scope table — what the importer takes. The words live in the
 * message bundles (`marketing.guides.shared.scopeTable.*` for the switching
 * pages, `settings.import.scopeTable.*` for the staff importer); this holds
 * the rows, their order, and the honest bucket each one lands in, so every
 * surface renders the same table from this one source.
 *
 * Two honest buckets, no alarm-red middle ground: `included` is what comes
 * across, `stays-behind` is what a contact file simply doesn't carry (and where
 * it lives instead). Cards come across as **verified and flagged imported** —
 * DiveDay assumes a record already in your system was checked there, so it
 * trusts it and offers a one-tap staff confirm rather than re-capturing it as an
 * unverified claim (ADR 20260724-import-verified-cards). Expiry, fill-time
 * re-checks, and the never-reconstruct-medical-answers rule all still hold.
 */
export const IMPORT_HONESTY_TABLE: {
  id: ImportScopeRowId;
  scope: "included" | "stays-behind";
}[] = [
  { id: "contact", scope: "included" },
  { id: "emergencyContact", scope: "included" },
  { id: "diveInsurance", scope: "included" },
  { id: "rentalSizes", scope: "included" },
  { id: "certificationCard", scope: "included" },
  { id: "specialtyCards", scope: "included" },
  { id: "nitrox", scope: "included" },
  { id: "signedWaivers", scope: "included" },
  { id: "waiverDocuments", scope: "included" },
  { id: "role", scope: "included" },
  { id: "cardOnFile", scope: "stays-behind" },
  { id: "pastVisits", scope: "included" },
  { id: "paymentHistory", scope: "included" },
  { id: "serviceHistory", scope: "stays-behind" },
  { id: "diverNotes", scope: "included" },
];

/** Normalize a header for alias lookup: lower, trim, punctuation/space → single "_". */
function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * RFC-4180 CSV reader: quoted fields, embedded commas, CR/LF/CRLF newlines, and
 * doubled quotes ("") as a literal quote. Symmetric with src/lib/export.ts's
 * writer, including stripping the leading apostrophe that writer adds in front
 * of would-be spreadsheet formulas so a value round-trips unchanged.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  // Strip a UTF-8 BOM so the first header does not carry an invisible prefix.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      pushCell();
    } else if (char === "\r") {
      if (input[i + 1] === "\n") i++;
      pushRow();
    } else if (char === "\n") {
      pushRow();
    } else {
      cell += char;
    }
  }
  // Flush the trailing cell/row unless the file ended on a clean newline.
  if (cell !== "" || row.length > 0) pushRow();

  return rows;
}

/** Undo the export's formula-injection guard: a leading "'" before =,+,-,@ is presentational. */
function unguardCell(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

/**
 * Every distinct shape an import-row issue can take. `src/app` looks each
 * code up in the staff bundle (`settings.import.issues.*`) and interpolates
 * `ImportIssue.params` — this file never renders English, only says which
 * situation happened and with what values (same pattern as
 * `ReadinessBlockerCode` in `src/lib/readiness.ts`).
 */
export type ImportIssueCode =
  | "email_invalid"
  | "card_marked_unverified"
  | "specialty_not_gated"
  | "specialty_no_card_number"
  | "specialty_imported_verified"
  | "specialty_imported_pending"
  | "agency_unrecognized"
  | "level_names_specialty"
  | "level_is_technical"
  | "level_not_gated"
  | "level_no_card_number"
  | "cert_imported_verified"
  | "cert_imported_pending"
  | "nitrox_imported"
  | "nitrox_no_card_number"
  | "waiver_date_invalid"
  | "waiver_imported"
  | "dob_invalid"
  | "visit_date_unreadable"
  | "visit_no_reference"
  | "visit_no_date"
  | "payment_history_date_unreadable"
  | "payment_history_no_date"
  | "no_name"
  | "merged_duplicate"
  | "no_email_new_record";

/**
 * The data a translated message needs to fill in its placeholders. Which
 * fields are set depends on `code` — a flat bag (the same shape as
 * `ReadinessBlockerParams`) rather than a one-off type per code, since a
 * field name (`value`, `level`, `specialty`) is reused across the codes that
 * need it.
 */
export type ImportIssueParams = {
  email?: string;
  value?: string;
  parsed?: string;
  status?: string;
  specialty?: string;
  level?: string;
  count?: number;
  row?: number;
};

export type ImportIssue = {
  level: "error" | "warning" | "info";
  code: ImportIssueCode;
  params?: ImportIssueParams;
};

/**
 * A migrated card. `sourceLabel` is the optional prior-shop/system name the row
 * carried (the `waiver_source_name`/`prior_shop` column) — a card imports as
 * `verified` because the prior system already checked it, flagged with this
 * provenance and surfaced for a one-tap staff confirm (ADR
 * 20260724-import-verified-cards).
 */
/**
 * `verified` is the normal import posture — the shop's own system checked this
 * card (ADR 20260724-import-verified-cards). `pending` is the fail-closed
 * fallback for a row that undercuts that premise: the source's own status column
 * says the card was never verified. Those cards import as staff-review claims
 * instead.
 */
export type PreparedCardStatus = "verified" | "pending";

export type PreparedCert = {
  agency: ImportAgency;
  level: ImportLevel;
  identifier: string;
  sourceLabel: string | null;
  status: PreparedCardStatus;
};

/**
 * A migrated specialty card (ADR 20260725-import-specialty-cards). Lands
 * `verified` and flagged imported like a level card, but its *gate* stays shut
 * until a staffer confirms it — see `specialtyBlocker` in src/lib/readiness.ts.
 */
export type PreparedSpecialty = {
  agency: ImportAgency;
  specialty: DiveSpecialty;
  identifier: string;
  sourceLabel: string | null;
  status: PreparedCardStatus;
};
export type PreparedNitrox = {
  agency: ImportAgency;
  identifier: string;
  sourceLabel: string | null;
  status: PreparedCardStatus;
};

/**
 * A trusted claim that the diver already accepted a waiver (and its medical
 * clearance) at a prior shop (ADR 20260724-import-waiver-acceptance).
 * `signedAt` is a validated calendar date when the row gives one; otherwise
 * the commit stamps the import time instead of guessing one. The document
 * URLs are raw, staff-pasted text at this stage — `src/db/import.ts` fetches
 * and re-stores them (or drops them) before anything is written.
 */
export type PreparedWaiver = {
  signedAt: string | null;
  sourceLabel: string | null;
  documentUrl: string | null;
  medicalDocumentUrl: string | null;
};

/**
 * One visit the diver made at the prior shop (ADR 20260725-import-prior-visits).
 * Everything here is carried across as the file wrote it — this is a record of
 * what another system said, not a claim DiveDay is making.
 *
 * `visitedOn` is the only required part: a visit with no date can't be placed on
 * a timeline, and a history you can't order is not history. `statusLabel` and
 * `amountLabel` are verbatim text on purpose (see `prior_visits` in
 * src/db/schema.ts) — a booking is not a dive, and the money is display-only.
 */
export type PreparedVisit = {
  /** Validated calendar date, shop-local. */
  visitedOn: CalendarDate;
  title: string | null;
  /** The source's own status word, un-mapped ("Completed", "Cancelled"). */
  statusLabel: string | null;
  /** Raw money text, never parsed to a number. */
  amountLabel: string | null;
  sourceLabel: string | null;
  sourceReference: string | null;
  /** What a re-import keys on so the same file twice is not two histories. */
  dedupeKey: string;
};

/**
 * A source-system payment, refund, or receipt. Unlike `PreparedVisit`, this
 * can reach the financial aggregate when (and only when) its amount can be
 * read with a supported currency and its source wording gives it a direction.
 * It still remains an unverified source row, never a local order or Stripe
 * payment.
 */
export type PreparedImportedPaymentHistory = {
  /** Validated calendar date, shop-local. */
  occurredOn: CalendarDate;
  /** A conservative source-derived direction, not a DiveDay payment status. */
  direction: "payment" | "refund" | "unknown";
  title: string | null;
  statusLabel: string | null;
  /** Raw money text; may be null for a receipt-only row. */
  amountLabel: string | null;
  /** Raw source currency text, if a dedicated column carried it. */
  currencyLabel: string | null;
  paymentReference: string | null;
  receiptReference: string | null;
  /** Raw URL until the server-side commit re-stores it or drops it. */
  receiptDocumentUrl: string | null;
  sourceLabel: string | null;
  sourceReference: string | null;
  /** A source-exported Stripe object id; never treated as verified on import. */
  stripeReference: string | null;
  dedupeKey: string;
};

/**
 * The narrow directions we can infer from a source's own transaction wording.
 * A cancellation, booking, or price alone is deliberately `unknown`: it may
 * be a reservation that never settled. A negative amount is a refund signal,
 * but we still preserve its source label and unverified marker everywhere.
 */
export function importedPaymentDirection(input: {
  directionLabel: string | null;
  statusLabel: string | null;
  amountLabel: string | null;
}): PreparedImportedPaymentHistory["direction"] {
  const directionLabel = input.directionLabel ?? "";
  // A dedicated direction column is the one place a source can plainly say
  // "payment" without also saying whether it succeeded. Treat that narrow
  // vocabulary as authoritative, but do not let a status such as "payment
  // failed" become money merely because it contains the word payment.
  if (/\b(refund(?:ed)?|reversal|reversed|chargeback|returned)\b/i.test(directionLabel)) {
    return "refund";
  }
  if (/\b(payment|charge(?:d)?|sale|purchase)\b/i.test(directionLabel)) {
    return "payment";
  }
  const labels = [input.statusLabel].filter((value): value is string => Boolean(value));
  if (
    labels.some((value) =>
      /\b(refund(?:ed)?|reversal|reversed|chargeback|returned)\b/i.test(value),
    ) ||
    (input.amountLabel && /^\s*(?:-|\()/.test(input.amountLabel))
  ) {
    return "refund";
  }
  if (labels.some((value) => /\b(paid|complete(?:d)?|captured|settled|succeeded)\b/i.test(value))) {
    return "payment";
  }
  return "unknown";
}

/**
 * Parse a source amount *only* when its currency is unambiguous enough to
 * name. The raw label stays on the record either way. A dollar glyph takes the
 * shop's configured dollar currency, because that is the only context we have
 * for an otherwise ambiguous `$`; a non-dollar shop does not get a guessed
 * currency. Currency codes and the non-dollar symbols below identify themselves
 * and can be stored even when they later remain outside this shop's aggregate.
 */
export function parseImportedMoney(
  amountLabel: string | null,
  currencyLabel: string | null,
  shopCurrency: string,
): { amountCents: number; currency: string } | null {
  if (!amountLabel) return null;
  const explicitCurrency = currencyLabel?.trim().toLowerCase();
  const codeInAmount = amountLabel.match(/\b([a-z]{3})\b/i)?.[1]?.toLowerCase();
  const dollarCurrencies = new Set(["usd", "cad", "aud", "nzd", "sgd"]);
  const prefixedDollar = amountLabel.match(/\b(us|ca|au|nz|sg)\$/i)?.[1]?.toLowerCase();
  const prefixedDollarCurrency =
    prefixedDollar === "us"
      ? "usd"
      : prefixedDollar === "ca"
        ? "cad"
        : prefixedDollar === "au"
          ? "aud"
          : prefixedDollar === "nz"
            ? "nzd"
            : prefixedDollar === "sg"
              ? "sgd"
              : null;
  const labelledCurrency =
    explicitCurrency && isShopCurrency(explicitCurrency) ? explicitCurrency : null;
  const codeCurrency = codeInAmount && isShopCurrency(codeInAmount) ? codeInAmount : null;
  const symbolCurrency = amountLabel.includes("€")
    ? "eur"
    : amountLabel.includes("£")
      ? "gbp"
      : amountLabel.includes("¥")
        ? "jpy"
        : null;
  const namedInAmount = prefixedDollarCurrency ?? codeCurrency ?? symbolCurrency;

  // A dedicated currency field is useful only when it agrees with the source
  // amount's own unambiguous notation. `EUR` beside `US$165` is not a value we
  // can responsibly add to a shop total; keep the raw label on the source row
  // but leave its numeric fields null. A bare dollar remains contextual, but
  // never gets to masquerade as a non-dollar currency.
  if (labelledCurrency && namedInAmount && labelledCurrency !== namedInAmount) return null;
  if (codeCurrency && symbolCurrency && codeCurrency !== symbolCurrency) return null;
  if (
    labelledCurrency &&
    amountLabel.includes("$") &&
    !prefixedDollarCurrency &&
    !dollarCurrencies.has(labelledCurrency)
  ) {
    return null;
  }

  const currency =
    labelledCurrency ??
    namedInAmount ??
    (amountLabel.includes("$") && dollarCurrencies.has(shopCurrency.toLowerCase())
      ? shopCurrency.toLowerCase()
      : null);
  if (!currency || !isShopCurrency(currency)) return null;

  let numeric = amountLabel
    .replace(/\b[a-z]{3}\b/gi, "")
    // A few exports write US$ / CA$ rather than a bare glyph. Currency still
    // comes from the glyph plus shop context above; this just leaves a number
    // for the conservative numeric parser rather than an unexplained "US".
    .replace(/\b(?:us|ca|au|nz|sg)\$/gi, "")
    .replace(/[€£¥$]/g, "")
    .replace(/\s/g, "");
  if (/^\(.*\)$/.test(numeric)) numeric = numeric.slice(1, -1);
  numeric = numeric.replace(/^[+-]/, "");
  if (!/^\d[\d.,]*$/.test(numeric)) return null;

  const fractionDigits = Math.round(Math.log10(currencyMinorUnits(currency)));
  const lastDot = numeric.lastIndexOf(".");
  const lastComma = numeric.lastIndexOf(",");
  const decimalAt =
    lastDot >= 0 && lastComma >= 0
      ? Math.max(lastDot, lastComma)
      : lastDot >= 0 && numeric.length - lastDot - 1 <= fractionDigits
        ? lastDot
        : lastComma >= 0 && numeric.length - lastComma - 1 <= fractionDigits
          ? lastComma
          : -1;
  const whole = (decimalAt >= 0 ? numeric.slice(0, decimalAt) : numeric).replace(/[.,]/g, "");
  const fraction = decimalAt >= 0 ? numeric.slice(decimalAt + 1).replace(/[.,]/g, "") : "";
  if (!whole || fraction.length > fractionDigits) return null;
  const minorText = `${whole}${fraction.padEnd(fractionDigits, "0")}`;
  const amountCents = Number(minorText);
  if (!Number.isSafeInteger(amountCents) || amountCents > POSTGRES_INTEGER_MAX) return null;
  return { amountCents, currency };
}

/** Stable source/content key for a re-imported payment/refund/receipt row. */
export function importedPaymentHistoryDedupeKey(entry: {
  occurredOn: string;
  direction: PreparedImportedPaymentHistory["direction"];
  title: string | null;
  statusLabel: string | null;
  amountLabel: string | null;
  paymentReference: string | null;
  receiptReference: string | null;
  receiptDocumentUrl: string | null;
  sourceReference: string | null;
  stripeReference: string | null;
}): string {
  const normalized = (value: string) => value.trim().toLowerCase();
  if (entry.stripeReference) return `stripe:${normalized(entry.stripeReference)}`;
  if (entry.paymentReference) return `payment:${normalized(entry.paymentReference)}`;
  if (entry.receiptReference) return `receipt:${normalized(entry.receiptReference)}`;
  if (entry.sourceReference) {
    return `source:${normalized(entry.sourceReference)}|${entry.direction}|${normalized(
      entry.amountLabel ?? "",
    )}`;
  }
  return `row:${entry.occurredOn}|${entry.direction}|${normalized(entry.title ?? "")}|${normalized(
    entry.statusLabel ?? "",
  )}|${normalized(entry.amountLabel ?? "")}|${normalized(entry.receiptDocumentUrl ?? "")}`;
}

/**
 * The key that makes re-importing a bookings export idempotent.
 *
 * The prior system's own booking/order id is the honest key when the file
 * carries one — it is stable across re-exports and distinguishes two genuinely
 * separate bookings made the same day. Without one there is nothing to be
 * certain with, so the row's own content becomes the key. That deliberately
 * collapses a diver's two identical same-day bookings (an AM and a PM two-tank
 * booked under one name, same price, no reference) into a single visit, which
 * is the safer of the two wrong answers: a re-import silently doubling a
 * diver's history is a number staff would read and believe, while one merged
 * duplicate is a visit that still happened on a day it still happened.
 * The importer says so in the row's preview note rather than leaving an owner
 * to discover it.
 */
export function priorVisitDedupeKey(visit: {
  visitedOn: string;
  title: string | null;
  amountLabel: string | null;
  sourceReference: string | null;
}): string {
  if (visit.sourceReference) return `ref:${visit.sourceReference.trim().toLowerCase()}`;
  const title = (visit.title ?? "").trim().toLowerCase();
  const amount = (visit.amountLabel ?? "").trim().toLowerCase();
  return `row:${visit.visitedOn}|${title}|${amount}`;
}

export type PreparedRow = {
  /** 1-based row number in the file body (header is not counted). */
  rowNumber: number;
  fullName: string;
  email: string | null;
  phone: string | null;
  /** Only ever a real, plausible calendar date — an unusable one is dropped with a warning. */
  dateOfBirth: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  /** Free text as the diver carries it ("DAN #12345"); never a gate. */
  diveInsurance: string | null;
  cert: PreparedCert | null;
  /**
   * Every specialty this row names — a "Specialties" cell holding "Deep, Wreck"
   * is two cards, not a conflict, because the row's one agency number is the
   * diver's number and the table is keyed on the specialty too
   * (ADR 20260725-import-specialty-cards).
   */
  specialties: PreparedSpecialty[];
  nitrox: PreparedNitrox | null;
  sizes: {
    bcdSize: string | null;
    wetsuitSize: string | null;
    bootSize: string | null;
    finSize: string | null;
  };
  waiver: PreparedWaiver | null;
  /**
   * The visit this row records at the prior shop, when it carried a readable
   * date. A bookings export is one row per booking, so this is the field that
   * makes a `merge` row worth writing even when it holds no new card
   * (ADR 20260725-import-prior-visits).
   */
  visit: PreparedVisit | null;
  /** Unverified source payment/refund/receipt history, separate from live orders. */
  paymentHistory: PreparedImportedPaymentHistory | null;
  /** Internal / staff / diver notes imported into the diver's record. */
  notes: string | null;
  /**
   * `import` writes the person and everything on the row. `merge` is a row whose
   * email already appeared earlier in the same file: it is the *same diver*, so
   * its cards, waiver, and sizes are written onto that diver and its contact
   * fields are left alone (the first row wins). That is the shape of a
   * certification export — one row per card, so a three-card diver appears three
   * times — and treating those rows as duplicate *people* silently discarded
   * every card after the first (`dive-domain-expert` review). `skip` never
   * touches the database.
   */
  action: "import" | "merge" | "skip";
  /** For a `merge` row, the earlier row number this diver came in on. */
  mergedIntoRow: number | null;
  issues: ImportIssue[];
};

export type ColumnMapping = { field: ImportField; header: string; columnIndex: number };

/**
 * Every reason a file can't be prepared at all, before any row is read — the
 * same code/params pattern as `ImportIssueCode`, so a caller resolves it
 * through the staff bundle rather than this file ever building a sentence.
 */
export type ImportFatalCode =
  | "file_too_large"
  | "file_empty"
  | "too_many_columns"
  | "too_many_rows"
  | "cell_too_long_header"
  | "cell_too_long_row"
  | "no_name_column";

export type ImportFatalParams = {
  limitMb?: string;
  count?: number;
  limit?: number;
  row?: number;
};

export type ImportFatal = { code: ImportFatalCode; params?: ImportFatalParams };

export type PreparedImport = {
  mapping: ColumnMapping[];
  unmappedColumns: string[];
  ignoredMedicalColumns: string[];
  rows: PreparedRow[];
  totals: {
    total: number;
    /** Rows that bring in a diver. */
    importable: number;
    /** Rows that add evidence to a diver an earlier row already brought in. */
    merged: number;
    skipped: number;
    withCard: number;
    /** Specialty *cards*, not rows — one row can name several. */
    withSpecialty: number;
    withNitrox: number;
    withWaiver: number;
    /** Prior visits this file records, across importable and merge rows. */
    withVisit: number;
    /** Unverified payment/refund/receipt source rows this file records. */
    withPaymentHistory: number;
    withNotes: number;
  };
  /** Set when the file has no header row, or no recognizable identity column. */
  fatal: ImportFatal | null;
};

/**
 * Read the agency a cell names, or `other` when it names none we know.
 *
 * **Whole tokens, never substrings.** The agency codes are three and four
 * letters, and this column's header aliases include the bare "agency" — which
 * in a rival's *bookings* export routinely means the travel agency or booking
 * source ("Guest", "Guest Booking", "Direct Guest"), and on a European roster
 * can be the national federation that issues the card ("Ligue Francophone", the
 * Belgian CMAS body). Every one of those contains `gue`. A substring match read
 * them as GUE cards: an unrecognized cell became a *wrongly* recognized one,
 * and the `agency_unrecognized` issue that would have told the shop was never
 * raised. The agency is what a staffer acts on — they look the card number up
 * in the issuing agency's own portal
 * (docs/architecture/decisions/20260721-manual-certification.md) — and it prints
 * on the incident-ready export handed to authorities, so a confidently wrong
 * label is worse than an honest `other`.
 *
 * Splitting on non-alphanumerics rather than whitespace keeps the real shapes
 * working ("PADI/SSI", "CMAS***", "SDI #4471"); the Unicode classes keep an
 * accented word whole so it cannot be diced into a token it never contained.
 */
function normalizeAgency(raw: string | undefined): { agency: ImportAgency; recognized: boolean } {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return { agency: "other", recognized: false };
  const tokens = new Set(value.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const direct = IMPORT_AGENCIES.find((agency) => agency !== "other" && tokens.has(agency));
  if (direct) return { agency: direct, recognized: true };
  return { agency: "other", recognized: false };
}

/**
 * Map a free-text certification name to a specialty gate, or null when it names
 * no specialty we gate on. Checked *before* `normalizeLevel` on a shared
 * level/certification column, so "Advanced Wreck Diver" reads as the wreck
 * specialty it is rather than being mistaken for the Advanced Open Water rung
 * by the `/advanced/` rule below.
 */
export function normalizeSpecialty(raw: string | null | undefined): DiveSpecialty | null {
  return specialtiesNamed(raw)[0] ?? null;
}

/**
 * Every specialty a cell names, in a stable order. Scanned across the whole cell
 * rather than a delimiter split, because delimiters are not dependable ("Deep
 * Wreck Diver", "Deep/Wreck", "Deep & Wreck" all name two) — and a multi-value
 * cell is the normal shape of a "Specialties" column, so each one it names
 * becomes its own card. That is safe because the specialties of one diver share
 * one agency number (a PADI number identifies the diver, not the card) and
 * `specialty_certifications` is keyed on the specialty as well as the number.
 *
 * Each pattern requires the dive word, not merely the substring: "Deep Blue
 * Club" is a shop's own label, not a depth clearance, and while an extra card
 * would only ever land gate-held, a card nobody earned should not appear at all.
 */
export function specialtiesNamed(raw: string | null | undefined): DiveSpecialty[] {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return [];
  const found: DiveSpecialty[] = [];
  if (/\bdry.?suit\b/.test(value)) found.push("drysuit");
  if (/\bwreck\b/.test(value)) found.push("wreck");
  if (/\bnight\b/.test(value)) found.push("night");
  // **Known over-match, deliberately left alone.** PADI's **Deep Adventure
  // Dive** is one of the three adventure dives inside Advanced Open Water — not
  // the Deep *specialty*, which is four dives and a separate card — and it
  // lands here as a Deep specialty card. Since the booking-time trip admission
  // gate clears on a specialty card in *any* state, that mis-read now buys a
  // seat on a Deep-gated charter.
  //
  // It is a warning rather than a fix because the dock still holds: an imported
  // specialty card is `verified` but does not clear its gate until a staffer
  // makes the card-sighting attestation (H-23/H-24), so the diver is blocked on
  // the manifest and the staffer is asked to look at the actual card — which is
  // exactly where "Deep Adventure Dive" is caught. Narrowing the pattern here
  // would instead drop real Deep specialty cells whose wording we cannot
  // enumerate. Revisit if admission ever tightens to require a confirmed card.
  if (/\bdeep\b/.test(value)) found.push("deep");
  return found;
}

/**
 * A technical, mixed-gas, or overhead-environment rating. DiveDay's ladder is the
 * recreational one (`certification_level`), and none of these are rungs on it —
 * so they import as nothing, with a reason, rather than being bent onto the
 * nearest-looking rung.
 *
 * This exists because `normalizeLevel`'s bare `/advanced/` rule read **TDI
 * Advanced Nitrox** — a decompression-adjacent gas certification — as *Advanced
 * Open Water*, and a ladder card clears its gate on `status` alone. That silently
 * promoted a technical diver's gas ticket into a verified recreational clearance
 * two rungs above Open Water (`dive-domain-expert` review). Anything here is
 * declined and named in the preview, which is the honest outcome: DiveDay does
 * not model these, so a shop that gates on one enters it by hand.
 */
const TECHNICAL_CERT =
  /\btrimix\b|\bhelitrox\b|\brebreather\b|\bccr\b|\bscr\b|\bcave\b|\bcavern\b|\bmine\b|decompression|\bdeco\b|\btec\b|\btech\b|technical|extended range|mixed gas|gas blender|hypoxic|normoxic|advanced nitrox|\bsump\b|\bdpv\b/;

/**
 * Words naming a *discipline* rather than a rung. When one is present, "advanced"
 * is qualifying that discipline (Advanced Nitrox, Advanced Sidemount, Advanced
 * Wreck) and is not the Advanced Open Water rung. Kept separate from
 * `TECHNICAL_CERT`: a PADI Sidemount or Advanced Photography card is perfectly
 * recreational, it just isn't a rung either, so it falls through to the ordinary
 * "isn't a level we gate on" note instead of being called technical.
 */
const DISCIPLINE_QUALIFIER =
  /nitrox|eanx|enriched|trimix|helitrox|rebreather|\bccr\b|\bscr\b|cave|cavern|wreck|sidemount|side mount|deco|\bgas\b|\btec\b|\btech\b|technical|extended range|\bice\b|sump|\bdpv\b|scooter|photo|video|search|recovery|navigation|\bnav\b|night|dry.?suit|\bdeep\b|altitude|\bboat\b|\bdrift\b/;

/** True when a cell names a technical/overhead rating DiveDay does not model. */
export function isTechnicalCertName(raw: string | null | undefined): boolean {
  return TECHNICAL_CERT.test((raw ?? "").trim().toLowerCase());
}

/** Map a free-text level to a ladder rung, or null when it is not a rung we gate on. */
export function normalizeLevel(raw: string | undefined): ImportLevel | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  // Never bend a technical rating onto the recreational ladder. First, because a
  // ladder card clears its gate on `status` alone, so a mistake here is a
  // clearance nobody granted.
  if (TECHNICAL_CERT.test(value)) return null;
  // Order matters: "advanced open water" contains "open water".
  if (/instructor|owsi|\bidc\b|\bmsdt\b/.test(value)) return "instructor";
  if (/divemaster|dive master|\bdm\b/.test(value)) return "divemaster";
  if (/rescue/.test(value)) return "rescue";
  // "advanced" is the AOW rung only when it isn't qualifying another discipline.
  // "AOW" and SSI's "Advanced Adventurer" are the rung; "Advanced Nitrox" is not.
  if (/\baow\b|\bowa\b/.test(value)) return "advanced_open_water";
  if (/advanced/.test(value) && !DISCIPLINE_QUALIFIER.test(value)) return "advanced_open_water";
  if (/open.?water|\bow\b|\bowd\b|open water diver/.test(value)) return "open_water";
  return null;
}

/**
 * The widest a card number may be. Matches the hand-entry form's own bound
 * (`src/app/shop/[shopSlug]/divers/[personId]/actions.ts`), which the bulk path
 * had no equivalent of: the unique indexes are btrees over `lower(identifier)`,
 * and one 2,000-character cell (the only cap that used to apply) overflows a
 * btree tuple and aborts the whole import with an opaque database error
 * (`security-reviewer` finding). Bounded here so the row is skipped with a
 * reason instead.
 */
const MIN_CARD_NUMBER_LENGTH = 2;
const MAX_CARD_NUMBER_LENGTH = 120;

/** Free-text personal fields we copy verbatim, capped to the column's form bound. */
const MAX_FREE_TEXT_LENGTH = 120;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A date off an import row (a prior visit, an incident), read from the formats
 * real exports actually emit — not ISO alone. EVE runs on a US-locale Windows box and
 * a spreadsheet writes whatever the machine's locale says, so `05/04/2030` and
 * `4-May-2030` are the common cases and ISO is the lucky one.
 *
 * Ambiguity is resolved, never guessed at silently: `05/04/2030` is read as
 * month-first (US), which is what the systems in the guides emit, and a
 * day-first file's dates land on the wrong day only when both parts are ≤ 12 —
 * so a value whose first part is > 12 is read day-first instead. Callers report
 * which reading they used.
 *
 * Returns null for anything it cannot read *or* cannot believe: a year outside
 * 1900–2200 is a typo or a sentinel ("9999-12-31" is how a card becomes valid
 * forever), and year 0–99 is additionally unrepresentable in a Postgres `date`.
 */
export function parseCardDate(raw: string | null | undefined): {
  date: CalendarDate;
  assumedMonthFirst: boolean;
} | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(value);
  const named = /^(\d{1,2})[\s-]([a-zA-Z]{3,})[\s-](\d{2,4})$/.exec(value);
  const namedFirst = /^([a-zA-Z]{3,})[\s-](\d{1,2}),?[\s-]?(\d{2,4})$/.exec(value);

  let year: number;
  let month: number;
  let day: number;
  let assumedMonthFirst = false;
  // Only a year the file actually wrote in two digits gets a century added; a
  // written-out "0000" is a bad value, not shorthand for 2000.
  let yearWasTwoDigit = false;

  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    // > 12 can only be a day, so that file is day-first; otherwise assume the
    // month-first reading the guides' own systems emit.
    assumedMonthFirst = first <= 12;
    month = assumedMonthFirst ? first : second;
    day = assumedMonthFirst ? second : first;
    year = Number(slash[3]);
    yearWasTwoDigit = slash[3].length === 2;
  } else if (named || namedFirst) {
    const match = named ?? namedFirst;
    if (!match) return null;
    const monthName = (named ? match[2] : match[1]).slice(0, 3).toLowerCase();
    const index = MONTHS.indexOf(monthName);
    if (index < 0) return null;
    month = index + 1;
    day = Number(named ? match[1] : match[2]);
    year = Number(match[3]);
    yearWasTwoDigit = match[3].length === 2;
  } else {
    return null;
  }

  // A two-digit year is this century: nothing an import carries is from the 1900s.
  if (yearWasTwoDigit) year += 2000;
  if (year < 1900 || year > 2200) return null;
  const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!isValidCalendarDate(candidate)) return null;
  return { date: candidate, assumedMonthFirst };
}

const TRUEISH = new Set(["true", "yes", "y", "1", "certified", "nitrox", "eanx", "enriched air"]);

/**
 * A source column explicitly saying the prior system had *not* verified this
 * card. The whole verified-on-import posture rests on "the shop's own system
 * already checked it" (ADR 20260724-import-verified-cards) — where the file says
 * in as many words that it didn't, that premise is absent, so the card lands
 * `pending` for a staff review instead (`dive-domain-expert` review).
 */
const NOT_VERIFIED = new Set([
  "false",
  "no",
  "n",
  "0",
  "unverified",
  "not verified",
  "unconfirmed",
  "pending",
  "pending review",
  "awaiting verification",
  "claimed",
  "expired",
  "lapsed",
  "rejected",
]);

function saysNotVerified(raw: string | undefined): boolean {
  return NOT_VERIFIED.has((raw ?? "").trim().toLowerCase());
}

function isTrueish(raw: string | undefined): boolean {
  return TRUEISH.has((raw ?? "").trim().toLowerCase());
}

// A lenient shape check, not validation: we want "obviously not an address" out,
// not to adjudicate RFC 5322. A bad address drops (with a note) so it never
// silently mismatches an existing diver on dedup.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Free text copied verbatim onto a person, bounded to the hand-entry form's cap. */
function freeText(value: string | null): string | null {
  if (!value) return null;
  return value.length > MAX_FREE_TEXT_LENGTH ? value.slice(0, MAX_FREE_TEXT_LENGTH) : value;
}

/**
 * A card number we are willing to key a unique index on. Out-of-range lengths
 * return null so the caller declines the card with a reason — the same
 * no-number-no-card path — rather than handing Postgres a 2,000-character btree
 * key that aborts the entire import (`security-reviewer` finding).
 */
function cardNumber(value: string | null): string | null {
  if (!value) return null;
  if (value.length < MIN_CARD_NUMBER_LENGTH || value.length > MAX_CARD_NUMBER_LENGTH) return null;
  return value;
}

/**
 * Turn raw CSV text into a validated, safety-normalized import plan. Pure: no
 * database, no clock, no framework — the browser preview and the server commit
 * both call this and must agree.
 */
export function prepareContactImport(text: string): PreparedImport {
  const grid = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  const empty: PreparedImport = {
    mapping: [],
    unmappedColumns: [],
    ignoredMedicalColumns: [],
    rows: [],
    totals: {
      total: 0,
      importable: 0,
      merged: 0,
      skipped: 0,
      withCard: 0,
      withSpecialty: 0,
      withNitrox: 0,
      withWaiver: 0,
      withVisit: 0,
      withPaymentHistory: 0,
      withNotes: 0,
    },
    fatal: null,
  };
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > MAX_IMPORT_BYTES) {
    const limitMb = (MAX_IMPORT_BYTES / (1024 * 1024)).toFixed(0);
    return { ...empty, fatal: { code: "file_too_large", params: { limitMb } } };
  }
  if (grid.length === 0) return { ...empty, fatal: { code: "file_empty" } };

  const headers = grid[0];
  const bodyRows = grid.slice(1);
  if (headers.length > MAX_IMPORT_COLUMNS) {
    return {
      ...empty,
      fatal: {
        code: "too_many_columns",
        params: { count: headers.length, limit: MAX_IMPORT_COLUMNS },
      },
    };
  }
  if (bodyRows.length > MAX_IMPORT_ROWS) {
    return {
      ...empty,
      fatal: {
        code: "too_many_rows",
        params: { count: bodyRows.length, limit: MAX_IMPORT_ROWS },
      },
    };
  }
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (row?.some((cell) => cell.length > MAX_IMPORT_CELL_LENGTH)) {
      return {
        ...empty,
        fatal:
          r === 0
            ? { code: "cell_too_long_header", params: { limit: MAX_IMPORT_CELL_LENGTH } }
            : { code: "cell_too_long_row", params: { row: r, limit: MAX_IMPORT_CELL_LENGTH } },
      };
    }
  }

  const mapping: ColumnMapping[] = [];
  const unmappedColumns: string[] = [];
  const ignoredMedicalColumns: string[] = [];
  const claimedFields = new Set<ImportField>();

  headers.forEach((rawHeader, columnIndex) => {
    const header = rawHeader.trim();
    const normalized = normalizeHeader(header);
    if (!normalized) return;
    if (SENSITIVE_PAYMENT_HEADER_PATTERN.test(normalized)) {
      unmappedColumns.push(header);
      return;
    }
    const field = IMPORT_FIELDS.find(
      (candidate) =>
        !claimedFields.has(candidate) && HEADER_ALIASES[candidate].includes(normalized),
    );
    if (field) {
      claimedFields.add(field);
      mapping.push({ field, header, columnIndex });
      return;
    }
    if (MEDICAL_HEADER_PATTERN.test(header)) ignoredMedicalColumns.push(header);
    else unmappedColumns.push(header);
  });

  const indexOf = (field: ImportField) =>
    mapping.find((entry) => entry.field === field)?.columnIndex ?? -1;
  const at = (cells: string[], field: ImportField): string | undefined => {
    const index = indexOf(field);
    if (index < 0) return undefined;
    const cell = cells[index];
    return cell === undefined ? undefined : unguardCell(cell);
  };

  const hasIdentity =
    indexOf("full_name") >= 0 || indexOf("first_name") >= 0 || indexOf("last_name") >= 0;
  if (!hasIdentity) {
    return {
      ...empty,
      mapping,
      unmappedColumns,
      ignoredMedicalColumns,
      fatal: { code: "no_name_column" },
    };
  }

  // email → the row number that brought that diver in, so a later row carrying
  // the same email can say which row it merges into.
  const seenEmails = new Map<string, number>();
  const rows: PreparedRow[] = bodyRows.map((cells, bodyIndex) => {
    const rowNumber = bodyIndex + 1;
    const issues: ImportIssue[] = [];

    const full = clean(at(cells, "full_name"));
    const first = clean(at(cells, "first_name"));
    const last = clean(at(cells, "last_name"));
    const fullName = full ?? [first, last].filter(Boolean).join(" ").trim();

    let email = clean(at(cells, "email"));
    if (email) {
      email = email.toLowerCase();
      if (!EMAIL_SHAPE.test(email)) {
        issues.push({
          level: "warning",
          code: "email_invalid",
          params: { email },
        });
        email = null;
      }
    }

    // Row-level provenance: the prior shop/system this record came from, if the
    // file named one. Shared by the card, nitrox card, and waiver record so an
    // imported card is stamped with where the shop verified it before.
    const sourceLabel = clean(at(cells, "waiver_source_name"));

    // The prior system's own verification column, when it has one. A card only
    // lands `verified` on the premise that the shop's system already checked it
    // (ADR 20260724-import-verified-cards) — where the file says outright that it
    // hadn't, that premise is gone and the card is a claim for staff to review.
    const statusRaw = at(cells, "certification_status");
    const sourceSaysUnverified = saysNotVerified(statusRaw);
    if (sourceSaysUnverified) {
      issues.push({
        level: "warning",
        code: "card_marked_unverified",
        params: { status: clean(statusRaw) ?? "" },
      });
    }
    const cardStatus: PreparedCardStatus = sourceSaysUnverified ? "pending" : "verified";
    // Same answer for every card kind on the row: only the source's own status
    // can downgrade one.
    const nitroxStatus: PreparedCardStatus = cardStatus;

    const levelRaw = clean(at(cells, "certification_level"));
    const certNumber = cardNumber(clean(at(cells, "certification_number")));
    const { agency, recognized: agencyKnown } = normalizeAgency(at(cells, "certification_agency"));
    const specialtyRaw = clean(at(cells, "specialty"));
    // A specialty column, or a level/certification column that names one ("PADI
    // Deep Diver") — the shape a rival's certification export actually takes, one
    // row per card (ADR 20260725-import-specialty-cards).
    const specialtySource = specialtyRaw ?? (normalizeSpecialty(levelRaw) ? levelRaw : null);
    // An agency number identifies the *diver*, not the card: a PADI diver's Deep
    // and Wreck cards carry the same PADI number (glossary — "C-card"). So a
    // specialty column legitimately uses this row's card number when it has no
    // number column of its own, and a cell naming two specialties becomes two
    // cards under that one number — `specialty_certifications` is keyed on the
    // specialty as well, and each lands with its gate held either way.
    const specialtyNumber =
      cardNumber(clean(at(cells, "specialty_certification_number"))) ?? certNumber;
    const namedSpecialties = specialtiesNamed(specialtySource);
    const specialties: PreparedSpecialty[] = [];
    if (specialtySource && namedSpecialties.length === 0) {
      issues.push({
        level: "warning",
        code: "specialty_not_gated",
        params: { specialty: specialtySource ?? undefined },
      });
    } else if (namedSpecialties.length > 0) {
      if (!specialtyNumber) {
        issues.push({
          level: "warning",
          code: "specialty_no_card_number",
          params: { specialty: specialtySource ?? undefined },
        });
      } else {
        for (const named of namedSpecialties) {
          specialties.push({
            agency,
            specialty: named,
            identifier: specialtyNumber,
            sourceLabel,
            status: cardStatus,
          });
        }
        issues.push({
          level: "info",
          code:
            cardStatus === "verified"
              ? "specialty_imported_verified"
              : "specialty_imported_pending",
          params: { count: namedSpecialties.length },
        });
        if (!agencyKnown) {
          issues.push({
            level: "info",
            code: "agency_unrecognized",
          });
        }
      }
    }

    // Certification: imported as verified-and-flagged, and only with a real card
    // number (ADR 20260724-import-verified-cards). The prior system already
    // checked it; DiveDay trusts that, marks it imported, and surfaces a one-tap
    // staff confirm rather than re-capturing it as an unverified claim.
    let cert: PreparedCert | null = null;
    // A level column that names a specialty is never *also* read as a ladder
    // rung — whether or not that is where this row's specialty came from. The
    // test has to be on what the column says, not on which column won above: a
    // row carrying `specialty` = "Deep" *and* `certification_level` =
    // "Advanced Wreck Diver" would otherwise file a technical wreck rating as a
    // verified Advanced Open Water card, which clears its gate on the spot.
    const levelNamesSpecialty = specialtiesNamed(levelRaw).length > 0;
    if (levelRaw && levelNamesSpecialty && specialtySource !== levelRaw) {
      issues.push({
        level: "warning",
        code: "level_names_specialty",
        params: { level: levelRaw },
      });
    }
    if (levelRaw && !levelNamesSpecialty) {
      const level = normalizeLevel(levelRaw);
      if (!level && isTechnicalCertName(levelRaw)) {
        // Named separately from the generic "isn't a level" note, because this is
        // the case a shop would otherwise assume came across: it looks like a
        // rung ("Advanced Nitrox"), and it used to import as one.
        issues.push({
          level: "warning",
          code: "level_is_technical",
          params: { level: levelRaw },
        });
      } else if (!level) {
        issues.push({
          level: "warning",
          code: "level_not_gated",
          params: { level: levelRaw },
        });
      } else if (!certNumber) {
        issues.push({
          level: "warning",
          code: "level_no_card_number",
          params: { level: levelRaw },
        });
      } else {
        cert = {
          agency,
          level,
          identifier: certNumber,
          sourceLabel,
          status: cardStatus,
        };
        issues.push({
          level: "info",
          code: cardStatus === "verified" ? "cert_imported_verified" : "cert_imported_pending",
        });
        if (!agencyKnown) {
          issues.push({
            level: "info",
            code: "agency_unrecognized",
          });
        }
      }
    }

    // Nitrox: imported as a verified-and-flagged card, and only against a real
    // card number. Enriched-air fills read the verified card; the imported
    // marker keeps it distinguishable and fills are still re-checked at fill time.
    let nitrox: PreparedNitrox | null = null;
    if (isTrueish(at(cells, "nitrox_certified")) || indexOf("nitrox_certification_number") >= 0) {
      const flagged =
        isTrueish(at(cells, "nitrox_certified")) ||
        Boolean(clean(at(cells, "nitrox_certification_number")));
      const nitroxNumber = cardNumber(clean(at(cells, "nitrox_certification_number")));
      if (flagged && nitroxNumber) {
        nitrox = { agency, identifier: nitroxNumber, sourceLabel, status: nitroxStatus };
        issues.push({
          level: "info",
          code: "nitrox_imported",
        });
      } else if (flagged) {
        issues.push({
          level: "info",
          code: "nitrox_no_card_number",
        });
      }
    }

    const sizes = {
      bcdSize: clean(at(cells, "bcd_size")),
      wetsuitSize: clean(at(cells, "wetsuit_size")),
      bootSize: clean(at(cells, "boot_size")),
      finSize: clean(at(cells, "fin_size")),
    };

    // Trusted per row (ADR 20260724-import-waiver-acceptance): a truthy
    // waiver_accepted claims the diver already accepted a waiver — and its
    // medical clearance — at the prior shop. A signed date is kept only when
    // it is a real calendar date; an unparseable one is dropped with a note
    // rather than silently misdating legal evidence.
    let waiver: PreparedWaiver | null = null;
    if (isTrueish(at(cells, "waiver_accepted"))) {
      const signedAtRaw = clean(at(cells, "waiver_signed_at"));
      let signedAt: string | null = null;
      if (signedAtRaw) {
        if (isValidCalendarDate(signedAtRaw)) {
          signedAt = signedAtRaw;
        } else {
          issues.push({
            level: "warning",
            code: "waiver_date_invalid",
            params: { value: signedAtRaw },
          });
        }
      }
      waiver = {
        signedAt,
        sourceLabel,
        documentUrl: clean(at(cells, "waiver_document_url")),
        medicalDocumentUrl: clean(at(cells, "medical_document_url")),
      };
      issues.push({
        level: "info",
        code: "waiver_imported",
      });
    }

    // Date of birth, if the file carries one. Dropped rather than guessed when
    // it isn't a real calendar date or isn't plausible: the column feeds a
    // course minimum-age gate, and a garbage year there is worse than the blank
    // the gate already fails open on.
    let dateOfBirth: string | null = null;
    const dobRaw = clean(at(cells, "date_of_birth"));
    if (dobRaw) {
      if (isValidCalendarDate(dobRaw) && isPlausibleDateOfBirth(dobRaw)) {
        dateOfBirth = dobRaw;
      } else {
        issues.push({
          level: "warning",
          code: "dob_invalid",
          params: { value: dobRaw },
        });
      }
    }

    // A visit the diver made at the prior shop (ADR 20260725-import-prior-visits).
    // Kept only when the row carries a date we can actually read: a visit with
    // no date can't be placed on a timeline, and inventing one — today, the
    // import date, the middle of the file's range — would put a diver in the
    // water on a day nobody claimed. `parseCardDate` is reused deliberately, so
    // a shop's US-locale bookings export reads the same way its certification
    // export does rather than growing a second date dialect.
    let visit: PreparedVisit | null = null;
    const visitDateRaw = clean(at(cells, "visit_date"));
    const visitTitle = freeText(clean(at(cells, "visit_title")));
    const visitStatus = freeText(clean(at(cells, "visit_status")));
    const visitAmount = freeText(clean(at(cells, "visit_amount")));
    const visitReference = freeText(clean(at(cells, "visit_reference")));
    const namesAVisit = Boolean(
      visitDateRaw || visitTitle || visitStatus || visitAmount || visitReference,
    );
    if (visitDateRaw) {
      const parsed = parseCardDate(visitDateRaw);
      if (!parsed) {
        issues.push({
          level: "warning",
          code: "visit_date_unreadable",
          params: { value: visitDateRaw },
        });
      } else {
        const visitedOn = parsed.date;
        visit = {
          visitedOn,
          title: visitTitle,
          statusLabel: visitStatus,
          amountLabel: visitAmount,
          sourceLabel,
          sourceReference: visitReference,
          dedupeKey: priorVisitDedupeKey({
            visitedOn,
            title: visitTitle,
            amountLabel: visitAmount,
            sourceReference: visitReference,
          }),
        };
        if (!visitReference) {
          issues.push({
            level: "info",
            code: "visit_no_reference",
          });
        }
      }
    } else if (namesAVisit) {
      issues.push({
        level: "warning",
        code: "visit_no_date",
      });
    }

    // Financial source evidence is deliberately built separately from the
    // prior visit above. A booking can remain a useful visit even where no
    // payment settled, and a receipt can be useful financial history even
    // where the old system had no usable booking record. The one safe fallback
    // is its booking date/title/status/amount, which lets a conventional sales
    // export contribute a clearly labelled, unverified source payment without
    // creating a local order.
    let paymentHistory: PreparedImportedPaymentHistory | null = null;
    const paymentDateRaw = clean(at(cells, "payment_date"));
    const paymentStatus = freeText(clean(at(cells, "payment_status"))) ?? visitStatus;
    const paymentAmount = freeText(clean(at(cells, "payment_amount"))) ?? visitAmount;
    const paymentCurrency = freeText(clean(at(cells, "payment_currency")));
    const paymentDirectionLabel = freeText(clean(at(cells, "payment_direction")));
    const paymentReference = freeText(clean(at(cells, "payment_reference")));
    const receiptReference = freeText(clean(at(cells, "receipt_reference")));
    const receiptDocumentUrl = clean(at(cells, "receipt_document_url"));
    const stripeReference = freeText(clean(at(cells, "stripe_reference")));
    const direction = importedPaymentDirection({
      directionLabel: paymentDirectionLabel,
      statusLabel: paymentStatus,
      amountLabel: paymentAmount,
    });
    const namesFinancialEvidence = Boolean(
      paymentAmount ||
        paymentReference ||
        receiptReference ||
        receiptDocumentUrl ||
        stripeReference ||
        (paymentStatus && direction !== "unknown") ||
        paymentDirectionLabel,
    );
    if (namesFinancialEvidence) {
      const occurredOnRaw = paymentDateRaw ?? visitDateRaw;
      if (!occurredOnRaw) {
        // A generic booking row already has its own visit_no_date note. Avoid
        // showing that same missing input twice; an explicitly financial row
        // still gets the financial-history explanation it needs.
        if (!namesAVisit) {
          issues.push({ level: "warning", code: "payment_history_no_date" });
        }
      } else {
        const parsed = parseCardDate(occurredOnRaw);
        if (!parsed) {
          // Same courtesy for a shared booking date: the visit warning already
          // says it could not be read. A dedicated payment date gets its own
          // precise warning instead.
          if (occurredOnRaw !== visitDateRaw || !namesAVisit) {
            issues.push({
              level: "warning",
              code: "payment_history_date_unreadable",
              params: { value: occurredOnRaw },
            });
          }
        } else {
          const occurredOn = parsed.date;
          paymentHistory = {
            occurredOn,
            direction,
            title: visitTitle,
            statusLabel: paymentStatus,
            amountLabel: paymentAmount,
            currencyLabel: paymentCurrency,
            paymentReference,
            receiptReference,
            receiptDocumentUrl,
            sourceLabel,
            sourceReference: visitReference,
            stripeReference,
            dedupeKey: importedPaymentHistoryDedupeKey({
              occurredOn,
              direction,
              title: visitTitle,
              statusLabel: paymentStatus,
              amountLabel: paymentAmount,
              paymentReference,
              receiptReference,
              receiptDocumentUrl,
              sourceReference: visitReference,
              stripeReference,
            }),
          };
        }
      }
    }

    let action: PreparedRow["action"] = "import";
    let mergedIntoRow: number | null = null;
    if (!fullName) {
      issues.push({ level: "error", code: "no_name" });
      action = "skip";
    } else if (email && seenEmails.has(email)) {
      // The same diver, not a duplicate to throw away: a certification export
      // lists one row per card, so this is how a diver's second and third cards
      // arrive. Their evidence lands on the diver row 1 brought in; contact
      // fields are left as row 1 gave them.
      action = "merge";
      mergedIntoRow = seenEmails.get(email) ?? null;
      issues.push({
        level: "info",
        code: "merged_duplicate",
        params: { row: mergedIntoRow ?? undefined, email },
      });
    }
    if (action === "import" && email) seenEmails.set(email, rowNumber);
    if (action === "import" && !email) {
      // Matching and de-duping are email-only, so an email-less row always comes
      // in as a fresh record and a later re-import can't find it to update. Say
      // so rather than let the "matched by email" promise overstate the case.
      issues.push({
        level: "info",
        code: "no_email_new_record",
      });
    }

    return {
      rowNumber,
      fullName,
      email,
      phone: clean(at(cells, "phone")),
      dateOfBirth,
      emergencyContactName: clean(at(cells, "emergency_contact_name")),
      emergencyContactPhone: clean(at(cells, "emergency_contact_phone")),
      diveInsurance: freeText(clean(at(cells, "dive_insurance"))),
      // A `merge` row writes its evidence (that is the point of it); only a
      // `skip` row contributes nothing at all.
      cert: action === "skip" ? null : cert,
      specialties: action === "skip" ? [] : specialties,
      nitrox: action === "skip" ? null : nitrox,
      sizes,
      waiver: action === "skip" ? null : waiver,
      visit: action === "skip" ? null : visit,
      paymentHistory: action === "skip" ? null : paymentHistory,
      notes: action === "skip" ? null : clean(at(cells, "internal_notes")),
      action,
      mergedIntoRow,
      issues,
    };
  });

  const importable = rows.filter((row) => row.action === "import");
  const merged = rows.filter((row) => row.action === "merge");
  // Evidence counts span both, because a merge row's whole purpose is its cards.
  const written = [...importable, ...merged];
  return {
    mapping,
    unmappedColumns,
    ignoredMedicalColumns,
    rows,
    totals: {
      total: rows.length,
      importable: importable.length,
      merged: merged.length,
      skipped: rows.length - importable.length - merged.length,
      withCard: written.filter((row) => row.cert).length,
      withSpecialty: written.reduce((sum, row) => sum + row.specialties.length, 0),
      withNitrox: written.filter((row) => row.nitrox).length,
      withWaiver: written.filter((row) => row.waiver).length,
      withVisit: written.filter((row) => row.visit).length,
      withPaymentHistory: written.filter((row) => row.paymentHistory).length,
      withNotes: written.filter((row) => Boolean(row.notes)).length,
    },
    fatal: null,
  };
}
