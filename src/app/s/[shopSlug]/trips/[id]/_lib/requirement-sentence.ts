import type { DiverTranslator } from "@/i18n/messages";
import { tripRequirementList } from "@/i18n/readiness-labels";

/**
 * **Who this trip is for**: one line, no box, and the form's own first line
 * (UX audit #25), so it is read with the party-size control it governs rather
 * than floating above the card. It says only what the *trip* demands, never
 * anything about the reader, which is what makes it safe on an anonymous page
 * (DOM-M6), and nothing at all on a course session, whose own page states its
 * admission rule (the page passes no requirement for one).
 */
export function requirementSentenceFor(
  requirement: Parameters<typeof tripRequirementList>[1] | null,
  t: DiverTranslator,
  locale: string,
): string | null {
  if (!requirement) return null;
  const list = tripRequirementList(t, requirement, locale);
  return list ? t("trip.requirementNote", { list }) : null;
}
