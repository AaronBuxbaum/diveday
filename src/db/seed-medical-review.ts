import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { bookings, certifications, people, personRoles, type trips, waiverRecords } from "./schema";
import { at } from "./seed-clock";
import { reviewedBy } from "./seed-review";

/** Two fictitious divers used only to train on the medical-review states. */
const DEMO_MEDICAL_REVIEW_DIVER = "Morgan Vale";
const DEMO_MEDICAL_REVIEW_TRIP = "Afternoon Two-Tank — French Reef";
const DEMO_MEDICAL_REVIEW_EMAIL = "medical-review-demo@demo.invalid";
const DEMO_NOT_CLEARED_DIVER = "Rowan Pike";
const DEMO_NOT_CLEARED_EMAIL = "medical-not-cleared-demo@demo.invalid";

/** How the physician's answer landed, or that it has not landed at all. */
type MedicalOutcome = "awaiting" | "not_cleared";

/**
 * Both status-only medical-review scenarios for demo and staff training: a
 * referral still waiting on a physician, and one a physician refused.
 *
 * The divers and their records are synthetic. In particular, this deliberately
 * stores no questionnaire answers, diagnosis, or other medical details.
 * `medicalReviewRequired`, the unresolved status, and the refusal stamp are the
 * complete fixture: they demonstrate the fail-closed boarding hold without
 * presenting invented health information as evidence. The physician name on the
 * refused record is the one exception, and it is there because the refusal
 * cannot be stored without evidence — the `..._evidenced` check refuses a row
 * that names neither a clinician nor a document.
 *
 * **Two divers rather than two states on one**, because they are simultaneous
 * facts a shop reads side by side: the row that is still work and the row that
 * has stopped being work. A demo with only the first cannot show the difference
 * issue #1283 is about.
 */
export async function seedMedicalReview(
  db: DbExecutor,
  shopId: string,
  waiverTemplate: {
    id: string;
    title: string;
    version: number;
    materialGeneration: number;
    body: string;
  },
  tripRows: (typeof trips.$inferSelect)[],
  /** The staffer this diver's card was checked by — see `reviewedBy`. */
  reviewerId: string,
): Promise<void> {
  await seedHeldDiver(db, shopId, waiverTemplate, tripRows, reviewerId, {
    fullName: DEMO_MEDICAL_REVIEW_DIVER,
    email: DEMO_MEDICAL_REVIEW_EMAIL,
    tokenSuffix: "medical-review",
    identifier: "DEMO-MEDICAL-REVIEW",
    emergencyContactName: "Dana Vale (sister)",
    emergencyContactPhone: "+1-305-555-0199",
    outcome: "awaiting",
  });
  await seedHeldDiver(db, shopId, waiverTemplate, tripRows, reviewerId, {
    fullName: DEMO_NOT_CLEARED_DIVER,
    email: DEMO_NOT_CLEARED_EMAIL,
    tokenSuffix: "medical-not-cleared",
    identifier: "DEMO-MEDICAL-NOT-CLEARED",
    emergencyContactName: "Sam Pike (partner)",
    emergencyContactPhone: "+1-305-555-0187",
    outcome: "not_cleared",
  });
}

async function seedHeldDiver(
  db: DbExecutor,
  shopId: string,
  waiverTemplate: {
    id: string;
    title: string;
    version: number;
    materialGeneration: number;
    body: string;
  },
  tripRows: (typeof trips.$inferSelect)[],
  reviewerId: string,
  diverSpec: {
    fullName: string;
    email: string;
    tokenSuffix: string;
    identifier: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    outcome: MedicalOutcome;
  },
): Promise<void> {
  const trip = tripRows.find((row) => row.title === DEMO_MEDICAL_REVIEW_TRIP);
  if (!trip) throw new Error("seedMedicalReview: training trip missing");

  // Scenario seeders are also useful independently while building or repairing
  // a demo. The synthetic email is the upstream identity marker: reusing the
  // person and booking lets a retry repair a run that stopped before its waiver.
  const tokenHash = `seed-${diverSpec.tokenSuffix}-${shopId}`;
  const [existing] = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(and(eq(waiverRecords.shopId, shopId), eq(waiverRecords.tokenHash, tokenHash)))
    .limit(1);
  if (existing) return;

  const [existingDiver] = await db
    .select()
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.email, diverSpec.email)))
    .limit(1);
  const [insertedDiver] = existingDiver
    ? [undefined]
    : await db
        .insert(people)
        .values({
          shopId,
          fullName: diverSpec.fullName,
          email: diverSpec.email,
          emergencyContactName: diverSpec.emergencyContactName,
          emergencyContactPhone: diverSpec.emergencyContactPhone,
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
      identifier: diverSpec.identifier,
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
  // The refusal is dated after the disclosure it answers, exactly as
  // `recordMedicalEvaluation` requires of a real one: a letter written before
  // the diver disclosed cannot have answered them.
  const evaluatedOn = at(-1, 12).toISOString().slice(0, 10);
  const declined = diverSpec.outcome === "not_cleared";
  await db.insert(waiverRecords).values({
    shopId,
    bookingId: booking.id,
    personId: diver.id,
    templateId: waiverTemplate.id,
    templateTitle: waiverTemplate.title,
    templateVersion: waiverTemplate.version,
    templateGeneration: waiverTemplate.materialGeneration,
    templateBody: waiverTemplate.body,
    status: "medical_review",
    tokenHash,
    expiresAt: at(30, 12),
    signedName: diverSpec.fullName,
    signatureMethod: "in_person",
    consentedAt: signedAt,
    signedAt,
    medicalReviewRequired: true,
    // Never a clearance stamp on either row: the held diver has no answer, and
    // the refused one has an answer that lifts nothing (issue #1283).
    medicalClearanceDeclinedAt: declined ? at(0, 9) : null,
    medicalClearanceDeclinedByPersonId: declined ? reviewerId : null,
    medicalClearanceEvaluatedOn: declined ? evaluatedOn : null,
    medicalClearancePhysicianName: declined ? "Dr. Imani Reyes" : null,
    completedAt: signedAt,
    createdAt: signedAt,
  });
}
