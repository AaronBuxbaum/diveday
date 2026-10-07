// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import type { ParticipantType } from "@/lib/participant-types";
import { seededShopContext } from "@/test/db";
import {
  cancelBooking,
  createBooking,
  createBookingParty,
  restoreBooking,
  setBookingParticipantType,
} from "./bookings";
import { formBuddyTeam } from "./buddy-pairs";
import type { AppDb } from "./client";
import { getTripManifest, recordRollCall } from "./manifests";
import { setBookingNitrox } from "./nitrox";
import { setBookingPayment } from "./payments";
import { listTripReadiness } from "./readiness";
import { getReadyPageData } from "./ready";
import {
  activityEvents,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookings,
  certifications,
  courses,
  gearItems,
  gearReservations,
  tripDeskEvents,
  tripRequirements,
  trips,
  waiverRecords,
} from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import {
  getTripRoster,
  listStaff,
  setTripParticipantTerms,
  upcomingTripsWithCounts,
} from "./trips";
import { joinTripWaitlist } from "./waitlist";
import { issueWaiverRequest } from "./waivers";

/**
 * **Who is aboard, and what each of them is doing** (ADR
 * 20261007-participant-types).
 *
 * Every test here starts from the Benwood reef trip: three divers booked, no
 * buddy teams, no course. Each one sets the two limits it is about by hand, so
 * the arithmetic it checks is on the page rather than in the seed.
 *
 * A fresh database per test rather than the file-scoped transaction: the
 * subject is the booking transaction and its trip-row lock.
 */
async function benwood() {
  const { db, shop } = await seededShopContext();
  const tripRows = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = tripRows.find((row) => row.title.startsWith("Two-Tank Reef — Benwood"));
  if (!trip) throw new Error("demo Benwood trip missing");
  const roster = await getTripRoster(db, shop.id, trip.id);
  if (roster.length !== 3) throw new Error("expected three Benwood bookings");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { db, shop, trip, roster, staff: staff.person };
}

async function limits(db: AppDb, tripId: string, capacity: number, diverCapacity: number | null) {
  await db.update(trips).set({ capacity, diverCapacity }).where(eq(trips.id, tripId));
}

let seq = 0;
async function seat(
  db: AppDb,
  shopId: string,
  tripId: string,
  participantType: ParticipantType,
  actor: "staff" | "public" = "staff",
) {
  seq += 1;
  return createBooking(db, {
    actor,
    shopId,
    tripId,
    participantType,
    fullName: `Guest ${seq}`,
    email: `guest-${seq}-${participantType}@example.com`,
  });
}

describe("two limits on one boat", () => {
  it("counts everyone against the boat and only divers against the diver seats", async () => {
    const { db, shop, trip } = await benwood();
    // Three divers aboard; room for six bodies, four of them diving.
    await limits(db, trip.id, 6, 4);

    expect(await seat(db, shop.id, trip.id, "diver")).toMatchObject({ ok: true });
    expect(await seat(db, shop.id, trip.id, "diver")).toMatchObject({
      ok: false,
      reason: "divers_full",
    });
    expect(await seat(db, shop.id, trip.id, "snorkeler")).toMatchObject({ ok: true });
    expect(await seat(db, shop.id, trip.id, "rider")).toMatchObject({ ok: true });
    // Six aboard: the boat is full for everybody, and says so as the boat.
    expect(await seat(db, shop.id, trip.id, "rider")).toMatchObject({
      ok: false,
      reason: "trip_full",
    });
    expect(await seat(db, shop.id, trip.id, "diver")).toMatchObject({
      ok: false,
      reason: "trip_full",
    });

    const roster = await getTripRoster(db, shop.id, trip.id);
    expect(roster).toHaveLength(6);
    expect(roster.filter((row) => row.booking.participantType === "diver")).toHaveLength(4);
  });

  it("a diver limit at or above the boat's capacity binds nothing", async () => {
    const { db, shop, trip } = await benwood();
    await limits(db, trip.id, 5, 5);
    expect(await seat(db, shop.id, trip.id, "diver")).toMatchObject({ ok: true });
    expect(await seat(db, shop.id, trip.id, "diver")).toMatchObject({ ok: true });
    expect(await seat(db, shop.id, trip.id, "rider")).toMatchObject({
      ok: false,
      reason: "trip_full",
    });
  });

  it("rolls a whole party back when one diver in it finds no diver seat", async () => {
    const { db, shop, trip } = await benwood();
    await limits(db, trip.id, 8, 4);
    await db.update(trips).set({ riderPriceCents: 2500 }).where(eq(trips.id, trip.id));
    const outcome = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Ana",
        email: "ana@example.com",
        participantType: "rider",
      },
      {
        actor: "public",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Ben",
        email: "ben@example.com",
        participantType: "diver",
      },
      {
        actor: "public",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Cy",
        email: "cy@example.com",
        participantType: "diver",
      },
    ]);
    expect(outcome).toMatchObject({ ok: false, reason: "divers_full", failedIndex: 2 });
    expect(await getTripRoster(db, shop.id, trip.id)).toHaveLength(3);
  });

  it("restores a cancelled diver's seat only while a diver seat is free", async () => {
    const { db, shop, trip, roster } = await benwood();
    const leaving = roster[0];
    if (!leaving) throw new Error("roster empty");
    await cancelBooking(db, shop.id, leaving.booking.id);
    await limits(db, trip.id, 8, 3);
    // Someone else took the diver seat that opened.
    expect(await seat(db, shop.id, trip.id, "diver")).toMatchObject({ ok: true });
    expect(await restoreBooking(db, shop.id, leaving.booking.id)).toBe("divers_full");
  });
});

describe("the gates a non-diver is not asked to clear", () => {
  it("asks a diver for the trip's card and never a rider or a snorkeler, while all three still owe a waiver", async () => {
    const { db, shop, trip } = await benwood();
    await limits(db, trip.id, 8, null);
    await db
      .update(tripRequirements)
      .set({
        minimumCertificationLevel: "advanced_open_water",
        requiredSpecialties: [],
        requiresNitrox: true,
      })
      .where(and(eq(tripRequirements.tripId, trip.id), eq(tripRequirements.shopId, shop.id)));

    const diver = await seat(db, shop.id, trip.id, "diver");
    const rider = await seat(db, shop.id, trip.id, "rider");
    const snorkeler = await seat(db, shop.id, trip.id, "snorkeler");
    if (!diver.ok || !rider.ok || !snorkeler.ok) throw new Error("setup failed");

    const rows = await listTripReadiness(db, shop.id, trip.id);
    const codesOf = (bookingId: string) =>
      rows.find((row) => row.booking.id === bookingId)?.readiness.blockers.map((b) => b.code) ?? [];
    const certCodes = (codes: string[]) =>
      codes.filter((code) => code.startsWith("certification_") || code.startsWith("nitrox_"));

    expect(certCodes(codesOf(diver.bookingId)).length).toBeGreaterThan(0);
    for (const bookingId of [rider.bookingId, snorkeler.bookingId]) {
      const codes = codesOf(bookingId);
      expect(certCodes(codes)).toEqual([]);
      // The waiver is still everyone's (H-01/H-03): nobody has signed yet.
      expect(codes.some((code) => code.startsWith("waiver_"))).toBe(true);
      expect(rows.find((row) => row.booking.id === bookingId)?.readiness.status).toBe("blocked");
    }
  });

  it("refuses a snorkeler or a rider on a course session", async () => {
    const { db, shop, trip } = await benwood();
    const [course] = await db
      .insert(courses)
      .values({ shopId: shop.id, title: "Participant course", slug: `participant-${trip.id}` })
      .returning();
    if (!course) throw new Error("course setup failed");
    await db.update(trips).set({ courseId: course.id }).where(eq(trips.id, trip.id));

    for (const type of ["snorkeler", "rider"] as const) {
      expect(await seat(db, shop.id, trip.id, type)).toMatchObject({
        ok: false,
        reason: "participant_type_unavailable",
      });
    }
  });

  it("will not store a nitrox request on a seat that does not dive", async () => {
    const { db, shop, trip } = await benwood();
    const rider = await seat(db, shop.id, trip.id, "rider");
    if (!rider.ok) throw new Error("rider not seated");
    await expect(
      db.update(bookings).set({ wantsNitrox: true }).where(eq(bookings.id, rider.bookingId)),
    ).rejects.toThrow();
  });

  it("keeps a buddy team to divers", async () => {
    const { db, shop, trip, roster, staff } = await benwood();
    const rider = await seat(db, shop.id, trip.id, "rider");
    const first = roster[0];
    if (!rider.ok || !first) throw new Error("setup failed");
    expect(
      await formBuddyTeam(db, {
        shopId: shop.id,
        tripId: trip.id,
        members: [
          { kind: "diver", bookingId: first.booking.id },
          { kind: "diver", bookingId: rider.bookingId },
        ],
        recordedByPersonId: staff.id,
      }),
    ).toMatchObject({ ok: false, reason: "not_a_diver" });
  });
});

/** The roster's "Coming as", from a staffer, on the departure in the URL. */
async function change(
  db: AppDb,
  ids: { shopId: string; tripId: string; actorPersonId: string },
  bookingId: string,
  to: ParticipantType,
  confirmCertBlock = false,
) {
  return setBookingParticipantType(db, { ...ids, bookingId, to, confirmCertBlock });
}

/** This trip now asks for Advanced Open Water, and nothing else of its own. */
async function demandAdvanced(db: AppDb, shopId: string, tripId: string) {
  await db
    .update(tripRequirements)
    .set({
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: [],
      requiresNitrox: false,
    })
    .where(and(eq(tripRequirements.tripId, tripId), eq(tripRequirements.shopId, shopId)));
}

/** A verified Open Water card on file: known to the shop, and short of Advanced. */
async function openWaterCard(db: AppDb, shopId: string, bookingId: string) {
  const [row] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  if (!row) throw new Error("booking missing");
  await db.insert(certifications).values({
    shopId,
    personId: row.personId,
    agency: "padi",
    level: "open_water",
    identifier: `OW-${bookingId.slice(0, 8)}`,
    status: "verified",
  });
}

describe("setBookingParticipantType", () => {
  it("lets a diver stay aboard as a snorkeler, taking the nitrox request off with the water", async () => {
    const { db, shop, trip, roster, staff } = await benwood();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    const first = roster[0];
    if (!first) throw new Error("roster empty");
    await db.update(bookings).set({ wantsNitrox: true }).where(eq(bookings.id, first.booking.id));

    expect(await change(db, ids, first.booking.id, "snorkeler")).toMatchObject({
      ok: true,
      changed: true,
      from: "diver",
    });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, first.booking.id));
    // What it was sold as stays: the crew's "booked as diver" reads from it.
    expect(row).toMatchObject({
      participantType: "snorkeler",
      bookedAs: "diver",
      wantsNitrox: false,
    });
  });

  it("refuses to make a diver of someone when every diver seat is taken", async () => {
    const { db, shop, trip, staff } = await benwood();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    await limits(db, trip.id, 8, 3);
    const snorkeler = await seat(db, shop.id, trip.id, "snorkeler");
    if (!snorkeler.ok) throw new Error("snorkeler not seated");
    expect(await change(db, ids, snorkeler.bookingId, "diver")).toMatchObject({
      ok: false,
      reason: "divers_full",
    });
    // Becoming a rider is never refused by the diver limit.
    expect(await change(db, ids, snorkeler.bookingId, "rider")).toMatchObject({
      ok: true,
      changed: true,
    });
  });

  it("refuses to take a diver out of the water while they are on a buddy team", async () => {
    const { db, shop, trip, roster, staff } = await benwood();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    const [a, b] = roster;
    if (!a || !b) throw new Error("roster short");
    await formBuddyTeam(db, {
      shopId: shop.id,
      tripId: trip.id,
      members: [
        { kind: "diver", bookingId: a.booking.id },
        { kind: "diver", bookingId: b.booking.id },
      ],
      recordedByPersonId: staff.id,
    });
    expect(await change(db, ids, a.booking.id, "rider")).toMatchObject({
      ok: false,
      reason: "on_buddy_team",
    });
  });

  it("reports an unchanged seat as unchanged, and a booking it cannot see as not found", async () => {
    const { db, shop, trip, roster, staff } = await benwood();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    const first = roster[0];
    if (!first) throw new Error("roster empty");
    expect(await change(db, ids, first.booking.id, "diver")).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(await change(db, ids, "00000000-0000-4000-8000-000000000000", "rider")).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("will not change a seat named against another departure's URL", async () => {
    const { db, shop, trip, roster, staff } = await benwood();
    const first = roster[0];
    const other = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find(
      (row) => row.id !== trip.id,
    );
    if (!first || !other) throw new Error("setup failed");
    expect(
      await change(
        db,
        { shopId: shop.id, tripId: other.id, actorPersonId: staff.id },
        first.booking.id,
        "rider",
      ),
    ).toMatchObject({ ok: false, reason: "not_found" });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, first.booking.id));
    expect(row?.participantType).toBe("diver");
  });

  it("writes the trail and the catch-up line inside the change, naming the card check it cleared", async () => {
    const { db, shop, trip, staff } = await benwood();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    await limits(db, trip.id, 8, null);
    await demandAdvanced(db, shop.id, trip.id);
    const diver = await seat(db, shop.id, trip.id, "diver");
    if (!diver.ok) throw new Error("diver not seated");
    await openWaterCard(db, shop.id, diver.bookingId);

    expect(await change(db, ids, diver.bookingId, "snorkeler")).toMatchObject({ ok: true });

    const [entry] = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.tripId, trip.id),
          eq(activityEvents.code, "participant_type_changed"),
        ),
      );
    expect(entry?.actorPersonId).toBe(staff.id);
    expect(entry?.params).toMatchObject({ from: "diver", type: "snorkeler", certCheck: "cleared" });
    const params = entry?.params as Record<string, string> | undefined;
    expect(String(params?.cleared)).toContain("certification_");

    const desk = await db
      .select()
      .from(tripDeskEvents)
      .where(and(eq(tripDeskEvents.tripId, trip.id), eq(tripDeskEvents.kind, "now_snorkeling")));
    expect(desk).toHaveLength(1);
    expect(desk[0]?.bookingId).toBe(diver.bookingId);
  });

  it("keeps a physician's referral blocking a diver switched to snorkeling", async () => {
    // Adversarial: the type change is the one door that clears a card block
    // without a card. It must not be a door past a medical hold too.
    const { db, shop, trip, staff } = await benwood();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    await limits(db, trip.id, 8, null);
    const diver = await seat(db, shop.id, trip.id, "diver");
    if (!diver.ok) throw new Error("diver not seated");
    await issueWaiverRequest(db, { shopId: shop.id, bookingId: diver.bookingId });
    await db
      .update(waiverRecords)
      .set({ status: "medical_review", medicalReviewRequired: true })
      .where(eq(waiverRecords.bookingId, diver.bookingId));

    expect(await change(db, ids, diver.bookingId, "snorkeler")).toMatchObject({ ok: true });
    const rows = await listTripReadiness(db, shop.id, trip.id);
    const readiness = rows.find((row) => row.booking.id === diver.bookingId)?.readiness;
    expect(readiness?.status).toBe("blocked");
    expect(readiness?.blockers.map((blocker) => blocker.code)).toContain("medical_review");
  });

  it("runs the card check on joining the dive, and writes past it only when asked to", async () => {
    const { db, shop, trip, staff } = await benwood();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    await limits(db, trip.id, 8, null);
    await demandAdvanced(db, shop.id, trip.id);
    const snorkeler = await seat(db, shop.id, trip.id, "snorkeler");
    if (!snorkeler.ok) throw new Error("snorkeler not seated");
    await openWaterCard(db, shop.id, snorkeler.bookingId);

    const refused = await change(db, ids, snorkeler.bookingId, "diver");
    expect(refused).toMatchObject({
      ok: false,
      reason: "cert_blocked",
      refusal: { requiredLevel: "advanced_open_water", heldLevel: "open_water" },
    });
    const [still] = await db.select().from(bookings).where(eq(bookings.id, snorkeler.bookingId));
    expect(still?.participantType).toBe("snorkeler");

    expect(await change(db, ids, snorkeler.bookingId, "diver", true)).toMatchObject({
      ok: true,
      changed: true,
    });
    const [entry] = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.tripId, trip.id),
          eq(activityEvents.code, "participant_type_changed"),
        ),
      );
    expect(entry?.params).toMatchObject({ type: "diver", certCheck: "overridden" });
    // Only the sale-time check was skipped: the rail still asks for the card.
    const rows = await listTripReadiness(db, shop.id, trip.id);
    expect(rows.find((row) => row.booking.id === snorkeler.bookingId)?.readiness.status).toBe(
      "blocked",
    );
  });

  it("refuses every change once the boat is home, and joining the dive once it has left", async () => {
    const { db, shop, trip, roster, staff } = await benwood();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    await limits(db, trip.id, 8, null);
    const snorkeler = await seat(db, shop.id, trip.id, "snorkeler");
    const [a, b] = roster;
    if (!snorkeler.ok || !a || !b) throw new Error("setup failed");

    // Out on the water: between dives a diver may sit the second one out, but
    // nobody joins the dive past the dock's check.
    const now = nowDate().getTime();
    await db
      .update(trips)
      .set({ startsAt: new Date(now - 3 * 3_600_000), endsAt: new Date(now + 3 * 3_600_000) })
      .where(eq(trips.id, trip.id));
    expect(await change(db, ids, snorkeler.bookingId, "diver")).toMatchObject({
      ok: false,
      reason: "trip_unavailable",
    });
    expect(await change(db, ids, a.booking.id, "snorkeler")).toMatchObject({ ok: true });

    // Home: the head count is closed and the record stays what it was.
    await db
      .update(trips)
      .set({ startsAt: new Date(now - 8 * 3_600_000), endsAt: new Date(now - 3 * 3_600_000) })
      .where(eq(trips.id, trip.id));
    expect(await change(db, ids, b.booking.id, "rider")).toMatchObject({
      ok: false,
      reason: "trip_unavailable",
    });
  });

  it("refuses joining the dive from the departure time, not after the selling grace", async () => {
    const { db, shop, trip, staff } = await benwood();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    await limits(db, trip.id, 8, null);
    const snorkeler = await seat(db, shop.id, trip.id, "snorkeler");
    if (!snorkeler.ok) throw new Error("setup failed");
    // Ten minutes past the time on the board: still inside `hasSailed`'s
    // grace for a late booking, and too late to put anyone in the water.
    const now = nowDate().getTime();
    await db
      .update(trips)
      .set({ startsAt: new Date(now - 10 * 60_000), endsAt: new Date(now + 4 * 3_600_000) })
      .where(eq(trips.id, trip.id));
    expect(await change(db, ids, snorkeler.bookingId, "diver")).toMatchObject({
      ok: false,
      reason: "trip_unavailable",
    });
  });

  it("retires a pending checkout that quoted the seat at its old type", async () => {
    const { db, shop, trip, staff } = await benwood();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    await limits(db, trip.id, 8, null);
    const diver = await seat(db, shop.id, trip.id, "diver");
    if (!diver.ok) throw new Error("diver not seated");
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        stripeAccountId: "acct_test_participants",
        stripeSessionId: `cs_test_${diver.bookingId}`,
        status: "pending",
        amountPerDiverCents: 12_000,
        totalCents: 12_000,
        currency: "usd",
      })
      .returning();
    if (!checkout) throw new Error("checkout setup failed");
    await db.insert(bookingCheckoutBookings).values({
      shopId: shop.id,
      checkoutId: checkout.id,
      bookingId: diver.bookingId,
      tripCents: 12_000,
    });

    expect(await change(db, ids, diver.bookingId, "rider")).toMatchObject({ ok: true });
    const [after] = await db
      .select({ status: bookingCheckouts.status })
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkout.id));
    expect(after?.status).toBe("expired");
  });
});

/** Waiver and payment off, so a seat's readiness is its card alone. */
async function cardOnlyGate(db: AppDb, shopId: string, tripId: string) {
  await db
    .update(tripRequirements)
    .set({ requiresWaiver: false, requiresPayment: false })
    .where(and(eq(tripRequirements.tripId, tripId), eq(tripRequirements.shopId, shopId)));
}

/** A verified card at `level` for the person on this seat. */
async function cardAt(db: AppDb, shopId: string, bookingId: string, level: "advanced_open_water") {
  const [row] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  if (!row) throw new Error("booking missing");
  await db.insert(certifications).values({
    shopId,
    personId: row.personId,
    agency: "padi",
    level,
    identifier: `AOW-${bookingId.slice(0, 8)}`,
    status: "verified",
  });
}

describe("a boarding record is not carried into the water", () => {
  async function boardedSnorkeler() {
    const context = await benwood();
    const { db, shop, trip, staff } = context;
    await limits(db, trip.id, 8, null);
    await cardOnlyGate(db, shop.id, trip.id);
    await demandAdvanced(db, shop.id, trip.id);
    const snorkeler = await seat(db, shop.id, trip.id, "snorkeler");
    if (!snorkeler.ok) throw new Error("snorkeler not seated");
    // Boarded as a snorkeler: no card asked, and the gate let them on.
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: snorkeler.bookingId,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).toMatchObject({ ok: true });
    return { ...context, bookingId: snorkeler.bookingId };
  }

  it("refuses a boarded snorkeler without the card the change to diver, even past the card check", async () => {
    const { db, shop, trip, staff, bookingId } = await boardedSnorkeler();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };

    // No card on file at all: the booking-time check lets that through (the
    // dock asks), and the boarding gate, asked again now, does not.
    expect(await change(db, ids, bookingId, "diver")).toEqual({
      ok: false,
      reason: "boarded_not_ready",
    });
    // A card short of the trip: refused at the card check, and "Change
    // anyway" skips only that check; the boarding gate still rolls it back.
    await openWaterCard(db, shop.id, bookingId);
    expect(await change(db, ids, bookingId, "diver")).toMatchObject({
      ok: false,
      reason: "cert_blocked",
    });
    expect(await change(db, ids, bookingId, "diver", true)).toEqual({
      ok: false,
      reason: "boarded_not_ready",
    });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.participantType).toBe("snorkeler");
    const trail = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.tripId, trip.id),
          eq(activityEvents.code, "participant_type_changed"),
        ),
      );
    expect(trail).toHaveLength(0);
  });

  it("lets a boarded snorkeler with the card the trip asks for start diving", async () => {
    const { db, shop, trip, staff, bookingId } = await boardedSnorkeler();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    await cardAt(db, shop.id, bookingId, "advanced_open_water");

    expect(await change(db, ids, bookingId, "diver")).toMatchObject({ ok: true, changed: true });
    const desk = await db
      .select()
      .from(tripDeskEvents)
      .where(and(eq(tripDeskEvents.tripId, trip.id), eq(tripDeskEvents.kind, "now_diving")));
    expect(desk).toHaveLength(1);
  });

  it("never lets a seat changed past a missing card be recorded boarded", async () => {
    const { db, shop, trip, staff } = await benwood();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    await limits(db, trip.id, 8, null);
    await cardOnlyGate(db, shop.id, trip.id);
    await demandAdvanced(db, shop.id, trip.id);
    const snorkeler = await seat(db, shop.id, trip.id, "snorkeler");
    if (!snorkeler.ok) throw new Error("snorkeler not seated");

    expect(await change(db, ids, snorkeler.bookingId, "diver", true)).toMatchObject({ ok: true });
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: snorkeler.bookingId,
        recordedByPersonId: staff.id,
        status: "boarded",
      }),
    ).toMatchObject({ ok: false, reason: "not_ready" });
  });
});

describe("what a type change leaves behind", () => {
  it("lets go of the regulator a new snorkeler will not use, and keeps the mask", async () => {
    const { db, shop, trip, staff } = await benwood();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    await limits(db, trip.id, 8, null);
    const diver = await seat(db, shop.id, trip.id, "diver");
    if (!diver.ok) throw new Error("diver not seated");
    const units = await db
      .insert(gearItems)
      .values([
        { shopId: shop.id, kind: "regulator", label: "REG-PT-1" },
        { shopId: shop.id, kind: "mask", label: "MASK-PT-1" },
      ])
      .returning({ id: gearItems.id, kind: gearItems.kind });
    await db.insert(gearReservations).values(
      units.map((unit) => ({
        shopId: shop.id,
        gearItemId: unit.id,
        bookingId: diver.bookingId,
        reservedFrom: "2099-01-01",
        reservedUntil: "2099-01-01",
      })),
    );

    expect(await change(db, ids, diver.bookingId, "snorkeler")).toMatchObject({ ok: true });
    const kept = await db
      .select({ kind: gearItems.kind })
      .from(gearReservations)
      .innerJoin(gearItems, eq(gearItems.id, gearReservations.gearItemId))
      .where(eq(gearReservations.bookingId, diver.bookingId));
    expect(kept.map((row) => row.kind)).toEqual(["mask"]);

    expect(await change(db, ids, diver.bookingId, "rider")).toMatchObject({ ok: true });
    const none = await db
      .select()
      .from(gearReservations)
      .where(eq(gearReservations.bookingId, diver.bookingId));
    expect(none).toHaveLength(0);
  });

  it("says a paid rider who starts diving owes the difference, and collects nothing", async () => {
    const { db, shop, trip, staff } = await benwood();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    await limits(db, trip.id, 8, null);
    await cardOnlyGate(db, shop.id, trip.id);
    await db
      .update(trips)
      .set({ priceCents: 12_000, riderPriceCents: 2_500 })
      .where(eq(trips.id, trip.id));
    const rider = await seat(db, shop.id, trip.id, "rider");
    if (!rider.ok) throw new Error("rider not seated");
    await cardAt(db, shop.id, rider.bookingId, "advanced_open_water");
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: rider.bookingId,
      status: "paid",
      amountCents: 2_500,
      currency: "usd",
    });

    expect(await change(db, ids, rider.bookingId, "diver")).toMatchObject({
      ok: true,
      owedCents: 9_500,
    });
    const owed = await db
      .select()
      .from(tripDeskEvents)
      .where(and(eq(tripDeskEvents.tripId, trip.id), eq(tripDeskEvents.kind, "balance_owed")));
    expect(owed).toHaveLength(1);

    // Cheaper the other way: nothing owed, and nothing said.
    expect(await change(db, ids, rider.bookingId, "snorkeler")).toMatchObject({
      ok: true,
      owedCents: 0,
    });
  });

  it("owes nothing on an unpaid seat that now costs more", async () => {
    const { db, shop, trip, staff } = await benwood();
    const ids = { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id };
    await limits(db, trip.id, 8, null);
    await cardOnlyGate(db, shop.id, trip.id);
    await db
      .update(trips)
      .set({ priceCents: 12_000, riderPriceCents: 0 })
      .where(eq(trips.id, trip.id));
    const rider = await seat(db, shop.id, trip.id, "rider");
    if (!rider.ok) throw new Error("rider not seated");
    await cardAt(db, shop.id, rider.bookingId, "advanced_open_water");

    expect(await change(db, ids, rider.bookingId, "diver")).toMatchObject({
      ok: true,
      owedCents: 0,
    });
  });
});

describe("the doors around a seat that is not a diver's", () => {
  it("never gives a snorkeler or a rider a nitrox fill, rather than throwing on the column's check", async () => {
    const { db, shop, trip } = await benwood();
    await limits(db, trip.id, 8, null);
    const rider = await seat(db, shop.id, trip.id, "rider");
    if (!rider.ok) throw new Error("rider not seated");
    expect(
      await setBookingNitrox(db, {
        shopId: shop.id,
        bookingId: rider.bookingId,
        wantsNitrox: true,
      }),
    ).toMatchObject({ ok: true, wantsNitrox: false });
  });

  it("keeps the wait list open when the boat has room but every diver's seat is taken", async () => {
    const { db, shop, trip } = await benwood();
    // Three divers aboard, three diver seats, room for eight.
    await limits(db, trip.id, 8, 3);
    const outcome = await joinTripWaitlist(db, {
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Wren Diver",
      email: "wren@example.com",
    });
    expect(outcome).not.toMatchObject({ ok: false, reason: "trip_available" });
    expect(outcome).toMatchObject({ ok: true });
  });

  it("carries what the seat was sold as onto the manifest row", async () => {
    const { db, shop, trip, roster, staff } = await benwood();
    const first = roster[0];
    if (!first) throw new Error("roster empty");
    await change(
      db,
      { shopId: shop.id, tripId: trip.id, actorPersonId: staff.id },
      first.booking.id,
      "rider",
    );
    const manifest = await getTripManifest(db, shop.id, trip.id);
    expect(manifest?.divers.find((row) => row.bookingId === first.booking.id)).toMatchObject({
      participantType: "rider",
      bookedAs: "diver",
    });
  });
});

describe("the public form sells only what the departure prices", () => {
  it("refuses a public rider seat on a departure that names no rider price, and takes it once one is named", async () => {
    const { db, shop, trip } = await benwood();
    await limits(db, trip.id, 8, null);
    expect(await seat(db, shop.id, trip.id, "rider", "public")).toMatchObject({
      ok: false,
      reason: "participant_type_unavailable",
    });
    // Staff may still seat one; the anonymous form may not.
    expect(await seat(db, shop.id, trip.id, "rider")).toMatchObject({ ok: true });
    await db.update(trips).set({ riderPriceCents: 0 }).where(eq(trips.id, trip.id));
    expect(await seat(db, shop.id, trip.id, "rider", "public")).toMatchObject({ ok: true });
  });
});

describe("the diver's own page asks for the seat's own price", () => {
  it("offers pay to a diver and never to a rider whose seat the shop gives away", async () => {
    const { db, shop, trip } = await benwood();
    await limits(db, trip.id, 8, null);
    await upsertShopStripeAccount(db, shop.id, "acct_ready_types");
    await setShopStripeAccountStatus(db, "acct_ready_types", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    await db.update(trips).set({ riderPriceCents: 0 }).where(eq(trips.id, trip.id));
    const diver = await seat(db, shop.id, trip.id, "diver");
    const rider = await seat(db, shop.id, trip.id, "rider");
    if (!diver.ok || !rider.ok) throw new Error("setup seats refused");

    const diverPage = await getReadyPageData(db, diver.bookingId);
    const riderPage = await getReadyPageData(db, rider.bookingId);
    expect(riderPage?.participantType).toBe("rider");
    // The rider's seat is free, so there is nothing to pay, even though the
    // trip's dive fare is set and the shop takes cards.
    expect(riderPage?.canPay).toBe(false);
    expect(diverPage?.canPay).toBe(true);
  });
});

describe("the manifest counts everyone", () => {
  it("lists a snorkeler and a rider beside the divers, typed, and counts all five", async () => {
    const { db, shop, trip } = await benwood();
    await limits(db, trip.id, 8, null);
    const snorkeler = await seat(db, shop.id, trip.id, "snorkeler");
    const rider = await seat(db, shop.id, trip.id, "rider");
    if (!snorkeler.ok || !rider.ok) throw new Error("setup failed");

    const manifest = await getTripManifest(db, shop.id, trip.id);
    expect(manifest?.divers).toHaveLength(5);
    expect(manifest?.summary.totalDivers).toBe(5);
    expect(manifest?.summary.byType).toEqual({ diver: 3, snorkeler: 1, rider: 1 });
    expect(manifest?.divers.find((row) => row.bookingId === rider.bookingId)?.participantType).toBe(
      "rider",
    );
    // A rider is a body the crew calls like any other: awaiting until called.
    expect(manifest?.summary.awaiting).toBe(5);
  });
});

describe("setTripParticipantTerms", () => {
  it("saves prices and a diver limit, and refuses a limit below the divers aboard", async () => {
    const { db, shop, trip } = await benwood();
    await limits(db, trip.id, 8, null);
    expect(
      await setTripParticipantTerms(db, shop.id, trip.id, {
        snorkelerPriceCents: 4500,
        riderPriceCents: 0,
        diverCapacity: 6,
      }),
    ).toEqual({ ok: true });
    const [row] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(row).toMatchObject({ snorkelerPriceCents: 4500, riderPriceCents: 0, diverCapacity: 6 });

    expect(
      await setTripParticipantTerms(db, shop.id, trip.id, {
        snorkelerPriceCents: null,
        riderPriceCents: null,
        diverCapacity: 2,
      }),
    ).toEqual({ ok: false, reason: "diver_seats_below_booked", detail: { divers: 3 } });
    expect(
      await setTripParticipantTerms(db, shop.id, trip.id, {
        snorkelerPriceCents: null,
        riderPriceCents: null,
        diverCapacity: 9,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
  });
});
