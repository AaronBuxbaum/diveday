import type { StaffTranslator } from "@/i18n/staff-messages";
import type { NoticeMessages } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

/** `/trip-tags` — the three `TripLens` actions. */
export function lensNoticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "lens-created": { tone: "success", text: t("lenses.created") },
    "lens-updated": { tone: "success", text: t("lenses.updated") },
    "lens-deleted": { tone: "success", text: t("lenses.deleted") },
    "lens-invalid": { tone: "danger", text: t("lenses.invalid") },
  };
}

/** A refusal opens its own validated editor, never the unrelated add form. */
export function tripTagRefusalTarget(query: { notice?: string; lens?: unknown }): string | null {
  if (query.notice !== "lens-invalid" || typeof query.lens !== "string") return null;
  if (query.lens === "new") return "new";
  return uuidParam(query.lens)?.toLowerCase() ?? null;
}
