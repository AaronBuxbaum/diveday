import { asc, eq, inArray, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import type { DbExecutor } from "./client";
import { createPerson } from "./people";
import { rollCallEvents, shops, tripAssignments, trips } from "./schema";
import { type SeedRollCallEvidenceInput, seedRollCallEvidence } from "./seed-roll-call-evidence";

describePostgres("batched fixture evidence on the real PostgreSQL sequence", () => {
  it("holds the trip lock and preserves scalar projections when defaults are below an explicit revision", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({
        name: "Sequence author",
        slug: `sequence-author-${crypto.randomUUID()}`,
        timezone: "UTC",
        isDemo: true,
      })
      .returning();
    if (!shop) throw new Error("fixture shop missing");
    const at = nowDate();
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Sequence author departure",
        startsAt: at,
        endsAt: new Date(at.getTime() + 3_600_000),
        capacity: 4,
      })
      .returning();
    if (!trip) throw new Error("fixture trip missing");
    const captain = await createPerson(pg.db, {
      shopId: shop.id,
      fullName: "Sequence captain",
      email: null,
      phone: null,
      origin: "waitlist",
      roles: ["captain"],
    });
    await pg.db.insert(tripAssignments).values({ tripId: trip.id, personId: captain.id });
    const base = {
      shopId: shop.id,
      tripId: trip.id,
      crewPersonId: captain.id,
      subjectKind: "crew" as const,
      recordedByPersonId: captain.id,
      checkpoint: "after_dive_1",
      meetingDay: 0,
      occurredAt: at,
    };
    const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    const [initial] = await seedRollCallEvidence(pg.db, { ...base, id: ids[0], status: "boarded" });
    const high = initial.seq + 1_000;
    await seedRollCallEvidence(pg.db, {
      ...base,
      id: ids[1],
      seq: high,
      status: "not_boarded",
      note: "Original missing report",
    });
    const events: SeedRollCallEvidenceInput[] = [
      { ...base, id: ids[2], status: "boarded" },
      { ...base, id: ids[3], status: "not_boarded" },
    ];
    const read = async (db: DbExecutor) =>
      (
        await db
          .select()
          .from(rollCallEvents)
          .where(inArray(rollCallEvents.id, ids))
          .orderBy(asc(rollCallEvents.id))
      ).map(({ seq: _seq, ...row }) => row);
    let scalar: Awaited<ReturnType<typeof read>> = [];
    const scalarReturned: Omit<typeof rollCallEvents.$inferSelect, "seq">[] = [];
    const rollback = new Error("discard scalar PostgreSQL oracle");
    await expect(
      pg.db.transaction(async (tx) => {
        for (const event of events) {
          const [{ seq: _seq, ...row }] = await seedRollCallEvidence(tx, event, {
            observesPrevious: true,
          });
          scalarReturned.push(row);
        }
        scalar = await read(tx);
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    const gate = await holdRowLock(pg, sql`select id from trips where id = ${trip.id} for update`);
    const pending = seedRollCallEvidence(pg.connect(), events, { observesPrevious: true });
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      await gate.release();
    }
    const batch = await pending;
    expect(batch.map(({ seq: _seq, ...row }) => row)).toEqual(scalarReturned);
    expect(await read(pg.db)).toEqual(scalar);
    expect(batch[0].seq).toBeLessThan(batch[1].seq);
    expect(batch[1].seq).toBeLessThan(high);
    const [retained] = await pg.db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.id, ids[1]));
    expect(retained).toMatchObject({
      seq: high,
      statementStatus: "not_boarded",
      note: "Original missing report",
    });
  });
});
