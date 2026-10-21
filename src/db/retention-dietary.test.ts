import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { DAY_MS, nowDate } from "@/lib/clock";
import { DIETARY_NOTE_RETENTION_DAYS } from "@/lib/retention";
import { fileScopedShopContext, seededShopContext } from "@/test/db";
import {
  clearExpiredDietaryNotes,
  drainExpiredDietaryNotes,
  pruneExpiredRecords,
} from "./retention";
import { bookings, people, trips } from "./schema";

const ctx = fileScopedShopContext();
const NOW = nowDate();
afterEach(() => vi.restoreAllMocks());

async function seats(db: AppDb, shopId: string, daysAgo: number[], deleted = false) {
  const [diver] = await db.insert(people).values({ shopId, fullName: "Lunch Keeper" }).returning();
  const departures = await db
    .insert(trips)
    .values(
      daysAgo.map((age) => {
        const startsAt = new Date(NOW.getTime() - age * DAY_MS);
        return {
          shopId,
          title: "Lunch boat",
          startsAt,
          endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
          capacity: 6,
          lunchAboard: true,
          deletedAt: deleted ? NOW : null,
        };
      }),
    )
    .returning();
  return db
    .insert(bookings)
    .values(
      departures.map((trip) => ({
        bookedAs: "diver" as const,
        shopId,
        tripId: trip.id,
        personId: diver.id,
        dietaryNote: "Private dietary words",
      })),
    )
    .returning();
}

async function stored(db: AppDb, ids: string[]) {
  return db.select().from(bookings).where(inArray(bookings.id, ids));
}

/** The daily sweep clears food notes; it never removes the seats or their status. */
describe("dietary retention", () => {
  it("leaves dietary notes entirely to the daily pass, even after weekly table pruning", async () => {
    const [seat] = await seats(ctx.db, ctx.shop.id, [DIETARY_NOTE_RETENTION_DAYS + 1]);
    const summary = await pruneExpiredRecords(ctx.db, { now: NOW });
    expect(summary).not.toHaveProperty("dietaryNotesCleared");
    expect((await stored(ctx.db, [seat.id]))[0]?.dietaryNote).toBe("Private dietary words");
  });

  it("drains several bounded batches, including deleted departures, while preserving the strict cutoff", async () => {
    const old = await seats(
      ctx.db,
      ctx.shop.id,
      Array(5).fill(DIETARY_NOTE_RETENTION_DAYS + 1),
      true,
    );
    const keep = await seats(ctx.db, ctx.shop.id, [
      DIETARY_NOTE_RETENTION_DAYS,
      DIETARY_NOTE_RETENTION_DAYS - 1,
      -1,
    ]);
    expect(await drainExpiredDietaryNotes(ctx.db, { now: NOW, batchLimit: 2 })).toEqual({
      cleared: 5,
      capped: false,
      failed: false,
    });
    const cleared = await stored(
      ctx.db,
      old.map((seat) => seat.id),
    );
    expect(cleared).toHaveLength(5);
    for (const row of cleared) {
      expect(row.dietaryNote).toBeNull();
      expect(row.status).toBe(old.find((seat) => seat.id === row.id)?.status);
    }
    expect(
      (
        await stored(
          ctx.db,
          keep.map((seat) => seat.id),
        )
      ).every((row) => row.dietaryNote === "Private dietary words"),
    ).toBe(true);
    expect(await drainExpiredDietaryNotes(ctx.db, { now: NOW, batchLimit: 2 })).toEqual({
      cleared: 0,
      capped: false,
      failed: false,
    });
  });

  it("one batch counts only notes actually cleared and a repeat reports zero", async () => {
    const old = await seats(ctx.db, ctx.shop.id, [31, 31, 31]);
    expect(await clearExpiredDietaryNotes(ctx.db, NOW, 2)).toBe(2);
    expect(await clearExpiredDietaryNotes(ctx.db, NOW, 2)).toBe(1);
    expect(await clearExpiredDietaryNotes(ctx.db, NOW, 2)).toBe(0);
    expect(
      await stored(
        ctx.db,
        old.map((seat) => seat.id),
      ),
    ).toHaveLength(3);
  });

  it("counts returned mutations when a database trigger suppresses selected updates", async () => {
    await seats(ctx.db, ctx.shop.id, [31, 31]);
    await ctx.db.execute(sql`create function suppress_dietary_test_update() returns trigger language plpgsql as $$
      begin return null; end $$`);
    await ctx.db.execute(
      sql`create trigger suppress_dietary_test_update before update on bookings for each row execute function suppress_dietary_test_update()`,
    );
    expect(await clearExpiredDietaryNotes(ctx.db, NOW, 2)).toBe(0);
    await ctx.db.execute(sql`drop trigger suppress_dietary_test_update on bookings`);
    expect(await clearExpiredDietaryNotes(ctx.db, NOW, 2)).toBe(2);
  });

  it("admits no batch on a zero budget", async () => {
    const [seat] = await seats(ctx.db, ctx.shop.id, [31]);
    expect(await drainExpiredDietaryNotes(ctx.db, { now: NOW, budgetMs: 0 })).toEqual({
      cleared: 0,
      capped: true,
      failed: false,
    });
    expect((await stored(ctx.db, [seat.id]))[0]?.dietaryNote).toBe("Private dietary words");
  });

  it("checks monotonic elapsed time before every batch even while the application clock is frozen", async () => {
    const old = await seats(ctx.db, ctx.shop.id, Array(5).fill(31));
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(110)
      .mockReturnValue(145);
    expect(
      await drainExpiredDietaryNotes(ctx.db, { now: NOW, batchLimit: 2, budgetMs: 45 }),
    ).toEqual({ cleared: 4, capped: true, failed: false });
    expect(
      (
        await stored(
          ctx.db,
          old.map((seat) => seat.id),
        )
      ).filter((row) => row.dietaryNote !== null),
    ).toHaveLength(1);
  });

  it("keeps earlier progress when a real update statement fails and safely resumes next run", async () => {
    // Outside the shared transaction harness: an actual failed statement must
    // not poison the test's outer transaction and hide the already committed batch.
    const { db, shop } = await seededShopContext();
    const old = await seats(db, shop.id, Array(5).fill(31));
    await db.execute(sql`create sequence dietary_test_updates`);
    await db.execute(sql`create function reject_later_dietary_batch() returns trigger language plpgsql as $$
      begin
        if old.dietary_note is not null and new.dietary_note is null and nextval('dietary_test_updates') > 2 then
          raise exception 'private note must not reach telemetry';
        end if;
        return new;
      end $$`);
    await db.execute(
      sql`create trigger reject_later_dietary_batch before update on bookings for each row execute function reject_later_dietary_batch()`,
    );
    expect(await drainExpiredDietaryNotes(db, { now: NOW, batchLimit: 2 })).toEqual({
      cleared: 2,
      capped: false,
      failed: true,
    });
    expect(
      (
        await stored(
          db,
          old.map((seat) => seat.id),
        )
      ).filter((row) => row.dietaryNote !== null),
    ).toHaveLength(3);
    await db.execute(sql`drop trigger reject_later_dietary_batch on bookings`);
    expect(await drainExpiredDietaryNotes(db, { now: NOW, batchLimit: 2 })).toEqual({
      cleared: 3,
      capped: false,
      failed: false,
    });
  });

  it("does not clear a note after its departure has moved inside the window", async () => {
    const [seat] = await seats(ctx.db, ctx.shop.id, [31]);
    await ctx.db
      .update(trips)
      .set({
        startsAt: NOW,
        endsAt: new Date(NOW.getTime() + 4 * 3_600_000),
        revision: sql`${trips.revision} + 1`,
      })
      .where(eq(trips.id, seat.tripId));
    expect(await clearExpiredDietaryNotes(ctx.db, NOW)).toBe(0);
    expect((await stored(ctx.db, [seat.id]))[0]?.dietaryNote).toBe("Private dietary words");
  });
});
