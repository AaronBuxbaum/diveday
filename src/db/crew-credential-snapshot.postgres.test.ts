import { asc, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { anonymizeDiver } from "./anonymize";
import { recordCrewRollCall } from "./manifests";
import { people, personRoles, rollCallCrewEvents, tripAssignments } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { changeStaffCredential, createStaffCredential } from "./staff-credentials";
import { listStaff, upcomingTripsWithCounts } from "./trips";

describePostgres("crew boarding credential observation", () => {
  it("captures only committed credentials when a renewal is blocked, then sees the committed renewal", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db);
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const [staff] = await listStaff(pg.db, shop.id);
    const trips = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
    const trip = trips.find((row) => row.title.startsWith("Two-Tank Reef"));
    if (!staff || !trip) throw new Error("staff or trip missing");
    await pg.db
      .insert(tripAssignments)
      .values({ tripId: trip.id, personId: staff.person.id })
      .onConflictDoNothing();
    const card = await createStaffCredential(pg.db, {
      shopId: shop.id,
      personId: staff.person.id,
      kind: "other",
      name: "Race card",
      identifier: "CREW-CAPTURE-RACE",
      issuedAt: "2024-01-01",
      renewsAt: "2026-01-01",
    });
    if (!card) throw new Error("card missing");
    const gate = await holdRowLock(
      pg,
      sql`select id from people where id = ${staff.person.id} for no key update`,
    );
    const renewal = changeStaffCredential(pg.connect(), {
      shopId: shop.id,
      personId: staff.person.id,
      credentialId: card.id,
      expectedRevision: card.revision,
      kind: card.kind,
      name: card.name,
      issuingBody: card.issuingBody,
      identifier: card.identifier,
      issuedAt: "2026-02-01",
      renewsAt: "2028-02-01",
      change: "renewed",
    });
    const mark = () =>
      recordCrewRollCall(pg.connect(), {
        shopId: shop.id,
        tripId: trip.id,
        personId: staff.person.id,
        recordedByPersonId: staff.person.id,
        checkpoint: "departure",
        status: "boarded",
        source: "live",
      });
    try {
      await waitForLockWaiters(pg.db, 1);
      expect(await mark()).toMatchObject({ ok: true });
    } finally {
      await gate.release();
    }
    expect(await renewal).not.toBeNull();
    expect(await mark()).toMatchObject({ ok: true });
    const events = await pg.db
      .select()
      .from(rollCallCrewEvents)
      .where(eq(rollCallCrewEvents.personId, staff.person.id))
      .orderBy(asc(rollCallCrewEvents.seq));
    const observed = events.filter((event) => event.tripId === trip.id && event.credentialSnapshot);
    expect(observed).toHaveLength(2);
    expect(observed[0]?.credentialSnapshot).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "other", renewsAt: "2026-01-01" })]),
    );
    expect(observed[1]?.credentialSnapshot).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "other", renewsAt: "2028-02-01" })]),
    );
  });
  it("erases evidence when a former crew member's live mark races with erasure", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db);
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const owner = (await listStaff(pg.db, shop.id)).find((staff) => staff.roles.includes("owner"));
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef"),
    );
    if (!owner || !trip) throw new Error("owner or trip missing");
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Former crew" })
      .returning();
    if (!person) throw new Error("person missing");
    await pg.db.insert(personRoles).values({ personId: person.id, role: "captain" });
    await pg.db.insert(tripAssignments).values({ tripId: trip.id, personId: person.id });
    await createStaffCredential(pg.db, {
      shopId: shop.id,
      personId: person.id,
      kind: "captains_licence",
      name: "Licence",
      issuedAt: "2024-01-01",
      renewsAt: "2026-01-01",
    });
    expect(
      await recordCrewRollCall(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: person.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "departure",
        status: "boarded",
        source: "live",
      }),
    ).toMatchObject({ ok: true });
    await pg.db.delete(personRoles).where(eq(personRoles.personId, person.id));
    await pg.db.insert(personRoles).values({ personId: person.id, role: "diver" });
    const gate = await holdRowLock(pg, sql`select id from trips where id = ${trip.id} for update`);
    const board = recordCrewRollCall(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      personId: person.id,
      recordedByPersonId: owner.person.id,
      checkpoint: "departure",
      status: "boarded",
      source: "live",
    });
    let erase: ReturnType<typeof anonymizeDiver> | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
      erase = anonymizeDiver(pg.connect(), {
        shopId: shop.id,
        personId: person.id,
        actorPersonId: owner.person.id,
      });
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    if (!erase) throw new Error("erasure did not start");
    const [boarded, erased] = await Promise.all([board, erase]);
    expect(boarded).toMatchObject({ ok: true });
    expect(erased).toMatchObject({ ok: true });
    expect(
      await recordCrewRollCall(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        personId: person.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "departure",
        status: "boarded",
        source: "live",
      }),
    ).toMatchObject({ ok: true });
    const events = await pg.db
      .select()
      .from(rollCallCrewEvents)
      .where(eq(rollCallCrewEvents.personId, person.id));
    expect(events).toHaveLength(3);
    expect(
      events.every(
        (event) =>
          event.credentialSnapshot === null &&
          event.credentialSnapshotStartedAt === null &&
          event.credentialSnapshotCapturedAt === null,
      ),
    ).toBe(true);
  });
});
