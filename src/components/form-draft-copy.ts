import type { StaffTranslator } from "@/i18n/staff-messages";
import type { FormDraftCopy } from "./FormDraft";

/**
 * Words for `FormDraft`, resolved server-side and passed down as plain data —
 * the house pattern for a staff Client Component (see `paper-waiver-copy.ts`).
 * `pickedUp` keeps its `{time}` placeholder; the page fills it with the
 * draft's own time in the shop's zone before handing it down.
 */
export function formDraftCopy(t: StaffTranslator): FormDraftCopy {
  return {
    pickedUp: t.raw("shared.formDraft.pickedUp"),
    startOver: t("shared.formDraft.startOver"),
  };
}
