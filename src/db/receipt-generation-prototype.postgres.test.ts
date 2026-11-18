import { eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import {
  createScratchLedger,
  recordScratchReceipt,
} from "@/test/boarding-receipt-prototype/ledger";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { bookings } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { getTripRoster } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

// A disposable experiment, not the production reset, an authorization check,
// or proof that active-generation filtering exists in application readers.
describePostgres("scratch generation switch and original observation", () => {
  it.each(["reset-first", "intake-first"] as const)(
    "retains the original booking with %s ordering and late intake",
    async (ordering) => {
      const pg = await postgresTestDb();
      await seedDemo(pg.db, "history");
      const shop = await getShopBySlug(pg.db, "blue-mantis");
      if (!shop) throw new Error("shop missing");
      const [trip] = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
      if (!trip) throw new Error("trip missing");
      const [seat] = await getTripRoster(pg.db, shop.id, trip.id);
      if (!seat) throw new Error("booking missing");
      const before = await pg.db.select().from(bookings).where(eq(bookings.id, seat.booking.id));
      await createScratchLedger(pg.db);
      await pg.db.execute(
        sql`create table scratch_active_generation (shop_id uuid primary key, generation_id text not null)`,
      );
      await pg.db.execute(sql`insert into scratch_active_generation values (${shop.id}, 'old')`);
      await pg.db.execute(sql`create table scratch_schedule_context (
        shop_id uuid not null, generation_id text not null, booking_id text not null,
        aboard boolean not null, primary key (shop_id, generation_id, booking_id))`);
      await pg.db.execute(sql`insert into scratch_schedule_context values
        (${shop.id}, 'old', ${seat.booking.id}, false), (${shop.id}, 'new', 'synthetic-new-booking', false)`);
      const intent = {
        shopId: shop.id,
        generationId: "old",
        tripId: trip.id,
        bookingId: seat.booking.id,
        actorId: "synthetic-staff",
        eventId: "first",
        meeting: { kind: "known" as const, id: "original-day" },
        occurredAt: "2026-11-18T10:00:00.000Z",
      };
      let release!: () => void;
      let signal!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        signal = resolve;
      });
      const reset = () =>
        pg.connect().transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '2s'`);
          await tx.execute(sql`set local statement_timeout = '5s'`);
          await tx.execute(
            sql`update scratch_active_generation set generation_id = 'new' where shop_id = ${shop.id}`,
          );
          if (ordering === "reset-first") {
            signal();
            await gate;
          }
        });
      const intake = () =>
        recordScratchReceipt(pg.connect(), intent, {
          afterReservation: async () => {
            if (ordering === "intake-first") {
              signal();
              await gate;
            }
          },
        });
      const first = ordering === "reset-first" ? reset() : intake();
      void first.catch(() => undefined);
      let second: Promise<unknown> | undefined;
      onTestFinished(async () => {
        release();
        await Promise.allSettled([first, ...(second ? [second] : [])]);
      });
      try {
        await Promise.race([
          ready,
          first.then(() => {
            throw new Error("first operation did not reach its barrier");
          }),
        ]);
        second = ordering === "reset-first" ? intake() : reset();
        void second.catch(() => undefined);
        const secondResult = await second;
        if (ordering === "reset-first")
          expect(secondResult).toMatchObject({ ok: true, replay: false });
        expect(await pg.db.select().from(bookings).where(eq(bookings.id, seat.booking.id))).toEqual(
          before,
        );
      } finally {
        release();
      }
      const firstResult = await first;
      if (ordering === "intake-first")
        expect(firstResult).toMatchObject({ ok: true, replay: false });
      expect(await pg.db.select().from(bookings).where(eq(bookings.id, seat.booking.id))).toEqual(
        before,
      );
      expect(
        (
          await pg.db.execute(
            sql`select generation_id from scratch_active_generation where shop_id = ${shop.id}`,
          )
        ).rows,
      ).toEqual([{ generation_id: "new" }]);
      const late = await recordScratchReceipt(pg.connect(), { ...intent, eventId: "late" });
      expect(late).toMatchObject({ ok: true, replay: false });
      const replay = await recordScratchReceipt(pg.connect(), intent);
      expect(replay).toMatchObject({ ok: true, replay: true });
      const originalReceipts =
        await pg.db.execute(sql`select event_id, generation_id, trip_id, booking_id, meeting_id
        from scratch_receipt where shop_id = ${shop.id} order by event_id`);
      expect(originalReceipts.rows).toEqual(
        ["first", "late"].map((event_id) => ({
          event_id,
          generation_id: "old",
          trip_id: trip.id,
          booking_id: seat.booking.id,
          meeting_id: "original-day",
        })),
      );
      const active = await pg.db.execute(sql`select c.booking_id, c.aboard
        from scratch_schedule_context c inner join scratch_active_generation a
          on a.shop_id = c.shop_id and a.generation_id = c.generation_id
        where c.shop_id = ${shop.id}`);
      expect(active.rows).toEqual([{ booking_id: "synthetic-new-booking", aboard: false }]);
      const review =
        await pg.db.execute(sql`select r.event_id, c.booking_id, r.trip_id, r.meeting_id, o.state
        from scratch_receipt r inner join scratch_schedule_context c
          on c.shop_id::text = r.shop_id and c.generation_id = r.generation_id and c.booking_id = r.booking_id
        inner join scratch_observation o on o.id = r.observation_id and o.shop_id = r.shop_id
          and o.generation_id = r.generation_id and o.trip_id = r.trip_id and o.booking_id = r.booking_id
          and r.meeting_kind = 'known' and o.meeting_scope = ('known:' || r.meeting_id)
        where r.shop_id = ${shop.id} order by r.event_id`);
      expect(review.rows).toEqual(
        ["first", "late"].map((event_id) => ({
          event_id,
          booking_id: seat.booking.id,
          trip_id: trip.id,
          meeting_id: "original-day",
          state: "open",
        })),
      );
      expect(await pg.db.select().from(bookings).where(eq(bookings.id, seat.booking.id))).toEqual(
        before,
      );
    },
  );
});
