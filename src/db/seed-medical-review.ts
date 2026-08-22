import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { bookings, certifications, people, personRoles, type trips, waiverRecords } from "./schema";
import { at } from "./seed-clock";
import { reviewedBy } from "./seed-review";

/** A fictitious diver used only to train on the unresolved medical-review state. */
const DEMO_MEDICAL_REVIEW_DIVER = "Morgan Vale";
const DEMO_MEDICAL_REVIEW_TRIP = "Afternoon Two-Tank — French Reef";
const DEMO_MEDICAL_REVIEW_EMAIL = "medical-review-demo@demo.invalid";

/**
 * One status-only medical-review scenario for demo and staff training.
 *
 * Morgan and the record are synthetic. In particular, this deliberately stores
 * no questionnaire answers, diagnosis, physician information, or other
 * medical details. `medicalReviewRequired` and the unresolved status are the
 * complete fixture: they demonstrate the fail-closed boarding hold without
 * presenting invented health information as evidence.
 */
export async function seedMedicalReview(
  db: DbExecutor,
  shopId: string,
  waiverTemplate: { id: string; title: string; version: number; body: string },
  tripRows: (typeof trips.$inferSelect)[],
  /** The staffer this diver's card was checked by — see `reviewedBy`. */
  reviewerId: string,
): Promise<void> {
  const trip = tripRows.find((row) => row.title === DEMO_MEDICAL_REVIEW_TRIP);
  if (!trip) throw new Error("seedMedicalReview: training trip missing");

  // Scenario seeders are also useful independently while building or repairing
  // a demo. The synthetic email is the upstream identity marker: reusing the
  // person and booking lets a retry repair a run that stopped before its waiver.
  const tokenHash = `seed-medical-review-${shopId}`;
  const [existing] = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(and(eq(waiverRecords.shopId, shopId), eq(waiverRecords.tokenHash, tokenHash)))
    .limit(1);
  if (existing) return;

  const [existingDiver] = await db
    .select()
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.email, DEMO_MEDICAL_REVIEW_EMAIL)))
    .limit(1);
  const [insertedDiver] = existingDiver
    ? [undefined]
    : await db
        .insert(people)
        .values({
          shopId,
          fullName: DEMO_MEDICAL_REVIEW_DIVER,
          email: DEMO_MEDICAL_REVIEW_EMAIL,
          emergencyContactName: "Dana Vale (sister)",
          emergencyContactPhone: "+1-305-555-0199",
          createdAt: at(-2, 9),
        })
        .returning();
  const diver = existingDiver ?? insertedDiver;
  if (!diver) throw new Error("seedMedicalReview: diver insert returned no row");

  await db.insert(personRoles).values({ personId: diver.id, role: "diver" }).onConflictDoNothing();
  await db
    .insert(certifications)
    .values({
      shopId,
      personId: diver.id,
      agency: "padi",
      level: "open_water",
      identifier: "DEMO-MEDICAL-REVIEW",
      status: "verified",
      ...reviewedBy(reviewerId),
    })
    .onConflictDoNothing();

  const [existingBooking] = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, trip.id),
        eq(bookings.personId, diver.id),
      ),
    )
    .limit(1);
  const [insertedBooking] = existingBooking
    ? [undefined]
    : await db
        .insert(bookings)
        .values({ shopId, tripId: trip.id, personId: diver.id, createdAt: at(-2, 10) })
        .returning();
  const booking = existingBooking ?? insertedBooking;
  if (!booking) throw new Error("seedMedicalReview: booking insert returned no row");

  const signedAt = at(-1, 10);
  await db.insert(waiverRecords).values({
    shopId,
    bookingId: booking.id,
    personId: diver.id,
    templateId: waiverTemplate.id,
    templateTitle: waiverTemplate.title,
    templateVersion: waiverTemplate.version,
    templateBody: waiverTemplate.body,
    status: "medical_review",
    tokenHash,
    expiresAt: at(30, 12),
    signedName: DEMO_MEDICAL_REVIEW_DIVER,
    signatureMethod: "in_person",
    consentedAt: signedAt,
    signedAt,
    medicalReviewRequired: true,
    completedAt: signedAt,
    createdAt: signedAt,
  });
}
