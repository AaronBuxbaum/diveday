import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDiverMergePreview, mergeDiverRecords } from "../../../db/diver-merge";
import { createPerson } from "../../../db/people";
import { publicRecoveryActivity, readRecoveryActivities } from "../../../db/recovery-activities";
import {
  bookingPayments,
  bookings,
  people,
  personRoles,
  recoveryActivities,
  recoveryActivityEvents,
  recoveryActivityOffers,
  recoveryActivityParticipants,
  shops,
  trips,
} from "../../../db/schema";
import { nowDate } from "../../../lib/clock";
import { advanceClock } from "../../../test/clock";
import { fileScopedShopContext } from "../../../test/db";
import { anonymizeDiver } from "../../records/anonymize";
import { classroomFixture } from "./fixture.test-support";
import { createRecoveryActivity, transitionRecoveryActivity } from "./store";

const context = fileScopedShopContext();
const setup = () => classroomFixture(context.db, context.shop);
describe("complimentary non-diving classroom recovery", () => {
  it("requires deliberate arrangements, a live coordinator and cancellation; creation retries remain durable", async () => {
    const { db, create } = await setup();
    expect(
      await createRecoveryActivity(db, {
        ...create,
        attemptId: randomUUID(),
        arrangementsConfirmed: false,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await createRecoveryActivity(db, {
        ...create,
        attemptId: randomUUID(),
        coordinatorPersonId: randomUUID(),
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    advanceClock(5 * 86400000);
    expect(await createRecoveryActivity(db, create)).toEqual({ ok: true, revision: 0 });
    expect(await createRecoveryActivity(db, { ...create, title: "Changed" })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
  it("prepares immutable offers without allocating or sending; public facts never expose identities", async () => {
    const { db, shop, confirm, create } = await setup();
    expect(await publicRecoveryActivity(db, shop.id, create.attemptId)).toBeNull();
    const offer = {
      shopId: confirm.shopId,
      tripId: confirm.tripId,
      actorPersonId: confirm.actorPersonId,
      attemptId: randomUUID(),
      activityId: confirm.activityId,
      expectedRevision: 0,
      kind: "offer" as const,
      blowoutDiverId: confirm.blowoutDiverId,
    };
    expect(await transitionRecoveryActivity(db, offer)).toEqual({ ok: true, revision: 0 });
    expect(await transitionRecoveryActivity(db, offer)).toEqual({ ok: true, revision: 0 });
    const publicFacts = await publicRecoveryActivity(db, shop.id, create.attemptId);
    expect(Object.keys(publicFacts ?? {}).sort()).toEqual([
      "endsAt",
      "id",
      "location",
      "startsAt",
      "title",
    ]);
    expect(await publicRecoveryActivity(db, randomUUID(), create.attemptId)).toBeNull();
    expect(await db.select().from(recoveryActivityParticipants)).toHaveLength(0);
    const [before] = await db.select().from(recoveryActivityOffers);
    expect(await transitionRecoveryActivity(db, { ...confirm, kind: "cancel_activity" })).toEqual({
      ok: true,
      revision: 1,
    });
    expect(await db.select().from(recoveryActivityOffers)).toEqual([before]);
    expect(await publicRecoveryActivity(db, shop.id, create.attemptId)).toBeNull();
  });
  it("limits places, rejects stale writes, and never resurrects a cancelled confirmation on replay", async () => {
    const { db, confirm, blowout } = await setup();
    expect(await transitionRecoveryActivity(db, confirm)).toEqual({ ok: true, revision: 1 });
    expect(
      await transitionRecoveryActivity(db, {
        ...confirm,
        attemptId: randomUUID(),
        blowoutDiverId: blowout.divers[1].id,
      }),
    ).toEqual({ ok: false, reason: "stale" });
    expect(
      await transitionRecoveryActivity(db, {
        ...confirm,
        expectedRevision: 1,
        attemptId: randomUUID(),
        blowoutDiverId: blowout.divers[1].id,
      }),
    ).toEqual({ ok: false, reason: "full" });
    expect(
      await transitionRecoveryActivity(db, {
        ...confirm,
        expectedRevision: 1,
        attemptId: randomUUID(),
        kind: "cancel_place",
      }),
    ).toEqual({ ok: true, revision: 2 });
    expect(await transitionRecoveryActivity(db, confirm)).toEqual({ ok: true, revision: 1 });
    const [participant] = await db.select().from(recoveryActivityParticipants);
    expect(participant.status).toBe("cancelled");
    expect(
      await transitionRecoveryActivity(db, {
        ...confirm,
        attemptId: randomUUID(),
        expectedRevision: 2,
      }),
    ).toEqual({ ok: false, reason: "stale" });
    expect(await transitionRecoveryActivity(db, { ...confirm, expectedRevision: 1 })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
  it("records capacity/cancellation atomically and never writes original booking or money state", async () => {
    const { db, shop, confirm } = await setup();
    const beforeSeats = await db.select().from(bookings).where(eq(bookings.shopId, shop.id));
    const beforeMoney = await db
      .select()
      .from(bookingPayments)
      .where(eq(bookingPayments.shopId, shop.id));
    expect((await transitionRecoveryActivity(db, confirm)).ok).toBe(true);
    expect(
      await transitionRecoveryActivity(db, {
        ...confirm,
        attemptId: randomUUID(),
        expectedRevision: 1,
        kind: "capacity",
        capacity: 2,
      }),
    ).toEqual({ ok: true, revision: 2 });
    expect(
      await transitionRecoveryActivity(db, {
        ...confirm,
        attemptId: randomUUID(),
        expectedRevision: 2,
        kind: "cancel_activity",
      }),
    ).toEqual({ ok: true, revision: 3 });
    expect(
      await transitionRecoveryActivity(db, {
        ...confirm,
        attemptId: randomUUID(),
        expectedRevision: 3,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(await db.select().from(bookings).where(eq(bookings.shopId, shop.id))).toEqual(
      beforeSeats,
    );
    expect(
      await db.select().from(bookingPayments).where(eq(bookingPayments.shopId, shop.id)),
    ).toEqual(beforeMoney);
    expect((await db.select().from(recoveryActivityEvents)).map((row) => row.code).sort()).toEqual([
      "activity_cancelled",
      "capacity_changed",
      "created",
      "place_confirmed",
    ]);
  });
  it("refuses foreign actors/activities, revoked roles, unconfirmed and erased identities", async () => {
    const { db, shop, confirm, blowout } = await setup();
    expect(await transitionRecoveryActivity(db, { ...confirm, shopId: randomUUID() })).toEqual({
      ok: false,
      reason: "not_authorized",
    });
    expect(await transitionRecoveryActivity(db, { ...confirm, activityId: randomUUID() })).toEqual({
      ok: false,
      reason: "not_found",
    });
    const diver = blowout.divers[0];
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate() })
      .where(eq(bookings.id, diver.bookingId));
    expect(await transitionRecoveryActivity(db, confirm)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null })
      .where(eq(bookings.id, diver.bookingId));
    await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.personId,
      actorPersonId: confirm.actorPersonId,
    });
    expect(await transitionRecoveryActivity(db, confirm)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    await db.delete(personRoles).where(and(eq(personRoles.personId, confirm.actorPersonId)));
    expect(
      await transitionRecoveryActivity(db, { ...confirm, blowoutDiverId: blowout.divers[1].id }),
    ).toEqual({ ok: false, reason: "not_authorized" });
  });
  it("allows staff to cancel an arrangement after its coordinator is removed", async () => {
    const { db, confirm, create, blowout } = await setup();
    const actorId = blowout.divers[1].personId;
    // Keep a second staff actor rather than granting a public inquiry any authority.
    // Existing live account requirements are exercised by the seeded owner's role tests.
    await db
      .update(recoveryActivities)
      .set({ coordinatorPersonId: actorId })
      .where(eq(recoveryActivities.id, create.attemptId));
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, actorId));
    expect(await transitionRecoveryActivity(db, { ...confirm, kind: "cancel_activity" })).toEqual({
      ok: true,
      revision: 1,
    });
  });
  it("does not free a promised place merely because its diver was erased", async () => {
    const { db, shop, confirm, blowout, create } = await setup();
    expect((await transitionRecoveryActivity(db, confirm)).ok).toBe(true);
    const erased = blowout.divers.find((row) => row.id === confirm.blowoutDiverId);
    if (!erased) throw new Error("diver missing");
    expect(
      (
        await anonymizeDiver(db, {
          shopId: shop.id,
          personId: erased.personId,
          actorPersonId: confirm.actorPersonId,
        })
      ).ok,
    ).toBe(true);
    const other = blowout.divers.find((row) => row.id !== confirm.blowoutDiverId);
    if (!other) throw new Error("other missing");
    expect(
      await transitionRecoveryActivity(db, {
        ...confirm,
        attemptId: randomUUID(),
        expectedRevision: 1,
        blowoutDiverId: other.id,
      }),
    ).toEqual({ ok: false, reason: "full" });
    const rows = await readRecoveryActivities(db, shop.id, blowout.id);
    expect(rows.find((row) => row.id === create.attemptId)?.confirmed).toBe(1);
    // Privacy changes do not establish cancellation or absence. Staff release it explicitly.
    expect(
      await transitionRecoveryActivity(db, {
        ...confirm,
        attemptId: randomUUID(),
        expectedRevision: 1,
        kind: "cancel_place",
      }),
    ).toEqual({ ok: true, revision: 2 });
    expect(
      await transitionRecoveryActivity(db, {
        ...confirm,
        attemptId: randomUUID(),
        expectedRevision: 2,
        blowoutDiverId: other.id,
      }),
    ).toEqual({ ok: true, revision: 3 });
  });
  it("keeps anonymous holds in a capacity-decrease check", async () => {
    const { db, shop, confirm, blowout } = await setup();
    expect(
      (await transitionRecoveryActivity(db, { ...confirm, kind: "capacity", capacity: 2 })).ok,
    ).toBe(true);
    expect(
      (
        await transitionRecoveryActivity(db, {
          ...confirm,
          expectedRevision: 1,
          attemptId: randomUUID(),
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await transitionRecoveryActivity(db, {
          ...confirm,
          expectedRevision: 2,
          attemptId: randomUUID(),
          blowoutDiverId: blowout.divers[1].id,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await anonymizeDiver(db, {
          shopId: shop.id,
          personId: blowout.divers[0].personId,
          actorPersonId: confirm.actorPersonId,
        })
      ).ok,
    ).toBe(true);
    expect(
      await transitionRecoveryActivity(db, {
        ...confirm,
        kind: "capacity",
        capacity: 1,
        expectedRevision: 3,
        attemptId: randomUUID(),
      }),
    ).toEqual({ ok: false, reason: "full" });
  });
  it("reconciles duplicate confirmed identities on merge without losing allocation evidence", async () => {
    const { db, shop, confirm, blowout } = await setup();
    await transitionRecoveryActivity(db, { ...confirm, kind: "capacity", capacity: 2 });
    await transitionRecoveryActivity(db, {
      ...confirm,
      expectedRevision: 1,
      attemptId: randomUUID(),
    });
    await transitionRecoveryActivity(db, {
      ...confirm,
      expectedRevision: 2,
      attemptId: randomUUID(),
      blowoutDiverId: blowout.divers[1].id,
    });
    const source = blowout.divers[0].personId;
    const survivor = blowout.divers[1].personId;
    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source,
        survivorId: survivor,
        actorPersonId: confirm.actorPersonId,
      }),
    ).toMatchObject({ ok: false, reason: "booking_conflict" });
    // Only the existing seat's explicit cancelled status permits this identity merge.
    // Classroom participation must never weaken the original booking/boarding safeguards.
    await db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(eq(bookings.tripId, confirm.tripId));
    const preview = await getDiverMergePreview(db, shop.id, source, survivor);
    const merged = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source,
      survivorId: survivor,
      actorPersonId: confirm.actorPersonId,
      acknowledged: preview?.acknowledgement || undefined,
    });
    expect(merged.ok, JSON.stringify(merged)).toBe(true);
    const rows = await db.select().from(recoveryActivityParticipants);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.personId === survivor)).toBe(true);
    expect(rows.filter((row) => row.status === "confirmed")).toHaveLength(1);
    const events = await db
      .select()
      .from(recoveryActivityEvents)
      .where(eq(recoveryActivityEvents.code, "identity_merged"));
    expect(events).toHaveLength(1);
    expect(events[0].transition).toMatchObject({
      priorPersonId: source,
      canonicalPersonId: survivor,
    });
  });
  it("replays a confirmed attempt after the original departure is reinstated without another allocation", async () => {
    const { db, confirm } = await setup();
    expect(await transitionRecoveryActivity(db, confirm)).toEqual({ ok: true, revision: 1 });
    await db.update(trips).set({ status: "scheduled" }).where(eq(trips.id, confirm.tripId));
    expect(await transitionRecoveryActivity(db, confirm)).toEqual({ ok: true, revision: 1 });
    expect(await db.select().from(recoveryActivityParticipants)).toHaveLength(1);
  });
  it("enforces the coordinator tenant FK even for a direct database insert", async () => {
    const { db, create } = await setup();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other classroom", slug: `other-${randomUUID()}`, timezone: "UTC" })
      .returning();
    const foreign = await createPerson(db, {
      shopId: other.id,
      fullName: "Foreign coordinator",
      email: null,
      phone: null,
      origin: "counter",
    });
    const [activity] = await db
      .select()
      .from(recoveryActivities)
      .where(eq(recoveryActivities.id, create.attemptId));
    await expect(
      db.transaction(async (tx) => {
        await tx
          .insert(recoveryActivities)
          .values({ ...activity, id: randomUUID(), coordinatorPersonId: foreign.id });
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
  });
});
