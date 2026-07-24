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
 *   - An imported certification is always **claimed**, never verified. A fast
 *     import is only safe because the verified/claimed distinction survives it;
 *     staff re-check the card at first contact exactly as they do today.
 *   - We never fabricate a card number. No number on the row → no card, and we
 *     say so — a made-up identifier would collide, and a card with no evidence
 *     is worse than no card.
 *   - Medical and health answers are never imported (fail-closed). A migrating
 *     shop collects a fresh signed waiver in DiveDay; a "cleared" flag from
 *     another system is not clearance here.
 *   - Enriched-air is a claim, not a fill authorization — a nitrox card imports
 *     pending like any other, and only against a real card number.
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
};

/**
 * Columns whose presence means "there is medical/liability content here we are
 * deliberately not importing". Matched loosely so a shop is told, once, that
 * their health data stays behind rather than silently dropped.
 */
const MEDICAL_HEADER_PATTERN =
  /medical|health|rstc|allerg|physician|doctor|condition|diagnos|medication|liability|indemnif/i;

/** Published scope table — what the importer takes, in the shop owner's words. */
export const IMPORT_HONESTY_TABLE: {
  what: string;
  scope: "full" | "partial" | "never";
  detail: string;
}[] = [
  {
    what: "Names, email, phone",
    scope: "full",
    detail:
      "Imported as given. A row with an email is matched to an existing diver so a re-import updates them; a row without one always comes in as a new record.",
  },
  {
    what: "Emergency contact",
    scope: "full",
    detail: "Name and phone carry over when present.",
  },
  {
    what: "Rental sizes",
    scope: "full",
    detail: "BCD, wetsuit, boot, and fin sizes become a rental-fit profile.",
  },
  {
    what: "Certification card",
    scope: "partial",
    detail:
      "Imported as claimed — never verified. A card lands only with a card number and a recognized level; your staff verify it at first contact, same as a card entered by hand. Unrecognized levels are left for a person to enter.",
  },
  {
    what: "Enriched air (nitrox)",
    scope: "partial",
    detail:
      "A claim, not a fill authorization. Imported as a claimed card only when the row carries a nitrox card number. A diver can still request enriched air, but every fill is re-checked at fill time and gives plain air until staff verify the card.",
  },
  {
    what: "Specialty cards (deep, wreck, night, drysuit)",
    scope: "never",
    detail:
      "The contact file has no column for them, so they don't come across. Re-enter and verify each by hand — until then a diver isn't cleared for a dive that requires one (deep gates depth past 18 m).",
  },
  {
    what: "Role",
    scope: "partial",
    detail: "Everyone imports as a diver. Staff roles and logins are never granted by import.",
  },
  {
    what: "Medical & health history",
    scope: "never",
    detail:
      "Never imported. A cleared flag from another system is not clearance here — collect a fresh signed waiver in DiveDay.",
  },
  {
    what: "Signed waivers",
    scope: "never",
    detail: "Never imported. A waiver is evidence tied to your templates; it is re-signed here.",
  },
  {
    what: "Card on file / payment",
    scope: "never",
    detail: "Never imported — the un-migratable residue every shop resents, and we say so.",
  },
  {
    what: "Booking, trip & service history",
    scope: "never",
    detail: "Not part of the contact import. Your export carries it; the importer does not.",
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

export type PreparedCert = { agency: ImportAgency; level: ImportLevel; identifier: string };
export type PreparedNitrox = { agency: ImportAgency; identifier: string };

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
    totals: { total: 0, importable: 0, skipped: 0, withCard: 0, withNitrox: 0 },
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

    // Certification: claimed only, and only with a real card number.
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
        cert = { agency, level, identifier: certNumber };
        const statusRaw = clean(at(cells, "certification_status"))?.toLowerCase();
        const saidVerified = statusRaw
          ? ["verified", "certified", "true", "yes", "valid"].includes(statusRaw)
          : false;
        issues.push({
          level: "info",
          message: saidVerified
            ? "Card imported as claimed — the source marked it verified, but imported cards are never born verified. Staff verify at first contact."
            : "Card imported as claimed — staff verify at first contact.",
        });
        if (!agencyKnown) {
          issues.push({
            level: "info",
            message: "Certification agency unrecognized — imported as “other”.",
          });
        }
      }
    }

    // Nitrox: a claim, and only against a real card number.
    let nitrox: PreparedNitrox | null = null;
    if (isTrueish(at(cells, "nitrox_certified")) || indexOf("nitrox_certification_number") >= 0) {
      const flagged =
        isTrueish(at(cells, "nitrox_certified")) ||
        Boolean(clean(at(cells, "nitrox_certification_number")));
      const nitroxNumber = clean(at(cells, "nitrox_certification_number"));
      if (flagged && nitroxNumber) {
        nitrox = { agency, identifier: nitroxNumber };
        issues.push({
          level: "info",
          message: "Nitrox card imported as claimed — never a fill authorization until verified.",
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
    },
    fatal: null,
  };
}
