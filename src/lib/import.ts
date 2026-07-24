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
import { isValidCalendarDate } from "./calendar-date";

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
  "emergency_contact_name",
  "emergency_contact_phone",
  "certification_agency",
  "certification_level",
  "certification_number",
  "certification_status",
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
    what: "Rental sizes",
    scope: "included",
    detail: "BCD, wetsuit, boot, and fin sizes become a rental-fit profile.",
  },
  {
    what: "Certification card",
    scope: "included",
    detail:
      "Imported verified and flagged imported — DiveDay trusts the card your system already checked, so a diver is ready from the first trip. A card lands with a card number and a recognized level; staff give it a one-tap confirm, and expiry still applies. Unrecognized levels are left for a person to enter.",
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
      "When a row says the diver already accepted a waiver at the prior shop, DiveDay trusts it — including its medical clearance — and the diver is not asked to sign again. The record is marked imported everywhere staff see it, snapshots your shop's current release for reference only (the diver did not agree to that exact text), and is dated to the acceptance date the row gives (or the import date if it doesn't). Individual medical answers are never reconstructed — only the accept/no-review-needed outcome carries over. This is a deliberate policy choice; see the imported-waiver ADR.",
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
    what: "Specialty cards (deep, wreck, night, drysuit)",
    scope: "stays-behind",
    detail:
      "A contact file has no column for them, so they stay behind — re-enter and verify each by hand. Until then a diver isn't cleared for a dive that requires one (deep gates depth past 18 m).",
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
export type PreparedCert = {
  agency: ImportAgency;
  level: ImportLevel;
  identifier: string;
  sourceLabel: string | null;
};
export type PreparedNitrox = {
  agency: ImportAgency;
  identifier: string;
  sourceLabel: string | null;
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
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  cert: PreparedCert | null;
  nitrox: PreparedNitrox | null;
  sizes: {
    bcdSize: string | null;
    wetsuitSize: string | null;
    bootSize: string | null;
    finSize: string | null;
  };
  waiver: PreparedWaiver | null;
  /** "import" rows are written; "skip" rows never touch the database. */
  action: "import" | "skip";
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
    importable: number;
    skipped: number;
    withCard: number;
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

const TRUEISH = new Set(["true", "yes", "y", "1", "certified", "nitrox", "eanx", "enriched air"]);

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
    totals: { total: 0, importable: 0, skipped: 0, withCard: 0, withNitrox: 0, withWaiver: 0 },
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

  const seenEmails = new Set<string>();
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

    // Certification: imported as verified-and-flagged, and only with a real card
    // number (ADR 20260724-import-verified-cards). The prior system already
    // checked it; DiveDay trusts that, marks it imported, and surfaces a one-tap
    // staff confirm rather than re-capturing it as an unverified claim.
    let cert: PreparedCert | null = null;
    const levelRaw = clean(at(cells, "certification_level"));
    const certNumber = clean(at(cells, "certification_number"));
    const { agency, recognized: agencyKnown } = normalizeAgency(at(cells, "certification_agency"));
    if (levelRaw) {
      const level = normalizeLevel(levelRaw);
      if (!level) {
        issues.push({
          level: "warning",
          message: `Certification "${levelRaw}" isn't a level we gate on — card not imported. Add it by hand if it's a real card.`,
        });
      } else if (!certNumber) {
        issues.push({
          level: "warning",
          message: `Certification level "${levelRaw}" has no card number — card not imported. A card without a number can't be verified.`,
        });
      } else {
        cert = { agency, level, identifier: certNumber, sourceLabel };
        issues.push({
          level: "info",
          message:
            "Card imported as verified from your records — flagged imported, with a one-tap confirm for staff.",
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
      const nitroxNumber = clean(at(cells, "nitrox_certification_number"));
      if (flagged && nitroxNumber) {
        nitrox = { agency, identifier: nitroxNumber, sourceLabel };
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

    let action: PreparedRow["action"] = "import";
    if (!fullName) {
      issues.push({ level: "error", message: "No name — row skipped." });
      action = "skip";
    } else if (email && seenEmails.has(email)) {
      issues.push({
        level: "error",
        message: `Duplicate of an earlier row with email "${email}" — skipped so the first wins.`,
      });
      action = "skip";
    }
    if (action === "import" && email) seenEmails.add(email);
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
      emergencyContactName: clean(at(cells, "emergency_contact_name")),
      emergencyContactPhone: clean(at(cells, "emergency_contact_phone")),
      cert: action === "import" ? cert : null,
      nitrox: action === "import" ? nitrox : null,
      sizes,
      waiver: action === "import" ? waiver : null,
      action,
      issues,
    };
  });

  const importable = rows.filter((row) => row.action === "import");
  return {
    mapping,
    unmappedColumns,
    ignoredMedicalColumns,
    rows,
    totals: {
      total: rows.length,
      importable: importable.length,
      skipped: rows.length - importable.length,
      withCard: importable.filter((row) => row.cert).length,
      withNitrox: importable.filter((row) => row.nitrox).length,
      withWaiver: importable.filter((row) => row.waiver).length,
    },
    fatal: null,
  };
}
