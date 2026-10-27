import type { StaffTranslator } from "@/i18n/staff-messages";
import { type NoticeMessages, noticeFromParam } from "@/lib/staff-notices";

/** `/boats` — `createBoatAction`, `updateBoatAction`, `deleteBoatAction`. */
export function boatNoticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "boat-created": { tone: "success", text: t("boats.boatCreated") },
    "boat-updated": { tone: "success", text: t("boats.boatUpdated") },
    "boat-deleted": { tone: "success", text: t("boats.boatDeleted") },
    "boat-invalid": { tone: "danger", text: t("boats.boatInvalid") },
    "boat-photo-invalid": { tone: "danger", text: t("boats.boatPhotoInvalid") },
    "boat-radio-invalid": { tone: "danger", text: t("boats.boatRadioInvalid") },
    "boat-channel-distress": { tone: "danger", text: t("boats.boatChannelDistress") },
  };
}

/** A validation refusal belongs beside its form, rather than above a closed fleet. */
export function boatValidationError(
  t: StaffTranslator,
  { notice, boat }: { notice?: string; boat?: string },
): { boat: string; text: string } | null {
  const message = noticeFromParam(notice, boatNoticeMessages(t));
  return boat && message?.tone === "danger" ? { boat, text: message.text } : null;
}
