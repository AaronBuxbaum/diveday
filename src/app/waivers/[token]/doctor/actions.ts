"use server";

import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getWaiverForToken, revealDoctorReferral } from "@/db/waivers";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { referralRefLabel } from "./referral-labels";

/** What the doctor's page's answers section shows after a date of birth is entered. */
export type DoctorAnswersState =
  | { status: "locked" }
  | { status: "mismatch" }
  | { status: "rate" }
  | { status: "closed" }
  | { status: "open"; items: { label: string; prompt: string }[]; source: string | null };

/**
 * **Unlock the doctor's page's answers with the diver's date of birth**
 * (security review of layer r5-3, F1). The waiver link alone shows the page;
 * which conditions the diver answered yes to needs something only the diver
 * knows. Two nets: the shared per-IP bucket every waiver-link action spends
 * from, and a narrow one per held release, so a rotating set of addresses
 * cannot walk the birthdays either. Only the outcome comes back: the published
 * prompts on a match, and never the date on file.
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
  if (
    !(
      await checkRateLimit(
        rateLimitKey("doctor-answers", record.id),
        RATE_LIMITS.doctorAnswersByRecord,
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
