import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPerson } from "@/db/people";
import { computerDiveProfiles, computerDives, people } from "@/db/schema";
import { unseededTestDb } from "@/test/db";
import { commitComputerFiles, recapComputerDives } from "./store";
import { computerFixture, file, selectedInput } from "./test-support";

describe("unlinked personal recap recordings", () => {
  it("keeps both DST repeated-hour recordings distinct and ordered by instant", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    for (const [id, offset] of [
      ["first", -240],
      ["second", -300],
    ] as const) {
      const source = file(id);
      source.bytes = new TextEncoder().encode(
        new TextDecoder()
          .decode(source.bytes)
          .replace("2026-01-01T23:50:00", "2026-11-01T01:30:00"),
      );
      const input = await selectedInput(db, scope, [source]);
      await commitComputerFiles(db, scope, {
        ...input,
        timeOffsets: Object.fromEntries(input.selectedKeys.map((key) => [key, offset])),
      });
    }
    const found = await recapComputerDives(db, {
      ...scope,
      date: "2026-11-01",
      timeZone: "America/New_York",
    });
    expect(found.dives.map((dive) => dive.startInstant)).toEqual([
      "2026-11-01T05:30:00.000Z",
      "2026-11-01T06:30:00.000Z",
    ]);
    expect(found.dives.map((dive) => dive.localStart)).toEqual([
      "2026-11-01T01:30:00",
      "2026-11-01T01:30:00",
    ]);
  });

  it("never substitutes an unrelated same-day crew recording, even with a profile", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    const guide = await createPerson(db, {
      shopId: scope.shopId,
      fullName: "Guide",
      email: null,
      phone: null,
      origin: "seed",
    });
    const crewScope = { ...scope, personId: guide.id };
    await commitComputerFiles(db, crewScope, await selectedInput(db, crewScope));
    const [row] = await db.select().from(computerDives);
    await db.insert(computerDiveProfiles).values({
      shopId: scope.shopId,
      personId: guide.id,
      diveId: row.id,
      samples: [
        { seconds: 0, depthMeters: 0 },
        { seconds: 60, depthMeters: 12 },
      ],
    });
    const input = { ...scope, crewPersonIds: [guide.id], date: "2026-01-01", timeZone: "UTC" };
    expect((await recapComputerDives(db, input)).dives).toEqual([]);
  });

  it("uses the shop date of a known instant across midnight, preserving the original wall time", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    const input = await selectedInput(db, scope);
    await commitComputerFiles(db, scope, {
      ...input,
      timeOffsets: Object.fromEntries(input.selectedKeys.map((key) => [key, -300])),
    });
    const day = { ...scope, crewPersonIds: [], timeZone: "UTC" };
    expect((await recapComputerDives(db, { ...day, date: "2026-01-01" })).dives).toEqual([]);
    const found = await recapComputerDives(db, { ...day, date: "2026-01-02" });
    expect(found.dives).toHaveLength(1);
    expect(found.dives[0]).toMatchObject({
      localStart: "2026-01-01T23:50:00",
      startInstant: "2026-01-02T04:50:00.000Z",
    });
    expect(
      (await recapComputerDives(db, { ...day, date: "2026-01-01", timeZone: "America/New_York" }))
        .dives,
    ).toHaveLength(1);
  });

  it("keeps unknown-zone wall dates and date-only records without inventing instants", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    await commitComputerFiles(db, scope, await selectedInput(db, scope));
    const day = { ...scope, crewPersonIds: [], timeZone: "Pacific/Kiritimati" };
    const found = await recapComputerDives(db, { ...day, date: "2026-01-01" });
    expect(found.dives[0]).toMatchObject({ localStart: "2026-01-01T23:50:00", startInstant: null });
    expect((await recapComputerDives(db, { ...day, date: "2026-01-02" })).dives).toEqual([]);
    const [row] = await db.select().from(computerDives);
    await db
      .update(computerDives)
      .set({ record: { ...row.record, localStart: null, localDate: "2026-01-01" } })
      .where(eq(computerDives.id, row.id));
    expect((await recapComputerDives(db, { ...day, date: "2026-01-01" })).dives[0]).toMatchObject({
      localStart: null,
      localDate: "2026-01-01",
      startInstant: null,
    });
  });

  it("excludes other tenants and erased or deleted people, and rejects a mismatched profile owner", async () => {
    const db = await unseededTestDb();
    const scope = await computerFixture(db);
    const other = await computerFixture(db);
    await commitComputerFiles(db, scope, await selectedInput(db, scope));
    const day = { ...scope, crewPersonIds: [], date: "2026-01-01", timeZone: "UTC" };
    expect((await recapComputerDives(db, { ...day, shopId: other.shopId })).dives).toEqual([]);
    const [row] = await db.select().from(computerDives);
    await db.insert(computerDiveProfiles).values({
      shopId: scope.shopId,
      personId: scope.actorPersonId,
      diveId: row.id,
      samples: [{ seconds: 0, depthMeters: 99 }],
    });
    expect((await recapComputerDives(db, day)).dives[0].samples).toEqual([]);
    await db
      .update(people)
      .set({ deletedAt: new Date("2026-01-03T00:00:00Z") })
      .where(eq(people.id, scope.personId));
    expect((await recapComputerDives(db, day)).dives).toEqual([]);
    await db
      .update(people)
      .set({ anonymizedAt: new Date("2026-01-03T00:00:00Z") })
      .where(eq(people.id, scope.personId));
    expect((await recapComputerDives(db, day)).dives).toEqual([]);
  });
});
