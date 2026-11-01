"use server";

import { canPersonReadMedicalAlert, canPersonReadMedicalAnswers } from "@/db/authz";
import { recordMedicalAlertTrailLine } from "@/db/medical-alerts";
import { recordDiverActivity } from "@/db/operations";
import { getSignedWaiverForDiver } from "@/db/waivers";
import { type AnsweredMedicalQuestion, answeredMedicalQuestions } from "@/lib/medical";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";

export type ShowMedicalAnswersResult =
  | { ok: true; answers: AnsweredMedicalQuestion[] }
  | { ok: false };

/**
 * **"Show answers" on a signed release** (Aaron, 2026-10-13, issue #2157).
 *
 * The full questionnaire leaves the server only here, and only after a line naming who read them is on the diver's trail
 * (`medical_answers_read`), as opening the physician's evaluation writes one
 * (`/api/medical-clearances/[recordId]`). A page render never writes it: link
 * prefetch and reloads would log reads nobody made, so the page carries no
 * answer at all, only the prompts that flagged, which every staff role sees.
 *
 * Owners and managers only (`canReadMedicalAnswers`, the bulk export's wall),
 * re-read from the database on each tap rather than trusted from the render.
 * The trail is written before the answers are read back and is not
 * swallowed: if the shop cannot record the read, nothing is shown. Every
 * refusal is the same `{ ok: false }`, so a wrong record, another diver's
 * record and a refused role are indistinguishable.
 */
export async function showMedicalAnswersAction(
  shopSlug: string,
  personId: string,
  recordId: string,
): Promise<ShowMedicalAnswersResult> {
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const diverId = uuidParam(personId);
  const waiverId = uuidParam(recordId);
  if (!diverId || !waiverId) return { ok: false };
  const actor = session.user.personId;
  if (!(await canPersonReadMedicalAnswers(db, shop.id, actor))) return { ok: false };
  const waiver = await getSignedWaiverForDiver(db, {
    shopId: shop.id,
    personId: diverId,
    recordId: waiverId,
    readsMedicalAnswers: true,
  });
  // Held seats (H-20260724-one-person-per-email) carry no answers, and a paper release stores none.
  if (!waiver?.medicalAnswers) return { ok: false };
  const recorded = await recordDiverActivity(db, {
    shopId: shop.id,
    personId: waiver.personId,
    actorPersonId: actor,
    code: "medical_answers_read",
  });
  if (!recorded) return { ok: false };
  return {
    ok: true,
    // A questionnaire version this build cannot name still says what flagged.
    answers:
      answeredMedicalQuestions(waiver.medicalAnswers) ??
      waiver.flaggedPrompts.map((prompt) => ({ id: prompt, prompt, yes: true })),
  };
}

export type ShowMedicalAlertResult = { ok: true; text: string } | { ok: false };

/**
 * **"Show the alert" on a signed release** (issue #2960): the diver's medical
 * alert for the crew, read on purpose, the way "Show answers" reads the
 * questionnaire above. Owner and manager only here (`canReadMedicalAlert`
 * with no departure in hand); the crew read it on their own departure's
 * manifest. The read goes on the diver's trail (`medical_alert_read`) before
 * the words are handed back, and a trail that refuses the line shows nothing.
 * Every refusal is the same `{ ok: false }`.
 */
export async function showMedicalAlertOnRecordAction(
  shopSlug: string,
  personId: string,
  recordId: string,
): Promise<ShowMedicalAlertResult> {
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const diverId = uuidParam(personId);
  const waiverId = uuidParam(recordId);
  if (!diverId || !waiverId) return { ok: false };
  const actor = session.user.personId;
  if (!(await canPersonReadMedicalAlert(db, shop.id, actor))) return { ok: false };
  const waiver = await getSignedWaiverForDiver(db, {
    shopId: shop.id,
    personId: diverId,
    recordId: waiverId,
    readsMedicalAnswers: false,
    readsMedicalAlert: true,
  });
  // A held seat carries none, and a paper or imported release stores none.
  if (!waiver?.medicalAlert) return { ok: false };
  // One line per reader and diver within ten minutes
  // (`recordMedicalAlertTrailLine`); the words come back on every tap.
  const recorded = await recordMedicalAlertTrailLine(db, {
    shopId: shop.id,
    personId: waiver.personId,
    actorPersonId: actor,
    code: "medical_alert_read",
    departureId: null,
  });
  if (!recorded) return { ok: false };
  return { ok: true, text: waiver.medicalAlert };
}
