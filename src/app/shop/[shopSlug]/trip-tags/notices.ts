import type { StaffTranslator } from "@/i18n/staff-messages";
import type { NoticeMessages } from "@/lib/staff-notices";

/** `/trip-tags` — the three `TripLens` actions. */
export function lensNoticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "lens-created": { tone: "success", text: t("lenses.created") },
    "lens-updated": { tone: "success", text: t("lenses.updated") },
    "lens-deleted": { tone: "success", text: t("lenses.deleted") },
    "lens-invalid": { tone: "danger", text: t("lenses.invalid") },
  };
}
