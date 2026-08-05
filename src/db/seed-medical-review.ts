import type { DbExecutor } from "./client";
import { bookings, certifications, people, personRoles, type trips, waiverRecords } from "./schema";
import { at } from "./seed-clock";

/** A fictitious diver used only to train on the unresolved medical-review state. */
export const DEMO_MEDICAL_REVIEW_DIVER = "Morgan Vale";
export const DEMO_MEDICAL_REVIEW_TRIP = "Afternoon Two-Tank — French Reef";

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
): Promise<void> {
  const trip = tripRows.find((row) => row.title === DEMO_MEDICAL_REVIEW_TRIP);
  if (!trip) throw new Error("seedMedicalReview: training trip missing");

  const [diver] = await db
    .insert(people)
    .values({
      shopId,
      fullName: DEMO_MEDICAL_REVIEW_DIVER,
      email: "medical-review-demo@demo.invalid",
      emergencyContactName: "Dana Vale (sister)",
      emergencyContactPhone: "+1-305-555-0199",
      createdAt: at(-2, 9),
    })
    .returning();
  if (!diver) throw new Error("seedMedicalReview: diver insert returned no row");

  await db.insert(personRoles).values({ personId: diver.id, role: "diver" });
  await db.insert(certifications).values({
    shopId,
    personId: diver.id,
    agency: "padi",
    level: "open_water",
    identifier: "DEMO-MEDICAL-REVIEW",
    status: "verified",
  });

  const [booking] = await db
    .insert(bookings)
    .values({ shopId, tripId: trip.id, personId: diver.id, createdAt: at(-2, 10) })
    .returning();
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
    tokenHash: `seed-medical-review-${shopId}`,
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
