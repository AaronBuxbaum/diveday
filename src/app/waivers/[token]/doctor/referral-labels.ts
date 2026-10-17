import type { DiverTranslator } from "@/i18n/messages";
import type { MedicalReferralRef } from "@/lib/medical";

/** Where an answer sits on the published form, in the reader's language. */
export function referralRefLabel(t: DiverTranslator, ref: MedicalReferralRef): string {
  if (ref.kind === "question") return t("waiver.doctor.question", { number: ref.number });
  if (ref.kind === "box") return t("waiver.doctor.box", { box: ref.box, number: ref.number });
  return t("waiver.doctor.dental");
}
