"use server";

import { getDb } from "@/db/client";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import { getShopById } from "@/db/shops";
import {
  attachDiverMedicalForm,
  diverMedicalFormOpen,
  getWaiverForToken,
  revealDoctorReferral,
} from "@/db/waivers";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import {
  checkRateLimit,
  checkRateLimitFailClosed,
  RATE_LIMITS,
  rateLimitKey,
} from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { storeMedicalClearanceDocument } from "@/lib/storage";
import { isDoctorFormUpload } from "./doctor-form-upload";
import { referralRefLabel } from "./referral-labels";

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
 * **Unlock the doctor's page's answers with the diver's date of birth**
 * (security review of layer r5-3, F1). The waiver link alone shows the page;
 * which conditions the diver answered yes to needs something only the diver
 * knows. Two nets: the shared per-IP bucket every waiver-link action spends
 * from, and a narrow one per diver that fails closed, so a rotating set of
 * addresses cannot walk the birthdays either; under both, the record's
 * lifetime ceiling of wrong dates (`revealDoctorReferral`). Only the outcome
 * comes back: the published prompts on a match, and never the date on file.
 */
export async function revealDoctorAnswersAction(
  token: string,
  _previous: DoctorAnswersState,
  formData: FormData,
): Promise<DoctorAnswersState> {
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("waiver-token", ip), RATE_LIMITS.capabilityAction)).allowed
  ) {
    return { status: "rate" };
  }
  const db = await getDb();
  const state = await getWaiverForToken(db, token);
  if (state.state !== "completed") return { status: "closed" };
  const record = state.record;
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

/**
 * **Send the signed doctor's form from the doctor's page** (issue #2797, ADR
 * 20261024-diver-sent-doctors-form). The waiver link is the whole authority,
 * as it is for the page.
 *
 * In order, and each step before anything is stored: the shared per-IP bucket,
 * the link, a per-diver bucket that fails closed, the file's claimed type and
 * size, and whether the release still takes a form (`diverMedicalFormOpen`).
 * Then the bytes go through `storeMedicalClearanceDocument`, which decides by
 * the bytes themselves (an image is decoded and re-encoded, a PDF must start
 * `%PDF-`), into the private `medical-clearances` prefix. The write takes one
 * form per release; a file it refuses is queued for deletion, never left in
 * the bucket. Only the outcome comes back, never the stored address.
 */
export async function sendDoctorFormAction(
  token: string,
  _previous: DoctorFormState,
  formData: FormData,
): Promise<DoctorFormState> {
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("waiver-token", ip), RATE_LIMITS.capabilityAction)).allowed
  ) {
    return { status: "rate" };
  }
  const db = await getDb();
  const state = await getWaiverForToken(db, token);
  if (state.state !== "completed") return { status: "closed" };
  const record = state.record;
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

  const attached = await attachDiverMedicalForm(db, record, stored.url);
  if (attached === "sent") return { status: "sent" };
  await queueAndAttemptMediaDeletion(db, {
    shopId: record.shopId,
    kind: "waiver_document",
    url: stored.url,
  });
  return { status: attached === "already" ? "sent" : "closed" };
}
