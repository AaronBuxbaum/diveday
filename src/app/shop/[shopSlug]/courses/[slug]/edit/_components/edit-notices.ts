import type { StaffTranslator } from "@/i18n/staff-messages";
import { MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION } from "@/lib/storage/limits";

/**
 * The course editor's `?notice=` and `?error=` sentences, keyed by the codes
 * `./actions.ts` redirects with. Read through `noticeFromParam`, never a bare
 * lookup: both params are attacker-supplied (src/lib/staff-notices.ts).
 */
export function courseEditNotices(t: StaffTranslator) {
  // No `shown`/`hidden` entry: the visibility form below the save bar neither
  // redirects nor flashes a notice. The header's own line ("Live at …" /
  // "Hidden from divers") and the button's own word both flip on the same
  // render, so a banner repeating them would be a caption on a photograph of
  // itself (the copy-restraint skill, deletion 1).
  const messages: Record<string, string> = {
    saved: t("courses.edit.noticeSaved"),
    "template-updated": t("courses.edit.templateUpdates.updated"),
    "template-replaced": t("courses.edit.templateUpdates.replaced"),
  };
  const errors: Record<string, string> = {
    invalid: t("courses.edit.errorInvalid"),
    // The one refusal this page's own controls can produce. It is reachable
    // even with the visibility form unrendered, because the gate is the
    // closure's and a stale tab still holds a posting form.
    "not-authorized": t("courses.edit.errorNotAuthorized"),
    // Specific, because "something was invalid" on an eight-section form is a
    // scavenger hunt — and a half-filled pair is the one thing this editor
    // refuses that the writer cannot see from the boxes.
    "faq-incomplete": t("courses.edit.errorFaqIncomplete"),
    // The same for a learning material: a link with no name, or a link that
    // is not https (ADR 20261008-course-learning-materials).
    "materials-incomplete": t("courses.edit.errorMaterialsIncomplete"),
    "materials-link": t("courses.edit.errorMaterialsLink"),
    images: t("courses.edit.errorImages"),
    upload: t("courses.edit.errorUpload"),
    "too-many-photos": t("courses.edit.errorTooManyPhotos", {
      max: MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION,
    }),
    // A half-edited depth marker. Refused at save rather than left to render
    // its own braces to a diver — see saveCourseContentAction.
    "depth-placeholder": t("courses.edit.errorDepthPlaceholder"),
    "template-update-unavailable": t("courses.edit.templateUpdates.unavailable"),
  };
  return { messages, errors };
}
