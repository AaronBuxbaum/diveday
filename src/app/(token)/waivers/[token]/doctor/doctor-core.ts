import { getDb } from "@/db/client";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import { getShopById } from "@/db/shops";
import {
  attachDiverMedicalForm,
  contactOnFile,
  diverMedicalFormOpen,
  getWaiverForToken,
  revealDoctorReferral,
  type WaiverKey,
} from "@/db/waivers";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { checkRateLimitFailClosed, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { storeMedicalClearanceDocument } from "@/lib/storage";
import { isDoctorFormUpload } from "./doctor-form-upload";
import { referralRefLabel } from "./referral-labels";

/**
 * **The doctor's page's two acts, whichever door it was opened through.**
 *
 * Deliberately not a `"use server"` module: every export of one is callable
 * from a browser with arguments of the browser's choosing, and these take the
 * record's key. Each door's own server action (the waiver link's
 * `./actions.ts`, the diver's thread `/ready/[token]/waiver-actions.ts`)
 * spends its per-IP bucket and resolves the key from its own credential first.
 */

/** What the doctor's page's answers section shows after a date of birth is entered. */
export type DoctorAnswersState =
  | { status: "locked" }
  | { status: "mismatch" }
  | { status: "rate" }
  | { status: "closed" }
  /** Nothing to unlock, or the wrong-date ceiling is reached: the whole questionnaire. */
  | { status: "whole" }
  | { status: "open"; items: { label: string; prompt: string }[]; source: string | null };

/**
 * The unlock itself, for a caller that has already spent its door's per-IP
 * bucket: the waiver link above, or the diver's thread
 * (`/ready/<token>/waiver/doctor`, issue #2743), which names the record from its
 * own verified capability. Never called with a key a client could choose.
 */
export async function revealDoctorAnswersFor(
  key: WaiverKey,
  formData: FormData,
): Promise<DoctorAnswersState> {
  const db = await getDb();
  const state = await getWaiverForToken(db, key);
  if (state.state !== "completed") return { status: "closed" };
  const record = state.record;
  const readContact = await contactOnFile(db, record);
  // Keyed by the diver, so a reissued link buys no fresh budget; fails closed,
  // because this one bucket stands in front of medical answers.
  if (
    !(
      await checkRateLimitFailClosed(
        rateLimitKey("doctor-answers", record.personId),
        RATE_LIMITS.doctorAnswersByPerson,
      )
    ).allowed
  ) {
    return { status: "rate" };
  }
  const entered = formData.get("birthdate");
  const answers = await revealDoctorReferral(
    db,
    record,
    typeof entered === "string" ? entered.trim() : "",
    readContact,
  );
  if (answers === null) return { status: "closed" };
  if (answers === "mismatch") return { status: "mismatch" };
  if (answers === "whole") return { status: "whole" };
  const shop = await getShopById(db, record.shopId);
  const t = diverTranslator(await requestLocale(shop?.defaultLocale));
  return {
    status: "open",
    items: answers.items.map((item) => ({
      label: referralRefLabel(t, item.ref),
      prompt: item.prompt,
    })),
    source: answers.form
      ? t("waiver.doctor.answersSource", {
          title: answers.form.title,
          product: answers.form.productNumber,
          version: answers.form.versionDate,
        })
      : null,
  };
}

/** What the doctor's page's return section shows after the diver sends the form. */
export type DoctorFormState =
  | { status: "idle" }
  /** The shop has a form for this release: this one, or one sent before it. */
  | { status: "sent" }
  /** Not a photo or a PDF, empty, or over the size cap. */
  | { status: "invalid" }
  | { status: "rate" }
  | { status: "closed" }
  /** Storage is not configured here; the email or the counter still works. */
  | { status: "unavailable" };

/** The send itself, after the door's own per-IP bucket; as `revealDoctorAnswersFor`. */
export async function sendDoctorFormFor(
  key: WaiverKey,
  formData: FormData,
): Promise<DoctorFormState> {
  const db = await getDb();
  const state = await getWaiverForToken(db, key);
  if (state.state !== "completed") return { status: "closed" };
  const record = state.record;
  const readContact = await contactOnFile(db, record);
  if (
    !(
      await checkRateLimitFailClosed(
        rateLimitKey("doctor-form", record.personId),
        RATE_LIMITS.doctorFormByPerson,
      )
    ).allowed
  ) {
    return { status: "rate" };
  }
  const file = formData.get("doctorForm");
  if (!isDoctorFormUpload(file)) return { status: "invalid" };
  const open = await diverMedicalFormOpen(db, record);
  if (open !== "open") return { status: open };

  const stored = await storeMedicalClearanceDocument({
    filename: "doctors-form",
    contentType: file.type,
    bytes: await file.arrayBuffer(),
  });
  if (stored.status === "not_configured") return { status: "unavailable" };
  if (stored.status !== "stored") return { status: "invalid" };

  const attached = await attachDiverMedicalForm(db, record, stored.url, readContact);
  if (attached === "sent") return { status: "sent" };
  await queueAndAttemptMediaDeletion(db, {
    shopId: record.shopId,
    kind: "waiver_document",
    url: stored.url,
  });
  return { status: attached === "already" ? "sent" : "closed" };
}
