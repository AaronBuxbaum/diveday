import type { StaffTranslator } from "@/i18n/staff-messages";
import type { NoticeMessages } from "@/lib/staff-notices";

/** `/boats` — `createBoatAction`, `updateBoatAction`, `deleteBoatAction`. */
export function boatNoticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "boat-created": { tone: "success", text: t("boats.boatCreated") },
    "boat-updated": { tone: "success", text: t("boats.boatUpdated") },
    "boat-deleted": { tone: "success", text: t("boats.boatDeleted") },
    "boat-invalid": { tone: "danger", text: t("boats.boatInvalid") },
    "boat-radio-invalid": { tone: "danger", text: t("boats.boatRadioInvalid") },
  };
}
