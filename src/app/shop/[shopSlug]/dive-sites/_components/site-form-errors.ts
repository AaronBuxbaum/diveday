import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import type { DiveSiteFormError } from "@/lib/dive-sites";

/**
 * The words for every refusal a site briefing can come back with — the one
 * place `src/lib/dive-sites.ts`'s codes become sentences, for both the create
 * and the edit form.
 *
 * Resolved on the server and handed to `SiteFormShell` as a prop, because staff
 * copy is server-side only (AGENTS.md). `invalidKey` is the single line the two
 * forms word differently: creating names the required name, editing does not.
 */
export function siteFormErrorMessages(
  t: StaffTranslator,
  invalidKey: StaffMessageKey,
): Record<DiveSiteFormError, string> {
  return {
    invalid: t(invalidKey),
    coordinatesIncomplete: t("diveSites.form.errorCoordinates"),
    depthTooDeep: t("diveSites.form.errorDepth"),
    images: t("diveSites.form.errorImages"),
    imagesUnconfigured: t("diveSites.form.errorImagesUnconfigured"),
  };
}
