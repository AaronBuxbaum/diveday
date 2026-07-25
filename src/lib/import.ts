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
 *     expiry backstops — waits for the one-tap staff confirm (`reviewedAt`); an
 *     imported-but-unconfirmed card gives plain air (src/db/nitrox.ts). A card
 *     entered by hand is unaffected.
 *   - A specialty card (deep, wreck, night, drysuit) imports the same way, and
 *     is the strictest of the three (ADR 20260725-import-specialty-cards):
 *     verified and flagged, but the specialty *gate* stays shut until the
 *     one-tap confirm, because a specialty is what authorizes a materially
 *     riskier dive (deep gates depth past 18 m). One card number can only ever
 *     become one card, so a cell naming two specialties imports neither and says
 *     so rather than inventing a number for the second.
 *   - A card's expiry comes across when the row carries a real calendar date,
 *     including one already in the past — an expired card on file is a fact
 *     readiness must see, and the alternative is a migrated card that looks
 *     valid forever.
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
import type { DiveSpecialty } from "@/db/schema";
import { isPlausibleDateOfBirth } from "./age";
import { type CalendarDate, isValidCalendarDate } from "./calendar-date";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5_000;
export const MAX_IMPORT_COLUMNS = 40;
export const MAX_IMPORT_CELL_LENGTH = 2_000;

/** Certification agencies we can name; anything else lands as "other". Mirrors the pg enum. */
export const IMPORT_AGENCIES = ["padi", "ssi", "naui", "sdi", "tdi", "other"] as const;
export type ImportAgency = (typeof IMPORT_AGENCIES)[number];

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
  "certification_expires_at",
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
    "card_number",
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
  // The card's own refresher-due date. Applies to whichever card this row's
  // level/specialty column produces — nitrox cards carry no expiry at all.
  certification_expires_at: [
    // The staff-facing name for this date is "refresher due" (H-08) — a shop
    // whose sheet uses our own wording must be recognized, not ignored.
    "refresher_due",
    "refresher_due_date",
    "refresher_date",
    "refresher",
    "certification_expires_at",
    "certification_expiry",
    "certification_expiration",
    "certification_expiration_date",
    "cert_expires",
    "cert_expiry",
    "card_expires",
    "card_expiry",
    "expires",
    "expires_at",
    "expiry",
    "expiry_date",
    "expiration_date",
    "valid_until",
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
};

/**
 * Columns whose presence means "there is medical/liability content here we are
 * deliberately not importing". Matched loosely so a shop is told, once, that
 * their health data stays behind rather than silently dropped.
 */
const MEDICAL_HEADER_PATTERN =
  /medical|health|rstc|allerg|physician|doctor|condition|diagnos|medication|liability|indemnif/i;

/**
 * Published scope table — what the importer takes, in the shop owner's words.
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
  what: string;
  scope: "included" | "stays-behind";
  detail: string;
}[] = [
  {
    what: "Names, email, phone",
    scope: "included",
    detail:
      "Imported as given. A row with an email is matched to an existing diver so a re-import updates them; a row without one always comes in as a new record.",
  },
  {
    what: "Emergency contact",
    scope: "included",
    detail: "Name and phone carry over when present.",
  },
  {
    what: "Dive insurance (DAN)",
    scope: "included",
    detail:
      "Carried across as free text, exactly as your file holds it (“DAN #12345”). Never a gate — it's the detail the crew wants on hand in an incident.",
  },
  {
    what: "Rental sizes",
    scope: "included",
    detail: "BCD, wetsuit, boot, and fin sizes become a rental-fit profile.",
  },
  {
    what: "Certification card",
    scope: "included",
    detail:
      "Imported verified and flagged imported — DiveDay trusts the card your system already checked, so a diver is ready from the first trip. A card lands with a card number and a recognized level; staff give it a one-tap confirm. A refresher-due date comes across with it, read from whatever date format your file writes, and a date already past lands as a card that's due rather than one that looks current forever. Two things import for staff review instead of as verified: a card your own file marks unverified, and a card whose refresher date we can't read — we won't guess at a date the boat depends on. Unrecognized levels are left for a person to enter.",
  },
  {
    what: "Specialty cards (deep, wreck, night, drysuit)",
    scope: "included",
    detail:
      "Imported as verified specialty cards, flagged imported — from a specialty column, or from a certification row that names one (“PADI Deep Diver”). Your diver's agency number is what carries them, the same number their level card uses, so a “Deep, Wreck” cell comes across as both cards and a certification file with one row per card brings in every card a diver holds. A specialty is what clears a riskier dive, so this one is stricter than a level card: the dive that requires it waits on the one-tap staff confirm, and everything else about the diver's day does not.",
  },
  {
    what: "Enriched air (nitrox)",
    scope: "included",
    detail:
      "Imported as a verified nitrox card, flagged imported, whenever the row carries a nitrox card number — so a diver can request enriched air right away. A fill is the highest-stakes gate, so an imported nitrox card gives plain air until a staffer taps the one-tap confirm; boarding never waits on it.",
  },
  {
    what: "Signed waivers & medical clearance",
    scope: "included",
    detail:
      "When a row says the diver already accepted a waiver at the prior shop, DiveDay trusts it — including its medical clearance — and the diver is not asked to sign again. The record is marked imported everywhere staff see it, snapshots your shop's current release for reference only (the diver did not agree to that exact text), and is dated to the acceptance date the row gives (or the import date if it doesn't). Individual medical answers are never reconstructed — only the accept/no-review-needed outcome carries over. Trusting a prior shop's acceptance is a deliberate choice on our side, not an accident of the import.",
  },
  {
    what: "Waiver / medical documents",
    scope: "included",
    detail:
      "A row's waiver_document_url / medical_document_url is fetched once and re-stored in DiveDay's own storage for audit, the same way a pasted card photo is. Image files (JPEG/PNG/WebP/HEIC) and PDFs are supported, 5 MB max.",
  },
  {
    what: "Role",
    scope: "included",
    detail: "Everyone imports as a diver. Staff roles and logins are never granted by import.",
  },
  {
    what: "Card on file / payment",
    scope: "stays-behind",
    detail: "Stays with your payment processor — DiveDay never imports card or payment data.",
  },
  {
    what: "Booking, trip & service history",
    scope: "stays-behind",
    detail: "Not part of a contact import — your full-shop export carries the history.",
  },
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
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

export type ImportIssue = { level: "error" | "warning" | "info"; message: string };

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
 * says the card was never verified, or it carries a refresher-due date nobody can
 * read. Those cards import as staff-review claims instead.
 */
export type PreparedCardStatus = "verified" | "pending";

export type PreparedCert = {
  agency: ImportAgency;
  level: ImportLevel;
  identifier: string;
  sourceLabel: string | null;
  /** The card's own refresher-due date when the row carried a readable one (CR-009). */
  expiresAt: string | null;
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
  expiresAt: string | null;
  status: PreparedCardStatus;
};
export type PreparedNitrox = {
  agency: ImportAgency;
  identifier: string;
  sourceLabel: string | null;
  /**
   * Downgraded to `pending` only by the source's own "not verified" status —
   * never by an unreadable refresher-due date, since a nitrox card has no expiry
   * column for that date to belong to.
   */
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
  };
  /** Set when the file has no header row, or no recognizable identity column. */
  fatal: string | null;
};

function normalizeAgency(raw: string | undefined): { agency: ImportAgency; recognized: boolean } {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return { agency: "other", recognized: false };
  const direct = IMPORT_AGENCIES.find((agency) => agency !== "other" && value.includes(agency));
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
  if (/\bdeep\b/.test(value)) found.push("deep");
  return found;
}

/** Map a free-text level to a ladder rung, or null when it is not a rung we gate on. */
export function normalizeLevel(raw: string | undefined): ImportLevel | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  // Order matters: "advanced open water" contains "open water".
  if (/instructor|owsi|\bidc\b|\bmsdt\b/.test(value)) return "instructor";
  if (/divemaster|dive master|\bdm\b/.test(value)) return "divemaster";
  if (/rescue/.test(value)) return "rescue";
  if (/advanced|\baow\b|\bowa\b/.test(value)) return "advanced_open_water";
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
 * The refresher-due date a shop tracks on a card, read from the formats real
 * exports actually emit — not ISO alone. EVE runs on a US-locale Windows box and
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

  // A two-digit year is this century: a refresher date is never in the 1900s.
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
    },
    fatal: null,
  };
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > MAX_IMPORT_BYTES) {
    const limitMb = (MAX_IMPORT_BYTES / (1024 * 1024)).toFixed(0);
    return { ...empty, fatal: `The file is too large — the limit is ${limitMb} MB.` };
  }
  if (grid.length === 0) return { ...empty, fatal: "The file is empty." };

  const headers = grid[0];
  const bodyRows = grid.slice(1);
  if (headers.length > MAX_IMPORT_COLUMNS) {
    return {
      ...empty,
      fatal: `Too many columns (${headers.length}) — the limit is ${MAX_IMPORT_COLUMNS}.`,
    };
  }
  if (bodyRows.length > MAX_IMPORT_ROWS) {
    return {
      ...empty,
      fatal: `Too many rows (${bodyRows.length}) — the limit is ${MAX_IMPORT_ROWS} per import. Split the file and import it in batches.`,
    };
  }
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (row?.some((cell) => cell.length > MAX_IMPORT_CELL_LENGTH)) {
      const where = r === 0 ? "the header row" : `row ${r}`;
      return {
        ...empty,
        fatal: `A cell in ${where} is longer than ${MAX_IMPORT_CELL_LENGTH} characters — check for a pasted document instead of a spreadsheet.`,
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
      fatal:
        "No name column found. The file needs a full name, or first and last name, to import people.",
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
          message: `Email "${email}" doesn't look valid — imported without an email.`,
        });
        email = null;
      }
    }

    // Row-level provenance: the prior shop/system this record came from, if the
    // file named one. Shared by the card, nitrox card, and waiver record so an
    // imported card is stamped with where the shop verified it before.
    const sourceLabel = clean(at(cells, "waiver_source_name"));

    // The card's refresher-due date, kept only when it is a real calendar date.
    // A past date is imported as-is rather than dropped: an expired card on file
    // is a fact readiness must see, and dropping it would leave a migrated card
    // looking valid forever (which is what this column existing fixes).
    // The refresher-due date the shop tracks on the card, read from the formats
    // real exports emit (`parseCardDate`). Two things fail closed here rather
    // than quietly producing a card that outlives its refresher:
    //   - a value present but unreadable, or unbelievable (year 9999, a sentinel
    //     for "never"), lands the row's cards `pending` instead of upgrading them
    //     to no-expiry — an unreadable gate input is not a pass; and
    //   - a date already past is imported as-is, because an overdue card on file
    //     is a fact readiness must see.
    let cardExpiresAt: string | null = null;
    let expiryUnreadable = false;
    const expiresRaw = clean(at(cells, "certification_expires_at"));
    if (expiresRaw) {
      const parsed = parseCardDate(expiresRaw);
      if (!parsed) {
        expiryUnreadable = true;
        issues.push({
          level: "warning",
          message: `Refresher-due date "${expiresRaw}" can't be read as a date — the card imports for staff review instead of as verified, so nobody boards on a date we guessed.`,
        });
      } else {
        cardExpiresAt = parsed.date;
        if (parsed.assumedMonthFirst && expiresRaw !== parsed.date) {
          issues.push({
            level: "info",
            message: `Refresher-due date "${expiresRaw}" read as ${parsed.date} (month first). Check it if your file writes day first.`,
          });
        }
      }
    }

    // The prior system's own verification column, when it has one. A card only
    // lands `verified` on the premise that the shop's system already checked it
    // (ADR 20260724-import-verified-cards) — where the file says outright that it
    // hadn't, that premise is gone and the card is a claim for staff to review.
    const statusRaw = at(cells, "certification_status");
    const sourceSaysUnverified = saysNotVerified(statusRaw);
    if (sourceSaysUnverified) {
      issues.push({
        level: "warning",
        message: `Your file marks this card "${clean(statusRaw)}" — imported for staff review rather than as verified, since your own records don't call it checked.`,
      });
    }
    const cardStatus: PreparedCardStatus =
      sourceSaysUnverified || expiryUnreadable ? "pending" : "verified";
    // A nitrox card has no expiry column, so an unreadable refresher-due date
    // says nothing about it — only the source's own status can downgrade it.
    const nitroxStatus: PreparedCardStatus = sourceSaysUnverified ? "pending" : "verified";

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
        message: `Specialty "${specialtySource}" isn't a specialty we gate on (deep, wreck, night, drysuit) — nothing imported for it.`,
      });
    } else if (namedSpecialties.length > 0) {
      if (!specialtyNumber) {
        issues.push({
          level: "warning",
          message: `Specialty "${specialtySource}" has no card number on the row — not imported. A card without a number can't be verified.`,
        });
      } else {
        for (const named of namedSpecialties) {
          specialties.push({
            agency,
            specialty: named,
            identifier: specialtyNumber,
            sourceLabel,
            expiresAt: cardExpiresAt,
            status: cardStatus,
          });
        }
        issues.push({
          level: "info",
          message:
            cardStatus === "verified"
              ? `${namedSpecialties.length === 1 ? "Specialty card" : `${namedSpecialties.length} specialty cards`} imported as verified from your records — flagged imported. A dive that requires one waits on the one-tap staff confirm.`
              : `${namedSpecialties.length === 1 ? "Specialty card" : `${namedSpecialties.length} specialty cards`} imported for staff review — see the note above.`,
        });
        if (!agencyKnown) {
          issues.push({
            level: "info",
            message: "Certification agency unrecognized — imported as “other”.",
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
        message: `Certification "${levelRaw}" names a specialty, not a level, and this row's specialty column was used instead — no level card imported. Add that card by hand if it's a separate one.`,
      });
    }
    if (levelRaw && !levelNamesSpecialty) {
      const level = normalizeLevel(levelRaw);
      if (!level) {
        issues.push({
          level: "warning",
          message: `Certification "${levelRaw}" isn't a level we gate on — card not imported. Add it by hand if it's a real card.`,
        });
      } else if (!certNumber) {
        issues.push({
          level: "warning",
          message: `Certification level "${levelRaw}" has no usable card number — card not imported. A card without a number can't be verified.`,
        });
      } else {
        cert = {
          agency,
          level,
          identifier: certNumber,
          sourceLabel,
          expiresAt: cardExpiresAt,
          status: cardStatus,
        };
        issues.push({
          level: "info",
          message:
            cardStatus === "verified"
              ? "Card imported as verified from your records — flagged imported, with a one-tap confirm for staff."
              : "Card imported for staff review — see the note above.",
        });
        if (!agencyKnown) {
          issues.push({
            level: "info",
            message: "Certification agency unrecognized — imported as “other”.",
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
          message:
            "Nitrox card imported as verified from your records — flagged imported. Fills give plain air until a staffer taps confirm.",
        });
      } else if (flagged) {
        issues.push({
          level: "info",
          message:
            "Enriched-air marked on the source with no card number — add and verify a nitrox card in DiveDay.",
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
            message: `Waiver accepted date "${signedAtRaw}" isn't a real calendar date (expected YYYY-MM-DD) — imported dated to today instead.`,
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
        message:
          "Waiver imported as accepted — trusted from the prior shop, including medical clearance, and marked “imported” so it's never confused with a release signed in DiveDay.",
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
          message: `Date of birth "${dobRaw}" isn't a plausible calendar date (expected YYYY-MM-DD, 1900 or later, not in the future) — imported without it.`,
        });
      }
    }

    let action: PreparedRow["action"] = "import";
    let mergedIntoRow: number | null = null;
    if (!fullName) {
      issues.push({ level: "error", message: "No name — row skipped." });
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
        message: `Same diver as row ${mergedIntoRow} (${email}) — this row's cards and waiver are added to them, contact details left as the earlier row has them.`,
      });
    }
    if (action === "import" && email) seenEmails.set(email, rowNumber);
    if (action === "import" && !email) {
      // Matching and de-duping are email-only, so an email-less row always comes
      // in as a fresh record and a later re-import can't find it to update. Say
      // so rather than let the "matched by email" promise overstate the case.
      issues.push({
        level: "info",
        message: "No email — imported as a new record; a re-import can't match it to update.",
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
    },
    fatal: null,
  };
}
