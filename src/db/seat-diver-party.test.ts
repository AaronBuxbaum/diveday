// @vitest-environment node
import { and, eq, inArray, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { getBookingReadiness } from "./readiness";
import {
  activityEvents,
  bookings,
  certifications,
  people,
  personRoles,
  tripRequirements,
} from "./schema";
import { seatParty } from "./seat-diver";
import { upcomingTripsWithCounts } from "./trips";
import { completeWaiver } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";
import { clearAnswers, now } from "./waivers-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

/** The two seeded departures `seat-diver.test.ts` works against, and a staff actor. */
async function context() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((trip) => trip.title === "Two-Tank Reef — Christ of the Abyss");
  const fullTrip = trips.find((trip) => trip.title === "Wreck Trip — Spiegel Grove");
  if (!open || !fullTrip) throw new Error("expected seeded trips missing");
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), inArray(personRoles.role, ["owner", "manager"])))
    .limit(1);
  if (!staff) throw new Error("seed has no staff actor");
  return { db, shop, open, fullTrip, actorPersonId: staff.id };
}

async function activityLines(db: AppDb, tripId: string) {
  return await db
    .select({ code: activityEvents.code, params: activityEvents.params })
    .from(activityEvents)
    .where(eq(activityEvents.tripId, tripId));
}

/**
 * **A walk-in family in one pass** (fifth loop, item 9): every member seated
 * on one transaction, the "Under 18" tick on that seat's own row, each seat
 * past the first led by the first, and nothing seated when the boat cannot
 * take them all.
 */
describe("seatParty", () => {
  it("seats the whole party together, with the minor's tick on their own seat", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const stamp = crypto.randomUUID().slice(0, 8);
    const result = await seatParty(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      entry: "walk_in",
      refusals: "specific",
      members: [
        { fullName: `Ana Party ${stamp}`, minor: false },
        { fullName: `Mia Party ${stamp}`, minor: true },
        { fullName: `Leo Party ${stamp}`, minor: false },
      ],
    });
    if (!result.ok) throw new Error(`expected the party to be seated, got ${result.reason}`);
    expect(result.seats.map((seat) => seat.personName)).toEqual([
      `Ana Party ${stamp}`,
      `Mia Party ${stamp}`,
      `Leo Party ${stamp}`,
    ]);

    const rows = await db
      .select({
        id: bookings.id,
        personId: bookings.personId,
        lead: bookings.partyLeadBookingId,
        minor: bookings.minorDeclaredAt,
      })
      .from(bookings)
      .where(
        inArray(
          bookings.id,
          result.seats.map((seat) => seat.bookingId),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const [ana, mia, leo] = result.seats.map((seat) => byId.get(seat.bookingId));
    expect(ana?.lead).toBeNull();
    expect(mia?.lead).toBe(ana?.id);
    expect(leo?.lead).toBe(ana?.id);
    expect(mia?.minor).not.toBeNull();
    expect(ana?.minor).toBeNull();
    expect(leo?.minor).toBeNull();

    // Each seat is owed what one walk-in is: its own line on the trail.
    const lines = await activityLines(db, open.id);
    for (const name of [`Ana Party ${stamp}`, `Mia Party ${stamp}`, `Leo Party ${stamp}`]) {
      expect(JSON.stringify(lines)).toContain(name);
    }
  });

  it("seats nobody when the boat cannot take them all, and says which member it stopped on", async () => {
    const { db, shop, fullTrip, actorPersonId } = await context();
    const stamp = crypto.randomUUID().slice(0, 8);
    const before = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, fullTrip.id), ne(bookings.status, "cancelled")));
    const result = await seatParty(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      actorPersonId,
      entry: "walk_in",
      refusals: "specific",
      members: [
        { fullName: `Full Party A ${stamp}`, minor: false },
        { fullName: `Full Party B ${stamp}`, minor: true },
      ],
    });
    expect(result).toMatchObject({ ok: false, reason: "trip_full" });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.failedIndex).toBeGreaterThanOrEqual(0);
    const after = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, fullTrip.id), ne(bookings.status, "cancelled")));
    expect(after).toHaveLength(before.length);
  });

  it("leaves a counter-seated party's seats unclaimable: the desk typed those names with the people there", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const stamp = crypto.randomUUID().slice(0, 8);
    const result = await seatParty(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      entry: "walk_in",
      refusals: "specific",
      members: [
        { fullName: `Claim Lead ${stamp}`, minor: false },
        { fullName: `Claim Kid ${stamp}`, minor: true },
      ],
    });
    if (!result.ok) throw new Error(`expected a seated party, got ${result.reason}`);
    const [kid] = await db
      .select({ lead: bookings.partyLeadBookingId, claimedAt: bookings.claimedAt })
      .from(bookings)
      .where(eq(bookings.id, result.seats[1]?.bookingId as string));
    expect(kid?.lead).not.toBeNull();
    expect(kid?.claimedAt).not.toBeNull();
  });

  it("seats each member as what they are coming as", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const stamp = crypto.randomUUID().slice(0, 8);
    const result = await seatParty(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      entry: "walk_in",
      refusals: "specific",
      members: [
        { fullName: `Type Diver ${stamp}`, minor: false, participantType: "diver" },
        { fullName: `Type Snorkel ${stamp}`, minor: true, participantType: "snorkeler" },
        { fullName: `Type Rider ${stamp}`, minor: false, participantType: "rider" },
      ],
    });
    if (!result.ok) throw new Error(`expected a seated party, got ${result.reason}`);
    const rows = await db
      .select({ id: bookings.id, type: bookings.participantType })
      .from(bookings)
      .where(
        inArray(
          bookings.id,
          result.seats.map((seat) => seat.bookingId),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row.type]));
    expect(result.seats.map((seat) => byId.get(seat.bookingId))).toEqual([
      "diver",
      "snorkeler",
      "rider",
    ]);
  });

  it("writes a counter-typed date of birth onto a new person, never over one on file", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const stamp = crypto.randomUUID().slice(0, 8);
    const [regular] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: `Dob Regular ${stamp}`, dateOfBirth: "2011-03-04" })
      .returning({ id: people.id });
    if (!regular) throw new Error("fixture insert failed");
    const result = await seatParty(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      entry: "walk_in",
      refusals: "specific",
      members: [
        {
          fullName: `Dob Lead ${stamp}`,
          email: `dob.lead.${stamp}@example.com`,
          minor: true,
          dateOfBirth: "2010-05-06",
        },
        { fullName: `Dob Kid ${stamp}`, minor: true, dateOfBirth: "2014-07-08" },
        {
          personId: regular.id,
          typedName: `Dob Regular ${stamp}`,
          minor: true,
          dateOfBirth: "2012-01-01",
        },
      ],
    });
    if (!result.ok) throw new Error(`expected a seated party, got ${result.reason}`);
    const ids = result.seats.map((seat) => seat.personId);
    const rows = await db
      .select({ id: people.id, dateOfBirth: people.dateOfBirth })
      .from(people)
      .where(inArray(people.id, ids));
    const byId = new Map(rows.map((row) => [row.id, row.dateOfBirth]));
    expect(ids.map((id) => byId.get(id))).toEqual(["2010-05-06", "2014-07-08", "2011-03-04"]);
  });

  it("never writes a counter-typed date of birth onto a record the name match left unconfirmed", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const stamp = crypto.randomUUID().slice(0, 8);
    const [other] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: `Dob Other ${stamp}` })
      .returning({ id: people.id });
    if (!other) throw new Error("fixture insert failed");
    const result = await seatParty(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      entry: "walk_in",
      refusals: "specific",
      members: [
        {
          personId: other.id,
          typedName: `Someone Else ${stamp}`,
          minor: true,
          dateOfBirth: "2012-01-01",
        },
      ],
    });
    if (!result.ok) throw new Error(`expected a seated party, got ${result.reason}`);
    expect(result.seats[0]?.identityUnconfirmed).toBe(true);
    const [row] = await db
      .select({ dateOfBirth: people.dateOfBirth })
      .from(people)
      .where(eq(people.id, other.id));
    expect(row?.dateOfBirth).toBeNull();
  });

  it("seats a member on the record picked from the on-file prompt rather than making a namesake", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const stamp = crypto.randomUUID().slice(0, 8);
    const [regular] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: `Picked Regular ${stamp}` })
      .returning({ id: people.id });
    if (!regular) throw new Error("fixture insert failed");
    const result = await seatParty(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      entry: "walk_in",
      refusals: "specific",
      members: [
        { fullName: `Picked Lead ${stamp}`, minor: false },
        { personId: regular.id, typedName: `Picked Regular ${stamp}`, minor: false },
      ],
    });
    if (!result.ok) throw new Error(`expected a seated party, got ${result.reason}`);
    expect(result.seats[1]?.personId).toBe(regular.id);
    const namesakes = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, `Picked Regular ${stamp}`)));
    expect(namesakes).toHaveLength(1);
  });

  it("refuses the party on a later member, seats nobody, and names that member", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const stamp = crypto.randomUUID().slice(0, 8);
    // A regular whose card on file falls short of the trip, picked from the
    // on-file prompt for the second row.
    const [regular] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: `Gate Regular ${stamp}` })
      .returning({ id: people.id });
    if (!regular) throw new Error("fixture insert failed");
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: regular.id,
      agency: "padi",
      level: "open_water",
      identifier: `C-${stamp}`,
      status: "verified",
    });
    await db
      .update(tripRequirements)
      .set({
        minimumCertificationLevel: "divemaster",
        requiredSpecialties: [],
        requiresNitrox: false,
      })
      .where(and(eq(tripRequirements.tripId, open.id), eq(tripRequirements.shopId, shop.id)));
    const result = await seatParty(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      entry: "walk_in",
      refusals: "specific",
      members: [
        { fullName: `Gate Snorkel ${stamp}`, minor: false, participantType: "snorkeler" },
        {
          personId: regular.id,
          typedName: `Gate Regular ${stamp}`,
          minor: false,
          participantType: "diver",
        },
      ],
    });
    expect(result).toMatchObject({ ok: false, reason: "trip_prerequisite", failedIndex: 1 });
    const seated = await db
      .select({ id: bookings.id })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(and(eq(bookings.tripId, open.id), eq(people.fullName, `Gate Snorkel ${stamp}`)));
    expect(seated).toEqual([]);
  });

  it("asks a parent or guardian to sign with a counter-ticked minor before that seat can board", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const stamp = crypto.randomUUID().slice(0, 8);
    const result = await seatParty(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      entry: "walk_in",
      refusals: "specific",
      members: [
        { fullName: `Guard Lead ${stamp}`, minor: false },
        { fullName: `Guard Kid ${stamp}`, minor: true },
      ],
    });
    if (!result.ok) throw new Error(`expected a seated party, got ${result.reason}`);
    const kidSeat = result.seats[1]?.bookingId as string;
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: kidSeat, now });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    expect(
      await completeWaiver(db, issued.token, {
        signerName: `Guard Kid ${stamp}`,
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toEqual({ ok: false, reason: "guardian_required" });
    const readiness = await getBookingReadiness(db, shop.id, kidSeat);
    expect(readiness?.status).not.toBe("ready");
    expect(readiness?.blockers.length).toBeGreaterThan(0);
  });
});
