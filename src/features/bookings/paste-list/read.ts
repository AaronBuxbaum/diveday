import { unguardFormula } from "@/lib/csv-formula";
import {
  importFieldForHeader,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_CELL_LENGTH,
  MAX_IMPORT_COLUMNS,
  parseCsv,
  widestRow,
} from "@/lib/import";
import {
  DIVER_NAME_MAX,
  DIVER_PHONE_MAX,
  diverEmailSchema,
  phoneDigits,
} from "@/lib/person-fields";

/**
 * **A trip's passenger list, pasted onto one departure** ("Try it Saturday",
 * item 1): rows copied out of a spreadsheet or a booking tool's manifest
 * download, or a CSV file's text, read into the people to seat.
 *
 * Name, email and phone in any column order, with a header row or without.
 * A header is read through the importer's own aliases (`importFieldForHeader`),
 * so "Customer Name", "Mobile" and "E-mail" mean here what they mean there.
 * Without one, a column is what most of its cells look like: an address, a
 * number, or words.
 *
 * Framework-free and pure: the server reads the text twice, once for the
 * preview and again on confirm, and never trusts what the browser kept.
 */

/**
 * The most people one paste seats. Bounded far below the importer's row limit
 * because each one is a seat transaction in a single request, and no boat
 * carries more than this.
 */
export const PASTE_LIST_MAX_ROWS = 200;

/**
 * The field each person's on-file choice posts under: once per person, in
 * list order, so the confirm lines the choices up with the list read again.
 */
export const PASTE_CHOICE_FIELD = "choice";

/** A contact the row had that could not be read, so it was left off. */
export type PastedContactDrop = "email" | "phone";

export type PastedPerson = {
  /** The row's number in what was pasted, from 1, header included. */
  row: number;
  fullName: string;
  email?: string;
  phone?: string;
  /** What the row carried that was not an address or a number, and is left off. */
  dropped: PastedContactDrop[];
};

/** A row left out for having no name to seat. */
export type PastedSkip = {
  /** The row's number in what was pasted, from 1, header included. */
  row: number;
  /** The row's cells as pasted, blanks dropped. */
  text: string;
};

export type PasteListRefusal =
  | "empty"
  | "too_large"
  | "too_many_columns"
  | "too_many_rows"
  | "cell_too_long"
  | "no_names";

export type PasteListRead =
  | {
      ok: true;
      people: PastedPerson[];
      /**
       * Rows with no name to seat (a blank name, one with no letters, one too
       * long to be a name), each as its cells read, so staff see what was left out.
       */
      skipped: PastedSkip[];
      /**
       * Rows that repeat an earlier one exactly, name, email and phone, and
       * carry an email or a phone: two "Maria Garcia" with nothing else may be
       * two people, and both are kept.
       */
      duplicates: number;
    }
  | { ok: false; reason: PasteListRefusal };

type Columns = { name?: number; first?: number; last?: number; email?: number; phone?: number };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_SHAPE = /^\+?[\d\s().\-/]+$/;
const LETTER = /\p{L}/u;

function looksLikeEmail(cell: string): boolean {
  return EMAIL_SHAPE.test(cell);
}

function looksLikePhone(cell: string): boolean {
  const digits = phoneDigits(cell).length;
  return PHONE_SHAPE.test(cell) && digits >= 7 && digits <= 15;
}

function looksLikeName(cell: string): boolean {
  return LETTER.test(cell) && !cell.includes("@") && !looksLikePhone(cell);
}

/**
 * A spreadsheet copies as tabs; a CSV file or a typed list uses commas, and a
 * European spreadsheet's CSV export semicolons. Read off the first line.
 */
function delimiterOf(text: string): "\t" | "," | ";" {
  const first = text.split(/\r\n?|\n/).find((line) => line.trim()) ?? "";
  if (first.includes("\t")) return "\t";
  if (first.includes(",")) return ",";
  if (first.includes(";")) return ";";
  return ",";
}

/** The header's columns, when the first row is one; null when it is a person. */
function headerColumns(first: readonly string[]): Columns | null {
  if (first.some((cell) => looksLikeEmail(cell) || looksLikePhone(cell))) return null;
  const columns: Columns = {};
  first.forEach((cell, index) => {
    const field = importFieldForHeader(cell);
    const key =
      field === "full_name"
        ? "name"
        : field === "first_name"
          ? "first"
          : field === "last_name"
            ? "last"
            : field === "email"
              ? "email"
              : field === "phone"
                ? "phone"
                : null;
    if (key && columns[key] === undefined) columns[key] = index;
  });
  return Object.keys(columns).length > 0 ? columns : null;
}

/** The share of a column's non-blank cells that pass `test`. */
function share(body: readonly string[][], column: number, test: (cell: string) => boolean) {
  const cells = body.map((row) => row[column] ?? "").filter((cell) => cell);
  if (cells.length === 0) return 0;
  return cells.filter(test).length / cells.length;
}

/** Columns read from what the cells look like, for a list with no header. */
function contentColumns(body: readonly string[][], width: number, known: Columns): Columns {
  const columns: Columns = { ...known };
  const claimed = () =>
    new Set(Object.values(columns).filter((value): value is number => value !== undefined));
  const best = (test: (cell: string) => boolean) => {
    let pick: number | undefined;
    let top = 0.5;
    for (let column = 0; column < width; column++) {
      if (claimed().has(column)) continue;
      const value = share(body, column, test);
      if (value >= top && (pick === undefined || value > top)) {
        pick = column;
        top = value;
      }
    }
    return pick;
  };
  if (columns.email === undefined) columns.email = best(looksLikeEmail);
  if (columns.phone === undefined) columns.phone = best(looksLikePhone);
  if (columns.name === undefined && columns.first === undefined && columns.last === undefined) {
    const taken = claimed();
    const nameColumns: number[] = [];
    for (let column = 0; column < width; column++) {
      if (!taken.has(column) && share(body, column, looksLikeName) >= 0.5) nameColumns.push(column);
    }
    const [first, second] = nameColumns;
    // "Ana" beside "López" is a first and a last name; "Ana López" is a name.
    const oneWord = (column: number) => share(body, column, (cell) => !/\s/.test(cell)) >= 0.8;
    if (first !== undefined && second === first + 1 && oneWord(first) && oneWord(second)) {
      columns.first = first;
      columns.last = second;
    } else if (first !== undefined) {
      columns.name = first;
    }
  }
  return columns;
}

function nameOf(row: readonly string[], columns: Columns): string {
  const parts =
    columns.name !== undefined
      ? [row[columns.name]]
      : [
          columns.first === undefined ? undefined : row[columns.first],
          columns.last === undefined ? undefined : row[columns.last],
        ];
  return parts
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Read a pasted list, or say why it could not be read. */
export function readPastedList(text: string): PasteListRead {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  const grid = parseCsv(text, delimiterOf(text))
    .map((row) => row.map((cell) => unguardFormula(cell.trim())))
    .filter((row) => row.some((cell) => cell));
  if (grid.length === 0) return { ok: false, reason: "empty" };
  const width = widestRow(grid);
  if (width > MAX_IMPORT_COLUMNS) return { ok: false, reason: "too_many_columns" };
  if (grid.some((row) => row.some((cell) => cell.length > MAX_IMPORT_CELL_LENGTH))) {
    return { ok: false, reason: "cell_too_long" };
  }
  const header = headerColumns(grid[0] ?? []);
  const body = header ? grid.slice(1) : grid;
  if (body.length > PASTE_LIST_MAX_ROWS) return { ok: false, reason: "too_many_rows" };
  const columns = contentColumns(body, width, header ?? {});
  if (columns.name === undefined && columns.first === undefined && columns.last === undefined) {
    return { ok: false, reason: "no_names" };
  }

  const people: PastedPerson[] = [];
  const seen = new Set<string>();
  const skipped: PastedSkip[] = [];
  let duplicates = 0;
  body.forEach((row, index) => {
    const rowNumber = index + 1 + (header ? 1 : 0);
    const fullName = nameOf(row, columns);
    // A name with letters is somebody, digits and all ("Ana López 2", "Sam
    // (+1)"): staff see them in the preview and leaving out a real diver is
    // the worse mistake. A booking number or a rule of dashes has no letters.
    if (!LETTER.test(fullName) || fullName.length > DIVER_NAME_MAX) {
      skipped.push({ row: rowNumber, text: row.filter((cell) => cell).join(", ") });
      return;
    }
    const dropped: PastedContactDrop[] = [];
    const emailCell = columns.email === undefined ? "" : (row[columns.email] ?? "").toLowerCase();
    const email =
      emailCell && diverEmailSchema.safeParse(emailCell).success ? emailCell : undefined;
    if (emailCell && !email) dropped.push("email");
    const phoneCell = columns.phone === undefined ? "" : (row[columns.phone] ?? "");
    const phone =
      phoneCell && phoneCell.length <= DIVER_PHONE_MAX && phoneDigits(phoneCell).length >= 5
        ? phoneCell
        : undefined;
    if (phoneCell && !phone) dropped.push("phone");
    if (email || phone) {
      const key = [fullName.toLowerCase(), email ?? "", phone ? phoneDigits(phone) : ""].join(
        "\u0000",
      );
      if (seen.has(key)) {
        duplicates++;
        return;
      }
      seen.add(key);
    }
    people.push({
      row: rowNumber,
      fullName,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      dropped,
    });
  });
  if (people.length === 0) return { ok: false, reason: "no_names" };
  return { ok: true, people, skipped, duplicates };
}
