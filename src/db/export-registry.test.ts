import { readFileSync } from "node:fs";
import { and, eq, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { schemaTableNameOf } from "@/test/schema-tables";
import { stripCommentsAndStrings } from "./erasure-source.test-support";
import { loadDiverExportBundleInput } from "./export";
import { diverOwnRows, EXPORT_TABLES, type ExportTableRead } from "./export-tables";
import { addDiverNote } from "./operations";
import {
  assertDiverExportColumn,
  exportFate,
  PERSON_COLUMNS,
  type PersonColumn,
  personColumnKey,
} from "./person-columns";
import * as schema from "./schema";
import {
  bookings,
  internalNotes,
  people,
  personRoles,
  staffCredentials,
  tripReviews,
} from "./schema";

const ctx = fileScopedShopContext();

/** `table.column` (database names) for an identifier and a property, or null. */
function columnKeyOf(identifier: string, property: string): string | null {
  const table = schemaTableNameOf(identifier);
  if (!table) return null;
  const column = (schema as unknown as Record<string, Record<string, { name?: unknown }>>)[
    identifier
  ]?.[property]?.name;
  return typeof column === "string" ? `${table}.${column}` : null;
}

/** The diver loader's body, comments and strings stripped. */
function loaderBody(): string {
  const source = stripCommentsAndStrings(readFileSync("src/db/export.ts", "utf8"));
  const start = source.search(/^async function loadDiverExportContext\(/m);
  expect(start).toBeGreaterThan(0);
  return source.slice(start, source.indexOf("\n}\n", start));
}

/**
 * Every `diverOwnRows(<table>.<column>, personId)` in the diver loader, as
 * `table.column`: the reads it makes by the diver's own id that are written
 * out rather than taken through the read list. Each one asserts the registry
 * at run time too.
 */
function loaderReadsByPersonId(): string[] {
  return [...loaderBody().matchAll(/\bdiverOwnRows\(\s*(\w+)\.(\w+)\s*,\s*personId\s*\)/g)].map(
    (match) =>
      columnKeyOf(match[1] as string, match[2] as string) ?? `${match[1]}.${match[2]} (unknown)`,
  );
}

/**
 * Every comparison against the diver's id in the loader that does not go
 * through `diverOwnRows`, whichever side or spelling it takes: `eq(x, personId)`,
 * `eq(personId, x)`, `inArray(x, [personId])`, or the same by `person.id`.
 */
function loaderRawReadsByPersonId(): string[] {
  const id = String.raw`(?:personId|person\.id|scope\.personId)`;
  const raw = new RegExp(
    String.raw`\b(?:eq|ne|inArray)\(\s*(?:[\w.]+\s*,\s*\[?\s*${id}\b|${id}\s*,)[^)]*\)`,
    "g",
  );
  return [...loaderBody().matchAll(raw)].map((match) => match[0].replace(/\s+/g, " "));
}

/** Every column the read list takes a diver's rows by, as `table.column`. */
function readListPersonColumns(): string[] {
  return Object.values(EXPORT_TABLES as Record<string, ExportTableRead>).flatMap(
    ({ table, scope }) =>
      scope.personColumn ? [`${getTableName(table)}.${scope.personColumn.name}`] : [],
  );
}

/**
 * The registry's `export` column (`./person-columns`, issue #2724) against the
 * diver's own bundle (`loadDiverExportBundleInput`, ADR
 * 20260824-diver-record-export). Each person column says whether that bundle
 * reads a diver's rows by it as theirs, and these hold the claim to the code
 * both ways: a column the registry calls theirs is read, and nothing is read
 * by the diver's id that the registry has not called theirs.
 */
describe("the registry's export fates", () => {
  it("states a fate for every subject column, and why it withholds a subject or crew one", () => {
    const wrong: string[] = [];
    for (const row of PERSON_COLUMNS) {
      const key = personColumnKey(row);
      let fate: string;
      try {
        fate = exportFate(row);
      } catch (error) {
        wrong.push(`${key}: ${(error as Error).message}`);
        continue;
      }
      if (
        (row.kind === "subject" || row.kind === "crew") &&
        fate === "withheld" &&
        !row.exportWhy
      ) {
        wrong.push(`${key}: withheld without a reason`);
      }
      if (row.exportWhy && fate !== "withheld") wrong.push(`${key}: a reason on a column it reads`);
    }
    expect(wrong).toEqual([]);
    expect(PERSON_COLUMNS.filter((row) => exportFate(row) === "own").length).toBeGreaterThan(10);
  });

  /**
   * Adversarial: who recorded, created or signed a row is a staffer, and the
   * rows they wrote are about other people. A registry row that called an
   * actor or login column the diver's own would hand them those rows.
   */
  it("refuses to call an actor or login column a diver's own", () => {
    const actor: PersonColumn = {
      table: "internal_notes",
      column: "created_by_person_id",
      kind: "actor",
      merge: "leave",
      why: "who wrote the note",
      export: "own",
    };
    expect(() => exportFate(actor)).toThrow(/actor/);
    expect(() => exportFate({ ...actor, kind: "login" })).toThrow(/login/);
    expect(() => exportFate({ ...actor, kind: "subject", export: undefined })).toThrow(/states no/);
    expect(exportFate({ ...actor, export: undefined })).toBe("withheld");
    expect(
      PERSON_COLUMNS.filter(
        (row) => row.export === "own" && !["subject", "crew"].includes(row.kind),
      ).map(personColumnKey),
    ).toEqual([]);
  });

  it("reads a diver's rows from the read list only by a column the registry calls theirs", () => {
    const own = new Set(
      PERSON_COLUMNS.filter((row) => exportFate(row) === "own").map(personColumnKey),
    );
    const listed = readListPersonColumns();
    expect(listed.length).toBeGreaterThan(10);
    expect(listed.filter((key) => !own.has(key))).toEqual([]);
  });

  it("reads nothing by the diver's id that the registry has not called theirs", () => {
    const own = new Set(
      PERSON_COLUMNS.filter((row) => exportFate(row) === "own").map(personColumnKey),
    );
    const reads = loaderReadsByPersonId();
    expect(reads.length).toBeGreaterThanOrEqual(4);
    expect(reads.filter((key) => !own.has(key))).toEqual([]);
  });

  /**
   * Adversarial: a hand-written read by the diver's id that skips
   * `diverOwnRows` skips the registry. The profile itself (`people.id`) is the
   * one such read, and it is not a person column.
   */
  it("reads by the diver's id only through diverOwnRows, the profile aside", () => {
    expect(loaderRawReadsByPersonId()).toEqual(["eq(people.id, personId)"]);
  });

  it("reads every column the registry calls theirs", () => {
    const read = new Set([...readListPersonColumns(), ...loaderReadsByPersonId()]);
    expect(
      PERSON_COLUMNS.filter((row) => exportFate(row) === "own")
        .map(personColumnKey)
        .filter((key) => !read.has(key)),
    ).toEqual([]);
  });

  it("refuses at read time a diver read by a column it has not called theirs", () => {
    expect(() => assertDiverExportColumn("cards", "person_id")).not.toThrow();
    expect(() => assertDiverExportColumn("internal_notes", "person_id")).toThrow(/withheld/);
    expect(() => assertDiverExportColumn("capabilities", "person_id")).toThrow(/withheld/);
    expect(() => assertDiverExportColumn("waiver_records", "recorded_by_person_id")).toThrow(
      /withheld/,
    );
    expect(() => assertDiverExportColumn("cards", "no_such_person_id")).toThrow(/no registry row/);
    // The loader's own hand-written reads take the same check.
    expect(() => diverOwnRows(tripReviews.personId, "p")).not.toThrow();
    expect(() => diverOwnRows(internalNotes.personId, "p")).toThrow(/withheld/);
    expect(() => diverOwnRows(staffCredentials.personId, "p")).toThrow(/withheld/);
  });

  /**
   * The same claim against a real bundle, on the column it matters most for:
   * a note about a diver is withheld from the diver it is about, and a note a
   * staffer wrote is not theirs to take either, though their id is on it.
   */
  it("carries no staff note into the bundle of the diver it names or of the staffer who wrote it", async () => {
    const { db, shop } = ctx;
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    const [seat] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.shopId, shop.id))
      .limit(1);
    if (!owner || !seat) throw new Error("expected the seeded owner and a diver with a seat");
    const about = "Kept losing a fin strap on the wall; check the spring straps.";
    const onOwner = "Owner prefers the early boat when the wind is up.";
    expect(
      await addDiverNote(db, {
        shopId: shop.id,
        personId: seat.personId,
        actorPersonId: owner.id,
        body: about,
      }),
    ).not.toBeNull();
    expect(
      await addDiverNote(db, {
        shopId: shop.id,
        personId: owner.id,
        actorPersonId: owner.id,
        body: onOwner,
      }),
    ).not.toBeNull();

    for (const personId of [seat.personId, owner.id]) {
      const input = await loadDiverExportBundleInput(db, shop.id, personId);
      if (!input) throw new Error("export failed to load");
      const text = JSON.stringify(input);
      expect([personId, text.includes(about), text.includes(onOwner)]).toEqual([
        personId,
        false,
        false,
      ]);
    }
  });
});
