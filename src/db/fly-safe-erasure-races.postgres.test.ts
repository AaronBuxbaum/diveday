import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import type { NotificationProvider } from "@/lib/notifications";
import { fakeEmail } from "@/test/fakes";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { anonymizeDiver } from "./anonymize";
import { createBookingParty } from "./bookings";
import {
  acknowledgeFlySafeFollowUp,
  listShopFlySafeFollowUps,
  recordFlySafeTold,
  sendFlySafeCorrections,
} from "./fly-safe-correction";
import { repointHeldBooking } from "./identity-repoint";
import { bookings, notificationSendQueue, people, personRoles, trips } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { createTrip } from "./trips";

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const pg = await postgresTestDb();
  await seedDemo(pg.db);
  const shop = await getShopBySlug(pg.db, "blue-mantis");
  if (!shop) throw new Error("shop missing");
  const startsAt = new Date("2035-03-12T12:00:00Z");
  const trip = await createTrip(pg.db, {
    shopId: shop.id,
    title: "Race trip",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 6,
    plannedDives: 2,
  });
  if (!trip) throw new Error("trip missing");
  const party = await createBookingParty(pg.db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Race Diver",
      email: "race-diver@example.com",
    },
  ]);
  if (!party.ok) throw new Error("booking failed");
  const [owner] = await pg.db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("owner missing");
  const bookingId = party.bookings[0].bookingId;
  await recordFlySafeTold(pg.db, {
    shopId: shop.id,
    bookingId,
    hours: 24,
    recipientEmail: "race-diver@example.com",
  });
  await pg.db.update(trips).set({ exceedsNoDecoLimits: true }).where(eq(trips.id, trip.id));
  return {
    pg,
    shop,
    trip,
    bookingId,
    personId: party.bookings[0].personId,
    owner,
    now: new Date(startsAt.getTime() - HOUR_MS),
  };
}

describePostgres("flying guidance erasure races", () => {
  it("does not queue a failed provider attempt after the diver was erased", async () => {
    const { pg, shop, trip, bookingId, personId, owner, now } = await fixture();
    const entered = barrier();
    const release = barrier();
    const provider: NotificationProvider = {
      async send() {
        entered.resolve();
        await release.promise;
        return { status: "failed", retryable: true };
      },
    };
    const send = sendFlySafeCorrections(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      now,
      emailProvider: provider,
    });
    try {
      await entered.promise;
      expect(
        await anonymizeDiver(pg.connect(), { shopId: shop.id, personId, actorPersonId: owner.id }),
      ).toMatchObject({ ok: true });
    } finally {
      release.resolve();
      await send;
    }
    expect(
      await pg.db
        .select()
        .from(notificationSendQueue)
        .where(eq(notificationSendQueue.bookingId, bookingId)),
    ).toEqual([]);
  });

  it("erasure removes a retry queued before the diver was erased", async () => {
    const { pg, shop, trip, bookingId, personId, owner, now } = await fixture();
    await sendFlySafeCorrections(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      now,
      emailProvider: fakeEmail({ status: "failed", retryable: true }).provider,
    });
    expect(
      await pg.db
        .select()
        .from(notificationSendQueue)
        .where(eq(notificationSendQueue.bookingId, bookingId)),
    ).toHaveLength(1);
    expect(
      await anonymizeDiver(pg.connect(), { shopId: shop.id, personId, actorPersonId: owner.id }),
    ).toMatchObject({ ok: true });
    expect(
      await pg.db
        .select()
        .from(notificationSendQueue)
        .where(eq(notificationSendQueue.bookingId, bookingId)),
    ).toEqual([]);
  });

  it("does not queue a failed provider attempt after the seat identity is repointed", async () => {
    const { pg, shop, trip, bookingId, owner, now } = await fixture();
    await pg.db
      .update(bookings)
      .set({
        identityUnconfirmedAt: now,
        identityBookedAs: "Race Diver",
        identityMatchedBy: "picked_name",
      })
      .where(eq(bookings.id, bookingId));
    const [replacement] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Race Diver", email: "other-race@example.com" })
      .returning();
    if (!replacement) throw new Error("replacement missing");
    const entered = barrier();
    const release = barrier();
    const provider: NotificationProvider = {
      async send() {
        entered.resolve();
        await release.promise;
        return { status: "failed", retryable: true };
      },
    };
    const send = sendFlySafeCorrections(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      now,
      emailProvider: provider,
    });
    try {
      await entered.promise;
      expect(
        await repointHeldBooking(pg.connect(), {
          shopId: shop.id,
          bookingId,
          actorPersonId: owner.id,
          toPersonId: replacement.id,
        }),
      ).toMatchObject({ ok: true });
    } finally {
      release.resolve();
      await send;
    }
    expect(
      await pg.db
        .select()
        .from(notificationSendQueue)
        .where(eq(notificationSendQueue.bookingId, bookingId)),
    ).toEqual([]);
  });

  it("does not attribute an acknowledgement to an actor erased while it is being written", async () => {
    const { pg, shop, trip, bookingId, now } = await fixture();
    await sendFlySafeCorrections(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      now,
      emailProvider: fakeEmail({ status: "failed", retryable: false }).provider,
    });
    const [task] = await listShopFlySafeFollowUps(pg.db, { shopId: shop.id, now });
    if (!task) throw new Error("task missing");
    const [actor] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Staff Race" })
      .returning();
    if (!actor) throw new Error("actor missing");
    const entered = barrier();
    const release = barrier();
    const erase = pg.connect().transaction(async (tx) => {
      await tx
        .update(people)
        .set({ deletedAt: now, anonymizedAt: now })
        .where(eq(people.id, actor.id));
      await tx
        .update(bookings)
        .set({ flySafeAcknowledgedByPersonId: null })
        .where(eq(bookings.flySafeAcknowledgedByPersonId, actor.id));
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const acknowledgement = acknowledgeFlySafeFollowUp(pg.connect(), {
      shopId: shop.id,
      bookingId,
      actorPersonId: actor.id,
      fingerprint: task.fingerprint,
    });
    try {
      await Promise.race([acknowledgement, new Promise<void>((done) => setTimeout(done, 200))]);
    } finally {
      release.resolve();
      await erase;
    }
    expect(await acknowledgement).toBe(false);
    const [after] = await pg.db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(after?.flySafeAcknowledgedByPersonId).toBeNull();
  });
  it("clears the actor when erasure follows an acknowledgement already holding the actor lock", async () => {
    const { pg, shop, trip, bookingId, now, owner } = await fixture();
    await sendFlySafeCorrections(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      now,
      emailProvider: fakeEmail({ status: "failed", retryable: false }).provider,
    });
    const [task] = await listShopFlySafeFollowUps(pg.db, { shopId: shop.id, now });
    if (!task) throw new Error("task missing");
    const [actor] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Staff Race" })
      .returning();
    if (!actor) throw new Error("actor missing");
    const held = barrier();
    const unlock = barrier();
    const blocker = pg.connect().transaction(async (tx) => {
      await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .for("update");
      held.resolve();
      await unlock.promise;
    });
    await held.promise;
    const acknowledgement = acknowledgeFlySafeFollowUp(pg.connect(), {
      shopId: shop.id,
      bookingId,
      actorPersonId: actor.id,
      fingerprint: task.fingerprint,
    });
    let actorLocked = false;
    try {
      for (let attempt = 0; attempt < 100 && !actorLocked; attempt += 1) {
        try {
          await pg.connect().transaction(async (tx) => {
            await tx
              .select({ id: people.id })
              .from(people)
              .where(eq(people.id, actor.id))
              .for("update", { noWait: true });
          });
        } catch (error) {
          const cause = error instanceof Error ? error.cause : undefined;
          if (cause && typeof cause === "object" && "code" in cause && cause.code === "55P03")
            actorLocked = true;
          else throw error;
        }
        if (!actorLocked) await new Promise((done) => setTimeout(done, 10));
      }
      expect(actorLocked).toBe(true);
      const erasure = anonymizeDiver(pg.connect(), {
        shopId: shop.id,
        personId: actor.id,
        actorPersonId: owner.id,
      });
      unlock.resolve();
      await blocker;
      expect(await acknowledgement).toBe(true);
      expect(await erasure).toMatchObject({ ok: true });
      const [after] = await pg.db.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(after?.flySafeAcknowledgedByPersonId).toBeNull();
    } finally {
      unlock.resolve();
      await blocker;
      await acknowledgement;
    }
  });
});
