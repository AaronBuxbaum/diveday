import type { DiverTranslator } from "@/i18n/messages";
import { tripRequirementList } from "@/i18n/readiness-labels";
import type { CertificationLevel } from "@/lib/certification-levels";
import { certificationRank } from "@/lib/readiness";

/**
 * **Who this trip is for**: one line, no box, and the form's own first line
 * (UX audit #25), so it is read with the party-size control it governs rather
 * than floating above the card. It says only what the *trip* demands, never
 * anything about the reader, which is what makes it safe on an anonymous page
 * (DOM-M6), and nothing at all on a course session, whose own page states its
 * admission rule (the page passes no requirement for one).
 *
 * **A level is a bar with a way through** (issue #1866): admission is the
 * weaker gate and never refuses someone readiness would clear, so beside a
 * required level the sentence says to ask the shop. Said to anybody the page
 * cannot place at or above the level; `holds` is the level a known diver's
 * card already shows (the handoff), and a diver at it is not told.
 */
export function requirementSentenceFor(
  requirement: Parameters<typeof tripRequirementList>[1] | null,
  t: DiverTranslator,
  locale: string,
  holds: CertificationLevel | null = null,
): string | null {
  if (!requirement) return null;
  const list = tripRequirementList(t, requirement, locale);
  if (!list) return null;
  const note = t("trip.requirementNote", { list });
  const asked = requirement.minimumCertificationLevel;
  if (!asked || (holds && certificationRank(holds) >= certificationRank(asked))) return note;
  return `${note} ${t("trip.requirementAskShop")}`;
}
