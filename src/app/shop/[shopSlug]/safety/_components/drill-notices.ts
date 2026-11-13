import type { StaffTranslator } from "@/i18n/staff-messages";
import type { NoticeMessages } from "@/lib/staff-notices";

/** `/safety/drills`: the drill log's two acts (loop 5, row 2). */
export function drillNoticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "drill-logged": { tone: "success", text: t("incidents.safety.drills.logged") },
    "drill-deleted": { tone: "success", text: t("incidents.safety.drills.deleted") },
    "drill-invalid": { tone: "danger", text: t("incidents.safety.drills.invalid") },
  };
}
