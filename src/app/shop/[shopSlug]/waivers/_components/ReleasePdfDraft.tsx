import { PdfDraftButton } from "@/components/assists/PdfDraftButton";
import { assistsAvailable } from "@/db/assists";
import { getDb } from "@/db/client";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { draftWaiverFromPdfAction } from "../assist-actions";

/**
 * "Start from your current waiver" under the release editor (the
 * `waiver-import` assist, ADR 20261018-claude-assists), rendered only while
 * the shop's assists are on. Its own module, apart from the page, because a
 * module that reads assists may not import the waiver records
 * (`check:assist-prompts`).
 */
export async function ReleasePdfDraft({
  shopId,
  fieldId,
  t,
}: {
  shopId: string;
  fieldId: string;
  t: StaffTranslator;
}) {
  if (!(await assistsAvailable(await getDb(), shopId))) return null;
  return (
    <PdfDraftButton
      draft={draftWaiverFromPdfAction}
      fieldId={fieldId}
      words={{
        label: t("assistsFront.waiver.label"),
        hint: t("assistsFront.waiver.hint"),
        draft: t("assistsFront.waiver.draft"),
        drafting: t("assistsFront.waiver.drafting"),
        failed: t("assistsFront.waiver.failed"),
      }}
    />
  );
}
