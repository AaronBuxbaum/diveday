import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { callTripBlowout, getTripBlowout } from "../../db/blowouts";
import { createBooking } from "../../db/bookings";
import { createPerson } from "../../db/people";
import {
  bookings,
  disruptionRecoveryEvents,
  people,
  personRoles,
  trips,
  userAccounts,
} from "../../db/schema";
import { createTrip } from "../../db/trips";
import { nowDate } from "../../lib/clock";
import { fileScopedShopContext } from "../../test/db";
import { fakeEmail } from "../../test/fakes";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "../../test/staff-session";
import { anonymizeDiver } from "../records/anonymize";
import { recordRecoveryFollowUp } from "./disruption-recovery";

const context = fileScopedShopContext();
async function setup() {
  const { db, shop } = context;
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const createDeparture = (title: string) =>
    createTrip(db, {
      shopId: shop.id,
      title,
      startsAt: new Date(nowDate().getTime() + 3 * 86400000),
      endsAt: new Date(nowDate().getTime() + 3 * 86400000 + 7200000),
      capacity: 8,
      plannedDives: 1,
    });
  const source = await createDeparture("Weather recovery source");
  const target = await createDeparture("Weather recovery target");
  if (!source || !target) throw new Error("departures missing");
  const seat = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: source.id,
    fullName: "Maya Storm",
    email: "maya-recovery@example.com",
  });
  if (!seat.ok) throw new Error(`source seat ${seat.reason}`);
  const replacement = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: target.id,
    personId: seat.personId,
    fullName: "Maya Storm",
    email: "maya-recovery@example.com",
  });
  if (!replacement.ok) throw new Error(`replacement ${replacement.reason}`);
  await callTripBlowout(db, {
    shopId: shop.id,
    tripId: source.id,
    calledByPersonId: owner,
    refunds: "queue",
    provider: fakeEmail().provider,
  });
  const record = await getTripBlowout(db, shop.id, source.id);
  const diver = record?.divers.find((row) => row.bookingId === seat.bookingId);
  if (!diver) throw new Error("cancellation snapshot missing");
  const input = {
    shopId: shop.id,
    tripId: source.id,
    blowoutDiverId: diver.id,
    actorPersonId: owner,
    attemptId: randomUUID(),
    expectedRevision: 0,
    outcome: "contacted" as const,
    replacementBookingId: null,
  };
  return { db, shop, owner, source, target, seat, replacement, diver, input };
}

describe("explicit disruption recovery", () => {
  it("never treats an unrelated future seat as recovery; records a link without moving seats or money", async () => {
    const { db, shop, source, seat, replacement, diver, input } = await setup();
    expect(diver.rebooked).toBe(false);
    const before = await db.select().from(bookings).where(eq(bookings.id, seat.bookingId));
    const linked = {
      ...input,
      outcome: "rebooked" as const,
      replacementBookingId: replacement.bookingId,
    };
    expect(await recordRecoveryFollowUp(db, linked)).toEqual({ ok: true, revision: 1 });
    expect(await recordRecoveryFollowUp(db, linked)).toEqual({ ok: true, revision: 1 });
    const record = await getTripBlowout(db, shop.id, source.id);
    expect(record?.divers[0]).toMatchObject({
      rebooked: true,
      replacementBookingId: replacement.bookingId,
      paymentStatus: diver.paymentStatus,
    });
    expect(record?.divers[0].recoveryEvents).toHaveLength(1);
    expect(await db.select().from(bookings).where(eq(bookings.id, seat.bookingId))).toEqual(before);
    expect(
      await db
        .select()
        .from(disruptionRecoveryEvents)
        .where(eq(disruptionRecoveryEvents.blowoutDiverId, diver.id)),
    ).toHaveLength(1);
  });

  it("appends corrections and refuses stale writes or changed replays", async () => {
    const { db, input, diver } = await setup();
    expect((await recordRecoveryFollowUp(db, input)).ok).toBe(true);
    expect(
      await recordRecoveryFollowUp(db, { ...input, attemptId: randomUUID(), outcome: "declined" }),
    ).toEqual({ ok: false, reason: "stale" });
    expect(await recordRecoveryFollowUp(db, { ...input, outcome: "declined" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(
      await recordRecoveryFollowUp(db, {
        ...input,
        expectedRevision: 1,
        attemptId: randomUUID(),
        outcome: "pending",
      }),
    ).toEqual({ ok: true, revision: 2 });
    const trail = await db
      .select()
      .from(disruptionRecoveryEvents)
      .where(eq(disruptionRecoveryEvents.blowoutDiverId, diver.id));
    expect(trail.map((row) => row.outcome).sort()).toEqual(["contacted", "pending"]);
  });

  it("rejects cross-tenant calls, nonstaff actors, and another diver’s replacement", async () => {
    const { db, shop, target, seat, input } = await setup();
    expect(await recordRecoveryFollowUp(db, { ...input, shopId: randomUUID() })).toEqual({
      ok: false,
      reason: "not_authorized",
    });
    expect(await recordRecoveryFollowUp(db, { ...input, actorPersonId: seat.personId })).toEqual({
      ok: false,
      reason: "not_authorized",
    });
    const other = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: target.id,
      fullName: "Other Diver",
      email: "other-recovery@example.com",
    });
    if (!other.ok) throw new Error("other seat missing");
    expect(
      await recordRecoveryFollowUp(db, {
        ...input,
        outcome: "rebooked",
        replacementBookingId: other.bookingId,
      }),
    ).toEqual({ ok: false, reason: "replacement_unavailable" });
    expect(await recordRecoveryFollowUp(db, { ...input, tripId: target.id })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("keeps the original link as evidence when the replacement is canceled", async () => {
    const { db, shop, source, target, replacement, input } = await setup();
    expect(
      (
        await recordRecoveryFollowUp(db, {
          ...input,
          outcome: "rebooked",
          replacementBookingId: replacement.bookingId,
        })
      ).ok,
    ).toBe(true);
    await db
      .update(trips)
      .set({ status: "cancelled" })
      .where(and(eq(trips.id, target.id), eq(trips.shopId, shop.id)));
    const diver = (await getTripBlowout(db, shop.id, source.id))?.divers[0];
    expect(diver?.rebooked).toBe(false);
    expect(diver?.recoveryEvents[0].replacementBookingId).toBe(replacement.bookingId);
    expect(
      await recordRecoveryFollowUp(db, {
        ...input,
        attemptId: randomUUID(),
        expectedRevision: 1,
        outcome: "rebooked",
        replacementBookingId: replacement.bookingId,
      }),
    ).toEqual({ ok: false, reason: "replacement_unavailable" });
  });

  it("refuses unconfirmed identity and erased diver follow-up", async () => {
    const { db, replacement, seat, input } = await setup();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate() })
      .where(eq(bookings.id, replacement.bookingId));
    expect(
      await recordRecoveryFollowUp(db, {
        ...input,
        outcome: "rebooked",
        replacementBookingId: replacement.bookingId,
      }),
    ).toEqual({ ok: false, reason: "replacement_unavailable" });
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, seat.personId));
    expect(await recordRecoveryFollowUp(db, input)).toEqual({ ok: false, reason: "not_found" });
  });
  it("retains recovery evidence after the replacement departs and through requested erasure", async () => {
    const { db, shop, owner, source, target, seat, replacement, input } = await setup();
    expect(
      (
        await recordRecoveryFollowUp(db, {
          ...input,
          outcome: "rebooked",
          replacementBookingId: replacement.bookingId,
        })
      ).ok,
    ).toBe(true);
    await db
      .update(trips)
      .set({ startsAt: new Date(nowDate().getTime() - 3600000) })
      .where(eq(trips.id, target.id));
    expect((await getTripBlowout(db, shop.id, source.id))?.divers[0].rebooked).toBe(true);
    const before = await db
      .select()
      .from(disruptionRecoveryEvents)
      .where(eq(disruptionRecoveryEvents.blowoutDiverId, input.blowoutDiverId));
    expect(
      (await anonymizeDiver(db, { shopId: shop.id, personId: seat.personId, actorPersonId: owner }))
        .ok,
    ).toBe(true);
    expect(
      await db
        .select()
        .from(disruptionRecoveryEvents)
        .where(eq(disruptionRecoveryEvents.blowoutDiverId, input.blowoutDiverId)),
    ).toEqual(before);
    const erased = (await getTripBlowout(db, shop.id, source.id))?.divers[0];
    expect(erased?.canRecordRecovery).toBe(false);
    expect(erased?.rebooked).toBe(false);
    expect(
      await recordRecoveryFollowUp(db, { ...input, attemptId: randomUUID(), expectedRevision: 1 }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
  it("retains id-only audit evidence while resolving an erased former actor anonymously", async () => {
    const { db, shop, owner, source, input } = await setup();
    const actor = await createPerson(db, {
      shopId: shop.id,
      fullName: "Former recovery coordinator",
      email: null,
      phone: null,
      origin: "counter",
      roles: ["divemaster"],
    });
    await db.insert(userAccounts).values({
      personId: actor.id,
      email: "former-recovery@example.com",
      hashedPassword: "unused",
      status: "active",
    });
    expect((await recordRecoveryFollowUp(db, { ...input, actorPersonId: actor.id })).ok).toBe(true);
    const before = await db
      .select()
      .from(disruptionRecoveryEvents)
      .where(eq(disruptionRecoveryEvents.blowoutDiverId, input.blowoutDiverId));
    await db.delete(personRoles).where(eq(personRoles.personId, actor.id));
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, actor.id));
    expect(
      (await anonymizeDiver(db, { shopId: shop.id, personId: actor.id, actorPersonId: owner })).ok,
    ).toBe(true);
    expect(
      await db
        .select()
        .from(disruptionRecoveryEvents)
        .where(eq(disruptionRecoveryEvents.blowoutDiverId, input.blowoutDiverId)),
    ).toEqual(before);
    const [erasedActor] = await db.select().from(people).where(eq(people.id, actor.id));
    expect(erasedActor.anonymizedAt).not.toBeNull();
    const record = await getTripBlowout(db, shop.id, source.id);
    expect(record?.divers[0].recoveryActors[actor.id]).toBe(erasedActor.fullName);
    expect(record?.divers[0].recoveryActors[actor.id]).not.toBe("Former recovery coordinator");
  });
});
