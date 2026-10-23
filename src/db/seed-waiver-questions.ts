import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import {
  computeWaiverIntegrityHash,
  WAIVER_INTEGRITY_VERSION_SIGNED,
} from "@/lib/waiver-integrity";
import type { ShopAnswer, ShopQuestion } from "@/lib/waiver-questions";
import type { DbExecutor } from "./client";
import { people, waiverRecords, waiverTemplates } from "./schema";
import { at } from "./seed-clock";
import { getCurrentWaiverTemplate } from "./waivers-templates";

/**
 * **The shop's own questions on its release** (glossary *Shop question*),
 * modeled on a working charter's paper form (Niuhi Dive Charters' release):
 * how many dives, how they heard about the shop, and whether they carry dive
 * accident insurance. No last-dive question: currency is asked on each
 * booking, and a sign-once release is the wrong place for a fact that goes
 * stale (dive-domain review, point 3).
 *
 * **Written onto the current version, not as a new one.** A shop that
 * publishes questions takes a new version through the materiality choice; the
 * demo's version 3 is simply the version the shop published *with* its
 * questions. The alternative, a version 4 with the same body, would either
 * bump the material generation (every seeded signature stops being current,
 * which the demo must never show) or need a non-material version whose body
 * repeats version 3's, which `seed-waiver-versions.test.ts` rightly refuses as
 * a history that teaches nothing. Records pin the version by id, so writing
 * the list here, after every scenario has issued its links, is the same as
 * writing it before: nothing copied the list. `material_generation` and
 * `version` are untouched.
 *
 * **All three are optional here**, though a shop may make any of them
 * required. The demo shop is the fixture the whole test suite and the e2e
 * fleet sign releases on, and a required question would refuse every one of
 * those signatures that does not know about it; it would also be a failure
 * state seeded into blue-mantis.
 *
 * **One release signed online, with answers**, so the signed record's answers
 * card has something to show: every other seeded release is a paper one, and
 * a paper release records no answers ("Not recorded in DiveDay"). It goes to
 * an adult diver who already holds a clean release, person-scoped (no seat),
 * signed two days ago and sealed here, as `completeWaiver` seals it.
 * `seedWaiverEvidence` (which runs after this) leaves a release it did not
 * re-date and that its own cutoff would not seal alone, and dating it before
 * that cutoff keeps the audit trail's first page showing both of its states.
 * Nothing about anyone's readiness changes: the diver was cleared before and
 * is cleared after.
 */
export const DEMO_SHOP_QUESTIONS: ShopQuestion[] = [
  {
    id: "demodives01",
    kind: "number",
    prompt: "How many dives have you logged?",
    required: false,
  },
  {
    id: "demoheard01",
    kind: "choice",
    prompt: "How did you hear about us?",
    required: false,
    options: ["A friend", "Online search", "Our hotel", "We dived with you before"],
  },
  {
    id: "demoinsure1",
    kind: "yes_no",
    prompt: "Do you carry dive accident insurance?",
    required: false,
  },
];

/** The answers the one online signer gave, by question id. */
const DEMO_ANSWERS: Record<string, ShopAnswer["answer"]> = {
  demodives01: 42,
  demoheard01: "Online search",
  demoinsure1: true,
};

export async function seedWaiverQuestions(db: DbExecutor, shopId: string): Promise<void> {
  const template = await getCurrentWaiverTemplate(db, shopId);
  if (!template) return;
  await db
    .update(waiverTemplates)
    .set({ questions: DEMO_SHOP_QUESTIONS })
    .where(and(eq(waiverTemplates.id, template.id), eq(waiverTemplates.shopId, shopId)));

  // The earliest clean release on a seat, so the choice is a pure function of
  // the seed. Its diver is an adult (no guardian) with nothing held.
  const [standing] = await db
    .select({ personId: waiverRecords.personId, fullName: people.fullName })
    .from(waiverRecords)
    .innerJoin(people, eq(people.id, waiverRecords.personId))
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.status, "completed"),
        eq(waiverRecords.medicalReviewRequired, false),
        isNull(waiverRecords.supersededAt),
        isNull(waiverRecords.guardianSignedAt),
        isNotNull(waiverRecords.bookingId),
        isNull(people.anonymizedAt),
      ),
    )
    // diveday:allow-time-id-order: `createdAt` is unique per seeded row, so the id never decides.
    .orderBy(asc(waiverRecords.createdAt), asc(waiverRecords.id))
    .limit(1);
  if (!standing) return;

  const signedAt = at(-2, 10, 12);
  const [signed] = await db
    .insert(waiverRecords)
    .values({
      shopId,
      bookingId: null,
      personId: standing.personId,
      templateId: template.id,
      templateTitle: template.title,
      templateVersion: template.version,
      templateGeneration: template.materialGeneration,
      templateBody: template.body,
      status: "completed",
      tokenHash: `seed-waiver-${shopId}-shop-questions`,
      expiresAt: at(6, 10),
      startedAt: new Date(signedAt.getTime() - 9 * 60_000),
      createdAt: new Date(signedAt.getTime() - 10 * 60_000),
      signedName: standing.fullName,
      signatureMethod: "typed_consent",
      consentedAt: signedAt,
      signedAt,
      completedAt: signedAt,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      medicalReviewRequired: false,
      shopAnswers: DEMO_SHOP_QUESTIONS.map((question) => ({
        ...question,
        answer: DEMO_ANSWERS[question.id] ?? null,
      })),
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
}
