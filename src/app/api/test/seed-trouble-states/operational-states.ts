import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { captureDepartureBoatSafety } from "@/db/boat-safety";
import { formBuddyTeam } from "@/db/buddy-pairs";
import type { AppDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { recordCrewRollCall, recordRollCall } from "@/db/manifests";
import {
  boats,
  bookings,
  certifications,
  courses,
  people,
  personRoles,
  rollCallEvents,
  tripAssignments,
  tripRequirements,
  trips,
  waiverRecords,
} from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { listStaff } from "@/db/trips";
import { completeWaiver, issueWaiverRequest } from "@/db/waivers";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";

export const OPERATIONAL_STATES = [
  "capacity",
  "boat",
  "historic",
  "buddy",
  "intro",
  "ashore",
] as const;
export type OperationalState = (typeof OPERATIONAL_STATES)[number];

/** Called only after the route's secret/harness/real-database guard accepts. */
export async function operationalStateResponse(request: Request, db: AppDb) {
  const params = new URL(request.url).searchParams;
  if (!params.has("operationalTrust")) return null;
  const state = params.get("operationalTrust") as OperationalState;
  if (!OPERATIONAL_STATES.includes(state)) {
    return NextResponse.json({ error: "invalid_state" }, { status: 400 });
  }
  // Isolated worker databases also hold private demo shops. Resolve their slug
  // here; a caller can never choose a real shop, even with the harness secret.
  const shop = await getShopBySlug(db, params.get("shop") ?? DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });
  const now = nowDate();
  const operationalTrust = await seedOperationalTrust(db, shop, state, now);
  if (state === "capacity" && params.get("certificationInterval") === "1") {
    // A true same-minute ordering: a tap, then a read that starts and ends later.
    const seat = operationalTrust.seats[0];
    if (!seat) throw new Error("certification fixture seat missing");
    await db
      .update(rollCallEvents)
      .set({
        occurredAt: new Date(now.getTime() + 1),
        certificationSnapshotStartedAt: new Date(now.getTime() + 45_125),
        certificationSnapshotCapturedAt: new Date(now.getTime() + 45_175),
      })
      .where(
        and(
          eq(rollCallEvents.shopId, shop.id),
          eq(rollCallEvents.bookingId, seat.bookingId),
          eq(rollCallEvents.checkpoint, "departure"),
        ),
      );
  }
  return NextResponse.json({ ok: true, operationalTrust });
}

/** Synthetic, bounded departures. Only the guarded trouble route calls this. */
export async function seedOperationalTrust(
  db: AppDb,
  shop: { id: string; timezone: string },
  state: OperationalState,
  now: Date,
) {
  const staff = (await listStaff(db, shop.id)).slice(0, 2).map((entry) => entry.person);
  const [actor, lastCrew] = staff;
  if (!actor || !lastCrew) throw new Error("operational fixture needs two seeded crew");
  const [hull, replacement] = await db
    .insert(boats)
    .values([
      {
        shopId: shop.id,
        name: "Trust I",
        capacity: 4,
        certifiedTotalPersons: 5,
        callSign: "TRUST1",
      },
      {
        shopId: shop.id,
        name: "Trust II",
        capacity: 4,
        certifiedTotalPersons: 7,
        callSign: "TRUST2",
      },
    ])
    .returning();
  if (!hull || !replacement) throw new Error("operational fixture boats missing");
  const [intro] =
    state === "intro"
      ? await db
          .select({ id: courses.id })
          .from(courses)
          .where(and(eq(courses.shopId, shop.id), eq(courses.isIntroCourse, true)))
          .limit(1)
      : [];
  if (state === "intro" && !intro) throw new Error("operational fixture intro course missing");
  const startsAt = new Date(now.getTime() + (state === "historic" ? -2 : 1) * HOUR_MS);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Operational trust departure",
      boatId: hull.id,
      courseId: intro?.id ?? null,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 4,
      plannedDives: 2,
    })
    .returning();
  if (!trip) throw new Error("operational fixture departure missing");
  await db.insert(tripRequirements).values({
    shopId: shop.id,
    tripId: trip.id,
    requiresWaiver: true,
    minimumCertificationLevel: intro ? null : "open_water",
  });
  await db.insert(tripAssignments).values(
    staff.map((person, index) => ({
      tripId: trip.id,
      personId: person.id,
      tripRole: index === 0 ? ("captain" as const) : ("divemaster" as const),
    })),
  );

  const names = ["Ari Vale", "Bea Quill", "Cora North", "Dax Reed"];
  const seats = [];
  for (const [index, fullName] of names.entries()) {
    const participantType =
      index === 2 ? ("snorkeler" as const) : index === 3 ? ("rider" as const) : ("diver" as const);
    const [person] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName,
        email: `operational-${index}-${trip.id}@example.com`,
        dateOfBirth: "1990-01-01",
      })
      .returning();
    if (!person) throw new Error("operational fixture person missing");
    await db.insert(personRoles).values({ personId: person.id, role: "diver" });
    const [booking] = await db
      .insert(bookings)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        personId: person.id,
        bookedAs: participantType,
        participantType,
      })
      .returning();
    if (!booking) throw new Error("operational fixture seat missing");
    if (participantType === "diver") {
      await db.insert(certifications).values({
        shopId: shop.id,
        personId: person.id,
        agency: "padi",
        level: "open_water",
        identifier: `OPERATIONAL-${state}-${index}`,
        status: "verified",
        reviewedByPersonId: actor.id,
        reviewedAt: now,
      });
    }
    const waiver = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id });
    if (!waiver.ok) throw new Error(`operational waiver refused: ${waiver.reason}`);
    const signed = await completeWaiver(db, waiver.token, {
      signerName: fullName,
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    if (!signed.ok) throw new Error("operational waiver signature refused");
    seats.push({ bookingId: booking.id, personId: person.id, fullName, participantType });
  }
  const [junior, adult] = seats;
  if (!junior || !adult) throw new Error("operational fixture pair missing");

  if (state === "capacity") {
    for (const seat of seats) {
      const result = await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seat.bookingId,
        recordedByPersonId: actor.id,
        status: "boarded",
        occurredAt: now,
      });
      if (!result.ok) throw new Error(`operational passenger boarding refused: ${result.reason}`);
    }
  }
  if (state === "capacity" || state === "boat") {
    const result = await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: actor.id,
      recordedByPersonId: actor.id,
      status: "boarded",
      occurredAt: now,
    });
    if (!result.ok) throw new Error(`operational crew count refused: ${result.reason}`);
  }
  if (state === "historic") {
    await captureDepartureBoatSafety(db, shop.id, trip.id, new Date(startsAt.getTime() - HOUR_MS));
    // A preserved historical mismatch, not an edit the current app would permit.
    await db
      .update(trips)
      .set({ boatId: replacement.id })
      .where(and(eq(trips.id, trip.id), eq(trips.shopId, shop.id)));
  }
  if (state === "buddy" || state === "ashore") {
    const localDay = calendarDateInTimezone(startsAt, shop.timezone);
    await db
      .update(people)
      .set({ dateOfBirth: `${Number(localDay.slice(0, 4)) - 11}${localDay.slice(4)}` })
      .where(and(eq(people.id, junior.personId), eq(people.shopId, shop.id)));
    // Signed first, then withdrawn: the panel must retain the shared blocked verdict.
    await db
      .update(waiverRecords)
      .set({ supersededAt: now })
      .where(
        and(
          eq(waiverRecords.shopId, shop.id),
          eq(waiverRecords.personId, junior.personId),
          isNull(waiverRecords.supersededAt),
        ),
      );
  }
  if (state === "ashore" || state === "intro") {
    const team = await formBuddyTeam(db, {
      shopId: shop.id,
      tripId: trip.id,
      recordedByPersonId: actor.id,
      now,
      members: [junior, adult].map((seat) => ({
        kind: "diver" as const,
        bookingId: seat.bookingId,
      })),
    });
    if (!team.ok) throw new Error(`operational buddy team refused: ${team.reason}`);
  }
  if (state === "ashore") {
    for (const [seat, status] of [
      [junior, "not_boarded"],
      [adult, "boarded"],
    ] as const) {
      const result = await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seat.bookingId,
        recordedByPersonId: actor.id,
        status,
        occurredAt: now,
      });
      if (!result.ok) throw new Error(`operational ashore mark refused: ${result.reason}`);
    }
  }
  return {
    tripId: trip.id,
    boatId: hull.id,
    boatName: hull.name,
    replacementBoatId: replacement.id,
    replacementBoatName: replacement.name,
    limit: 5,
    aboard: state === "capacity" ? 5 : 0,
    crewName: lastCrew.fullName,
    crewId: lastCrew.id,
    seats,
  };
}
