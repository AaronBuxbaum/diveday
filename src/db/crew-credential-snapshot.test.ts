import { and, desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { recordCrewRollCall } from "./manifests";
import { people, personRoles, rollCallCrewEvents, tripAssignments } from "./schema";
import { changeStaffCredential, createStaffCredential } from "./staff-credentials";
import { listStaff, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

describe("crew credential evidence on live boarding marks", () => {
  it("captures committed card facts with an observation interval, not a sailing assertion", async () => {
    const { db, shop } = ctx;
    const [staff] = await listStaff(db, shop.id);
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const trip = trips.find((row) => row.title.startsWith("Two-Tank Reef"));
    if (!staff || !trip) throw new Error("seed crew or departure missing");
    await db
      .insert(tripAssignments)
      .values({ tripId: trip.id, personId: staff.person.id })
      .onConflictDoNothing();
    const card = await createStaffCredential(db, {
      shopId: shop.id,
      personId: staff.person.id,
      kind: "other",
      name: "Test status",
      identifier: "TEST-CREW-CAPTURE",
      issuedAt: "2024-01-01",
      renewsAt: "2026-07-20",
    });
    if (!card) throw new Error("test credential missing");
    expect(
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: staff.person.id,
        recordedByPersonId: staff.person.id,
        checkpoint: "departure",
        status: "boarded",
        source: "live",
      }),
    ).toMatchObject({ ok: true });
    const [event] = await db
      .select()
      .from(rollCallCrewEvents)
      .where(
        and(
          eq(rollCallCrewEvents.shopId, shop.id),
          eq(rollCallCrewEvents.tripId, trip.id),
          eq(rollCallCrewEvents.personId, staff.person.id),
        ),
      );
    const observed = event as unknown as {
      credentialSnapshot: unknown;
      credentialSnapshotStartedAt: Date | null;
      credentialSnapshotCapturedAt: Date | null;
    };
    expect(observed.credentialSnapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "other", issuedAt: "2024-01-01", renewsAt: "2026-07-20" }),
      ]),
    );
    expect(observed.credentialSnapshotStartedAt).toBeInstanceOf(Date);
    expect(observed.credentialSnapshotCapturedAt).toBeInstanceOf(Date);
  });
  it("keeps the boarding evidence unchanged after the live credential is renewed", async () => {
    const { db, shop } = ctx;
    const [staff] = await listStaff(db, shop.id);
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const trip = trips.find((row) => row.title.startsWith("Two-Tank Reef"));
    if (!staff || !trip) throw new Error("seed crew or departure missing");
    await db
      .insert(tripAssignments)
      .values({ tripId: trip.id, personId: staff.person.id })
      .onConflictDoNothing();
    const card = await createStaffCredential(db, {
      shopId: shop.id,
      personId: staff.person.id,
      kind: "other",
      name: "Test status",
      identifier: "TEST-CREW-LATE-RENEWAL",
      issuedAt: "2024-01-01",
      renewsAt: "2026-07-20",
    });
    if (!card) throw new Error("test credential missing");
    expect(
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: staff.person.id,
        recordedByPersonId: staff.person.id,
        checkpoint: "departure",
        status: "boarded",
        source: "live",
      }),
    ).toMatchObject({ ok: true });
    const renewed = await changeStaffCredential(db, {
      shopId: shop.id,
      credentialId: card.id,
      expectedRevision: card.revision,
      personId: staff.person.id,
      kind: card.kind,
      name: card.name,
      issuingBody: card.issuingBody,
      identifier: card.identifier,
      issuedAt: card.issuedAt,
      renewsAt: "2027-07-20",
      change: "renewed",
    });
    expect(renewed?.renewsAt).toBe("2027-07-20");
    const [event] = await db
      .select()
      .from(rollCallCrewEvents)
      .where(
        and(
          eq(rollCallCrewEvents.shopId, shop.id),
          eq(rollCallCrewEvents.tripId, trip.id),
          eq(rollCallCrewEvents.personId, staff.person.id),
        ),
      )
      .orderBy(desc(rollCallCrewEvents.seq))
      .limit(1);
    expect(event?.credentialSnapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "other", issuedAt: "2024-01-01", renewsAt: "2026-07-20" }),
      ]),
    );
  });
  it("never attaches current server evidence to an offline mark", async () => {
    const { db, shop } = ctx;
    const [staff] = await listStaff(db, shop.id);
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const trip = trips.find((row) => row.title.startsWith("Two-Tank Reef"));
    if (!staff || !trip) throw new Error("seed crew or departure missing");
    await db
      .insert(tripAssignments)
      .values({ tripId: trip.id, personId: staff.person.id })
      .onConflictDoNothing();
    const at = nowDate();
    expect(
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: staff.person.id,
        recordedByPersonId: staff.person.id,
        checkpoint: "departure",
        status: "boarded",
        source: "offline",
        clientEventId: "d041920a-7954-4ccf-b900-09a8c7551c8d",
        offlineSnapshotSavedAt: at,
        occurredAt: at,
      }),
    ).toMatchObject({ ok: true });
    const [event] = await db
      .select()
      .from(rollCallCrewEvents)
      .where(
        and(
          eq(rollCallCrewEvents.shopId, shop.id),
          eq(rollCallCrewEvents.tripId, trip.id),
          eq(rollCallCrewEvents.personId, staff.person.id),
        ),
      );
    expect(event?.credentialSnapshot).toBeNull();
    expect(event?.credentialSnapshotStartedAt).toBeNull();
    expect(event?.credentialSnapshotCapturedAt).toBeNull();
  });
  it("erases a former crew member's observation even without a diver booking", async () => {
    const { db, shop } = ctx;
    const [owner] = (await listStaff(db, shop.id)).filter((member) =>
      member.roles.includes("owner"),
    );
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const trip = trips.find((row) => row.title.startsWith("Two-Tank Reef"));
    if (!owner || !trip) throw new Error("owner or trip missing");
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Former crew" })
      .returning();
    if (!person) throw new Error("person missing");
    await db.insert(personRoles).values({ personId: person.id, role: "captain" });
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: person.id });
    const card = await createStaffCredential(db, {
      shopId: shop.id,
      personId: person.id,
      kind: "captains_licence",
      name: "Licence",
      issuedAt: "2024-01-01",
      renewsAt: "2026-07-20",
    });
    if (!card) throw new Error("card missing");
    expect(
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: person.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "departure",
        status: "boarded",
        source: "live",
      }),
    ).toMatchObject({ ok: true });
    await db.delete(personRoles).where(eq(personRoles.personId, person.id));
    await db.insert(personRoles).values({ personId: person.id, role: "diver" });
    expect(
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: person.id,
        actorPersonId: owner.person.id,
      }),
    ).toMatchObject({ ok: true });
    const [event] = await db
      .select()
      .from(rollCallCrewEvents)
      .where(
        and(eq(rollCallCrewEvents.shopId, shop.id), eq(rollCallCrewEvents.personId, person.id)),
      );
    expect(event?.credentialSnapshot).toBeNull();
    expect(event?.credentialSnapshotStartedAt).toBeNull();
    expect(event?.credentialSnapshotCapturedAt).toBeNull();
    expect(
      await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: person.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "departure",
        status: "boarded",
        source: "live",
      }),
    ).toMatchObject({ ok: true });
    const events = await db
      .select()
      .from(rollCallCrewEvents)
      .where(
        and(eq(rollCallCrewEvents.shopId, shop.id), eq(rollCallCrewEvents.personId, person.id)),
      );
    expect(events).toHaveLength(2);
    expect(
      events.every(
        (row) =>
          row.credentialSnapshot === null &&
          row.credentialSnapshotStartedAt === null &&
          row.credentialSnapshotCapturedAt === null,
      ),
    ).toBe(true);
  });
});
