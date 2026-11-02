import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import {
  computeWaiverIntegrityHash,
  WAIVER_INTEGRITY_VERSION_SIGNED,
} from "@/lib/waiver-integrity";
import type { ShopAnswer } from "@/lib/waiver-questions";
import type { DbExecutor } from "./client";
import { bookings, people, personRoles, tripAssignments, trips, waiverRecords } from "./schema";
import { at } from "./seed-clock";
import { DEMO_SHOP_QUESTIONS } from "./seed-waiver-questions";
import { getCurrentWaiverTemplate } from "./waivers-templates";

/** The departure and the diver the demo's one alert is on. */
export const DEMO_MEDICAL_ALERT_TRIP = "Morning Two-Tank — Molasses Reef";
export const DEMO_MEDICAL_ALERT_DIVER = "Siobhan Doyle";
export const DEMO_MEDICAL_ALERT = "Bee-sting allergy. EpiPen in the blue dry bag.";

/** What she answered to the shop's own questions on the same release. */
const ANSWERS: Record<string, ShopAnswer["answer"]> = {
  demodives01: 85,
  demoheard01: "Our hotel",
  demoinsure1: true,
};

/**
 * **One medical alert for the crew** (glossary *Medical alert for the crew*,
 * issue #2960), so the manifest chip, the recorded read and the signed record's
 * card each have something to show.
 *
 * A diver on tomorrow's crewed departure re-signed the release online
 * yesterday morning and wrote an alert. Re-signing is the only way an alert
 * reaches a record, and a paper release carries none, so the alert is on a new
 * person-scoped release, as `completeWaiver` writes one: typed consent, a clean
 * questionnaire, the shop's questions answered, sealed. Being her newest clean
 * signature on the current terms, it becomes her standing release, and she is
 * as ready after as before: the alert informs and never gates.
 *
 * Only crew someone else put on the boat read the words (H-20261023-medical-alert-for-the, review
 * fixes), and a seeded roster names nobody, so the shop's owner is recorded
 * as having assigned this one departure's crew.
 *
 * Runs after `seedWaiverQuestions` (it answers the questions that writes) and
 * before `seedWaiverEvidence`, which leaves a release dated before its cutoff
 * as it is.
 */
export async function seedMedicalAlert(db: DbExecutor, shopId: string): Promise<void> {
  const template = await getCurrentWaiverTemplate(db, shopId);
  if (!template) return;
  const [seat] = await db
    .select({ personId: people.id, fullName: people.fullName, tripId: trips.id })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(trips.title, DEMO_MEDICAL_ALERT_TRIP),
        eq(trips.status, "scheduled"),
        isNull(trips.deletedAt),
        gt(trips.startsAt, nowDate()),
        eq(people.fullName, DEMO_MEDICAL_ALERT_DIVER),
        isNull(people.anonymizedAt),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  if (!seat) return;

  // Yesterday morning, just before the shop's seal cutoff
  // (`seed-waiver-evidence.ts`): newer than her paper release, so it stands,
  // and below the audit trail's first page, so that page still shows both
  // states. Sealed here, as `completeWaiver` seals it.
  const signedAt = at(-1, 8, 20);
  const [signed] = await db
    .insert(waiverRecords)
    .values({
      shopId,
      bookingId: null,
      personId: seat.personId,
      templateId: template.id,
      templateTitle: template.title,
      templateVersion: template.version,
      templateGeneration: template.materialGeneration,
      templateBody: template.body,
      status: "completed",
      tokenHash: `seed-waiver-${shopId}-medical-alert`,
      expiresAt: at(6, 10),
      startedAt: new Date(signedAt.getTime() - 7 * 60_000),
      createdAt: new Date(signedAt.getTime() - 8 * 60_000),
      signedName: seat.fullName,
      signatureMethod: "typed_consent",
      consentedAt: signedAt,
      signedAt,
      completedAt: signedAt,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      medicalReviewRequired: false,
      shopAnswers: DEMO_SHOP_QUESTIONS.map((question) => ({
        ...question,
        answer: ANSWERS[question.id] ?? null,
      })),
      medicalAlert: DEMO_MEDICAL_ALERT,
    })
    .returning();
  if (!signed) return;
  await db
    .update(waiverRecords)
    .set({
      integrityHash: computeWaiverIntegrityHash(signed, WAIVER_INTEGRITY_VERSION_SIGNED),
      integrityVersion: WAIVER_INTEGRITY_VERSION_SIGNED,
    })
    .where(eq(waiverRecords.id, signed.id));
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner"), isNull(people.deletedAt)))
    .limit(1);
  if (!owner) return;
  await db
    .update(tripAssignments)
    .set({ assignedByPersonId: owner.id })
    .where(
      and(eq(tripAssignments.tripId, seat.tripId), isNull(tripAssignments.assignedByPersonId)),
    );
}
