import { describe, expect, it } from "vitest";
import { auditPeopleBaseline, findUnfilteredPeopleReads } from "./check-live-people.mjs";

const lines = (source) => findUnfilteredPeopleReads(source).findings.map((finding) => finding.line);

describe("a read of people", () => {
  it("passes when its own where clause carries livePerson()", () => {
    expect(
      lines(`
        db.select()
          .from(people)
          .where(and(eq(people.shopId, shopId), livePerson()));
      `),
    ).toEqual([]);
  });

  it("passes with the clause spelled out, as src/lib must", () => {
    expect(
      lines(`
        db.select()
          .from(people)
          .where(and(eq(people.id, id), isNull(people.deletedAt)));
      `),
    ).toEqual([]);
  });

  it("passes when it says why inside the query, not above it", () => {
    expect(
      lines(`
        db.select({ name: people.fullName })
          // diveday:allow-deleted-people: a name for an activity line
          .from(people)
          .where(eq(people.id, id));
      `),
    ).toEqual([4]);
    expect(
      lines(`
        db.select({ name: people.fullName })
          .from(people)
          // diveday:allow-deleted-people: a name for an activity line
          .where(eq(people.id, id));
      `),
    ).toEqual([]);
  });

  it("is refused when nothing in it filters", () => {
    expect(
      lines(`
        db.select()
          .from(people)
          .where(eq(people.shopId, shopId));
      `),
    ).toEqual([3]);
  });

  it("is not covered by the next query's filter", () => {
    expect(
      lines(`
        const a = await db.select().from(people).where(eq(people.id, id));
        const b = await db.select().from(people).where(livePerson());
      `),
    ).toEqual([2]);
  });
});

describe("leaves alone", () => {
  it("a join to people, and the people of another table's name", () => {
    expect(
      lines(`
        db.select().from(bookings).innerJoin(people, eq(people.id, bookings.personId));
        db.select().from(peopleNotes);
      `),
    ).toEqual([]);
  });
});

describe("the baseline", () => {
  const hits = (n) => Array.from({ length: n }, (_, i) => `${i + 1}: .from(people)`);

  it("refuses a file over its allowance, and a file with none", () => {
    const failures = auditPeopleBaseline(
      new Map([
        ["src/db/a.ts", hits(2)],
        ["src/db/new.ts", hits(1)],
      ]),
      { "src/db/a.ts": 1 },
    );
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain("src/db/a.ts: 2 unfiltered reads of people, baseline allows 1");
    expect(failures[1]).toContain("src/db/new.ts: 1 unfiltered reads of people, baseline allows 0");
  });

  it("asks for a fall to be banked, and a clean file to leave the baseline", () => {
    const failures = auditPeopleBaseline(new Map([["src/db/a.ts", hits(1)]]), {
      "src/db/a.ts": 2,
      "src/db/gone.ts": 1,
    });
    expect(failures).toEqual([
      "src/db/a.ts: down to 1 from 2 — lower the baseline in this change (`node scripts/check-live-people.mjs --write`).",
      "src/db/gone.ts: clean or gone — remove its baseline entry (`node scripts/check-live-people.mjs --write`).",
    ]);
  });

  it("passes files at their allowance", () => {
    expect(auditPeopleBaseline(new Map([["src/db/a.ts", hits(2)]]), { "src/db/a.ts": 2 })).toEqual(
      [],
    );
  });
});
