import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFiles, stripComments } from "@/test/source";

/**
 * **A booking link reaches its row only through the token door** (issue #2711,
 * ADR 20261104-derived-booking-link-tokens). A link carries its row's id in the
 * clear, so a lookup written as "take the id, `where id = $1`" without the tag
 * check would make any id a key. `src/db/booking-capabilities.ts` is the one
 * module that turns a token into a row (`parseVerifiedCapabilityToken`, then
 * purpose and key version); no other source file may filter
 * `booking_capabilities` by its id, in any spelling.
 *
 * So outside the door, `bookingCapabilities.id` may appear only as a
 * projection (`{ id: bookingCapabilities.id }`) or a sort key, the table may
 * not be aliased, re-bound, destructured or indexed, and its SQL name may not
 * appear in raw SQL. Each remaining use is listed below with its reason (code
 * security review of #2711, finding 5).
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const DOOR = "src/db/booking-capabilities.ts";

/** Files that name the table's SQL name as a plain identifier, never in a query. */
const SQL_NAME_ALLOWED = new Set([
  // The table and its constraint names.
  "src/db/schema/bookings.ts",
  // Retention windows keyed by table name.
  "src/features/retention/rules.ts",
  "src/features/retention/store.ts",
]);

/**
 * Files that hand the table to generic machinery. The retention prune takes
 * `{ from: bookingCapabilities, id: bookingCapabilities.id }` and deletes rows
 * by their own expiry clock, never from a token.
 */
const REBIND_ALLOWED = new Set(["src/features/retention/store.ts"]);

/** `bookingCapabilities.id` as a projection key or a sort key: reads, never filters. */
const ALLOWED_ID_USE = [
  /\b\w+:\s*(?:schema\.)?bookingCapabilities\.id\b(?=\s*[,}\n])/g,
  /\borderBy\(\s*(?:schema\.)?bookingCapabilities\.id\s*\)/g,
];

/** What a source file does that would let an id reach a row without the door. */
function doorViolations(source: string, file: string): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  let rest = code;
  for (const allowed of ALLOWED_ID_USE) rest = rest.replace(allowed, "");
  if (/\bbookingCapabilities\.id\b/.test(rest))
    found.push("bookingCapabilities.id outside a projection or sort");
  if (/\bbookingCapabilities\s*\[/.test(code)) found.push("bookingCapabilities indexed by name");
  if (/\balias\(\s*(?:schema\.)?bookingCapabilities\b/.test(code)) found.push("aliased table");
  if (
    !REBIND_ALLOWED.has(file) &&
    /(?:=|:)\s*(?:schema\.)?bookingCapabilities\s*[;,)\n]/.test(code)
  )
    found.push("table re-bound to another name");
  if (/\}\s*=\s*(?:schema\.)?bookingCapabilities\b/.test(code)) found.push("table destructured");
  if (/getTableColumns\(\s*(?:schema\.)?bookingCapabilities\b/.test(code))
    found.push("columns taken off the table");
  if (!SQL_NAME_ALLOWED.has(file)) {
    const bare = code
      .replace(/(["'`])booking_capabilities(?:_\w+)?\1/g, "")
      .replace(/\bbooking_capabilities\s*:/g, "");
    if (/\bbooking_capabilities\b/.test(bare)) found.push("booking_capabilities in raw SQL");
  }
  return found;
}

describe("the booking link door", () => {
  it("is the only module that can filter booking_capabilities by id", () => {
    const offenders = sourceFiles(path.join(ROOT, "src"))
      .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
      .filter((file) => file !== DOOR)
      .flatMap((file) =>
        doorViolations(readFileSync(path.join(ROOT, file), "utf8"), file).map(
          (why) => `${file}: ${why}`,
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("still sees the door's own lookups, so the pattern matches what it guards", () => {
    expect(doorViolations(readFileSync(path.join(ROOT, DOOR), "utf8"), DOOR)).not.toEqual([]);
  });

  it.each([
    ["eq(bookingCapabilities.id, rowId)"],
    ["eq(rowId, bookingCapabilities.id)"],
    ["inArray(schema.bookingCapabilities.id, ids)"],
    ["and(isNull(x), ne(y, bookingCapabilities.id))"],
    ["sql`${bookingCapabilities.id} = ${rowId}`"],
    ['bookingCapabilities["id"]'],
    ["const links = alias(bookingCapabilities, 'l');"],
    ["const table = bookingCapabilities;"],
    ["const { id } = bookingCapabilities;"],
    ["getTableColumns(bookingCapabilities)"],
    ["sql`select 1 from booking_capabilities where id = ${rowId}`"],
    ["db.execute(sql.raw('delete from booking_capabilities where id = ' + id))"],
  ])("catches %s", (line) => {
    expect(doorViolations(line, "src/db/elsewhere.ts")).not.toEqual([]);
  });

  it.each([
    ["tx.select({ id: bookingCapabilities.id }).from(bookingCapabilities)"],
    [".orderBy(bookingCapabilities.id)"],
    ['const name = "booking_capabilities";'],
    ["// eq(bookingCapabilities.id, rowId) in a comment"],
  ])("allows %s", (line) => {
    expect(doorViolations(line, "src/db/elsewhere.ts")).toEqual([]);
  });
});
