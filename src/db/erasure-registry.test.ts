import { readFileSync } from "node:fs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { schemaTableNameOf } from "@/test/schema-tables";
import { anonymizeDiver } from "../features/anonymize/store";
import { ERASURE_KEEPS } from "../test/substrate-fixtures/db/erasure-coverage-keeps.test-support";
import {
  erasureSweepText,
  registryDeletesRun,
  stripCommentsAndStrings,
} from "../test/substrate-fixtures/db/erasure-source.test-support";
import {
  erasedPersonRowDeletes,
  eraseFate,
  PERSON_COLUMNS,
  personColumnKey,
} from "./person-columns";
import * as schema from "./schema";
import { bookings, people, personRoles } from "./schema";

const ctx = fileScopedShopContext({ history: true });

/** Follow the sweep's actual module location, including named feature contracts. */
function sweepText(sweep: string): string {
  return erasureSweepText("src/features/anonymize/store.ts", sweep, (file) => {
    try {
      return readFileSync(file, "utf8");
    } catch (error) {
      if (["ENOENT", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? ""))
        return undefined;
      throw error;
    }
  });
}

/** The schema identifiers (`waiverRecords`) a database table name is exported as. */
function schemaIdentifiersOf(table: string): string[] {
  return Object.keys(schema).filter((identifier) => schemaTableNameOf(identifier) === table);
}

const camel = (column: string) =>
  column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/**
 * Whether a sweep's text reaches `table` by `column`: it writes the table and
 * names the column on it (`bookings.flySafeAcknowledgedByPersonId`), so a sweep
 * that still writes the table for some other reason no longer passes for one
 * that stopped clearing this column.
 */
function sweepReaches(sweep: string, table: string, column: string): boolean {
  const text = sweepText(sweep);
  const identifiers = schemaIdentifiersOf(table);
  const writes = identifiers.some((identifier) =>
    new RegExp(`\\.(?:update|delete)\\(\\s*${identifier}\\s*\\)`).test(text),
  );
  return (
    writes && identifiers.some((identifier) => text.includes(`${identifier}.${camel(column)}`))
  );
}

/** Tables whose rows are evidence a shop keeps: never a plain registry delete. */
const NEVER_PLAIN_DELETED = [
  "bookings",
  "waiver_records",
  "course_form_records",
  "roll_call_events",
  "incident_reports",
  "incident_report_people",
  "incident_report_addenda",
  "staff_credentials",
  "executed_dives",
  "trip_assignments",
  "cards",
  "orders",
];

/**
 * The registry's `erase` column (`./person-columns`, issue #2724) against the
 * code it describes. A fate is a claim, and these make each kind of claim
 * fail on the day it stops being true: a named sweep that is gone or no longer
 * writes the table, a `keep` on a table the erasure does write with no word
 * on why, a plain delete on a table that cannot be scoped to one shop.
 */
describe("the registry's erase fates", () => {
  const sweeps = new Set(
    [
      ...readFileSync("src/features/anonymize/store.ts", "utf8").matchAll(
        /^async function (scrub\w+)\(/gm,
      ),
    ].map((match) => match[1] as string),
  );

  it("gives every column a fate", () => {
    expect(
      PERSON_COLUMNS.filter((row) => {
        try {
          eraseFate(row);
          return false;
        } catch {
          return true;
        }
      }).map(personColumnKey),
    ).toEqual([]);
  });

  it("names, for every delete, scrub or null, a sweep that writes the table", () => {
    const wrong: string[] = [];
    for (const row of PERSON_COLUMNS) {
      const fate = eraseFate(row);
      if (fate === "keep") {
        if (row.eraseIn) wrong.push(`${personColumnKey(row)}: keep names a sweep`);
        continue;
      }
      if (!row.eraseIn) {
        if (fate !== "delete") wrong.push(`${personColumnKey(row)}: ${fate} names no sweep`);
        continue;
      }
      if (!sweeps.has(row.eraseIn)) {
        wrong.push(`${personColumnKey(row)}: no sweep ${row.eraseIn}`);
      } else if (!sweepReaches(row.eraseIn, row.table, row.eraseBy ?? row.column)) {
        wrong.push(`${personColumnKey(row)}: ${row.eraseIn} does not reach ${row.table} by it`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("says why it keeps a column of a table the erasure writes", () => {
    // A subject column always says why in its own words: a keep-listed table can
    // gain a column holding the diver's own data, and the table's reason was
    // written before it existed.
    const unexplained = PERSON_COLUMNS.filter(
      (row) =>
        eraseFate(row) === "keep" &&
        row.kind !== "actor" &&
        !row.eraseWhy &&
        (row.kind === "subject" || !(row.table in ERASURE_KEEPS)),
    ).map(personColumnKey);
    expect(unexplained).toEqual([]);
    expect(
      PERSON_COLUMNS.filter((row) => row.eraseWhy && eraseFate(row) !== "keep").map(
        personColumnKey,
      ),
    ).toEqual([]);
    // A keep-listed table the erasure writes is already refused above; this is
    // the column-level half: a table the keep-list answers for is one no row
    // claims the erasure deletes, scrubs or clears.
    expect(
      PERSON_COLUMNS.filter((row) => row.table in ERASURE_KEEPS && eraseFate(row) !== "keep").map(
        personColumnKey,
      ),
    ).toEqual([]);
  });

  it("runs its plain deletes, and only on tables scoped to one shop", () => {
    const plain = erasedPersonRowDeletes();
    expect(plain.length).toBeGreaterThan(2);
    const source = stripCommentsAndStrings(readFileSync("src/features/anonymize/store.ts", "utf8"));
    expect(registryDeletesRun(source)).toBe(true);
    expect(plain.filter(({ table }) => NEVER_PLAIN_DELETED.includes(table))).toEqual([]);
    // Adversarial: a plain delete on anything but the subject's own rows refuses to list.
    expect(
      PERSON_COLUMNS.filter(
        (row) => row.kind !== "subject" && eraseFate(row) === "delete" && !row.eraseIn,
      ),
    ).toEqual([]);
    expect(
      plain
        .filter(({ table, column }) => {
          const config = Object.values(schema).flatMap((value) => {
            try {
              return [getTableConfig(value as Parameters<typeof getTableConfig>[0])];
            } catch {
              return [];
            }
          });
          const columns =
            config.find((found) => found.name === table)?.columns.map((found) => found.name) ?? [];
          return !columns.includes("shop_id") || !columns.includes(column);
        })
        .map(personColumnKey),
    ).toEqual([]);
  });

  /**
   * The registry loop against a real database. Adversarial on the half that
   * matters most for a loop with no table named in it: it reaches the erased
   * diver's rows and nobody else's, and leaves none of theirs behind in any
   * table it covers, including one added to the registry after this was written.
   */
  it("deletes the erased diver's plain rows and leaves another diver's", async () => {
    const { db, shop } = ctx;
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    const seats = await db
      .select({ id: bookings.id, personId: bookings.personId, tripId: bookings.tripId })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(
        and(eq(bookings.shopId, shop.id), isNull(people.anonymizedAt), isNull(people.deletedAt)),
      )
      .orderBy(bookings.personId);
    const erased = seats[0];
    const other = seats.find((seat) => seat.personId !== erased?.personId);
    if (!erased || !other) throw new Error("expected two seeded divers holding seats");
    // A record merged into the erased diver, still holding a note a writer
    // left on it after the merge: the erasure takes it with the survivor's.
    const [shell] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Merged Away Diver",
        mergedIntoPersonId: erased.personId,
        mergedAt: nowDate(),
        mergedByPersonId: owner.id,
        deletedAt: nowDate(),
      })
      .returning({ id: people.id });
    if (!shell) throw new Error("fixture insert failed");
    await db.insert(schema.internalNotes).values({
      shopId: shop.id,
      personId: shell.id,
      body: "titanium hip, runs heavy",
      createdByPersonId: owner.id,
    });
    for (const seat of [erased, other]) {
      await db
        .insert(schema.rentalFitProfiles)
        .values({ shopId: shop.id, personId: seat.personId, bcdSize: "M", finSize: "M" })
        .onConflictDoNothing();
      await db.insert(schema.lostItems).values({
        shopId: shop.id,
        tripId: seat.tripId,
        bookingId: seat.id,
        personId: seat.personId,
        description: "a blue mask in a red case",
      });
      await db.insert(schema.internalNotes).values({
        shopId: shop.id,
        personId: seat.personId,
        body: "prefers the bow",
        createdByPersonId: owner.id,
      });
    }

    const result = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: erased.personId,
      actorPersonId: owner.id,
    });
    expect(result.ok).toBe(true);

    const left = async (personId: string) => {
      const counts: Record<string, number> = {};
      for (const { table, column } of erasedPersonRowDeletes()) {
        const found = await db.execute(
          sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${personId}`,
        );
        counts[`${table}.${column}`] = (found.rows[0] as { n: number }).n;
      }
      return counts;
    };
    expect(await left(erased.personId)).toEqual(
      Object.fromEntries(erasedPersonRowDeletes().map((row) => [personColumnKey(row), 0])),
    );
    expect(await left(shell.id)).toEqual(
      Object.fromEntries(erasedPersonRowDeletes().map((row) => [personColumnKey(row), 0])),
    );
    // Every registry delete was seeded for the other diver too, so each count
    // below proves the loop left somebody else's rows, not that there were none.
    const otherLeft = await left(other.personId);
    expect(Object.entries(otherLeft).filter(([, n]) => n === 0)).toEqual([]);
  });
});

describe("sweep helper write proof", () => {
  const entry = "src/features/anonymize/store.ts";
  const fixture = new Map([
    [
      entry,
      `import { forgetPeople as clearPeople } from "@/features/plans";
async function scrubPlans(tx) {
  await clearPeople(tx);
}
`,
    ],
    ["src/features/plans/index.ts", 'export { clearPlans as forgetPeople } from "./store";'],
    [
      "src/features/plans/store.ts",
      `export async function clearPlans(tx) {
  await tx.update(bookings).set({ instructor: null }).where(eq(bookings.personId, id));
}
export async function unusedNeighbor(tx) {
  await tx.delete(tripAssignments).where(eq(tripAssignments.personId, id));
}
`,
    ],
  ]);
  const proof = (sources: Map<string, string>) =>
    erasureSweepText(entry, "scrubPlans", (file) => sources.get(file));

  it("follows the called named helper through its feature contract, including aliases", () => {
    const text = proof(fixture);
    expect(text).toContain(".update(bookings)");
    expect(text).toContain("bookings.personId");
    expect(text).not.toContain(".delete(tripAssignments)");
  });

  it("does not borrow a neighboring writer when the selected helper stops erasing", () => {
    const broken = new Map(fixture);
    broken.set(
      "src/features/plans/store.ts",
      `export async function clearPlans(tx) {
  return [];
}
export async function unusedNeighbor(tx) {
  await tx.update(bookings).where(eq(bookings.personId, id));
}
`,
    );
    expect(proof(broken)).not.toContain(".update(bookings)");
  });

  it("does not credit an uncalled import, a quoted call, or a re-export cycle", () => {
    const uncalled = new Map(fixture);
    uncalled.set(
      entry,
      `import { forgetPeople as clearPeople } from "@/features/plans";
async function scrubPlans(tx) {
  // await clearPeople(tx);
  const example = "clearPeople(tx)";
}
`,
    );
    expect(proof(uncalled)).not.toContain(".update(bookings)");
    const cyclic = new Map(fixture);
    cyclic.set("src/features/plans/index.ts", 'export { forgetPeople } from "./index";');
    expect(proof(cyclic)).not.toContain(".update(bookings)");
  });
});
