import type { SupportNeedFact, SupportNeeds } from "@/lib/support-needs";
import { supportNeedFacts } from "@/lib/support-needs";
import type { StaffTranslator } from "./staff-messages";

/**
 * The words for a diver's support-needs record on a **staff** surface.
 *
 * `src/lib/support-needs.ts` returns codes and this file picks the words, the
 * usual split — and here it earns its keep twice, because the same facts are
 * read on the prep list and on the manifest and neither may word them
 * differently.
 *
 * **The tone is the point, not a detail of it.** `src/lib/dive-recency.ts` sets
 * the standard the ADR names: a fact beside a name, for a crew to plan around,
 * in the same voice as a rental fit or a hotel pickup. Not a warning, not a
 * flag, no danger tone, no icon that means "careful". A diver who arranged a
 * lift is a diver the shop is ready for; a surface that renders that as an alert
 * is telling the crew the opposite of what the record exists to say.
 */
function factText(t: StaffTranslator, fact: SupportNeedFact): string {
  switch (fact.kind) {
    case "support_divers":
      return t("shared.supportNeeds.supportDivers", { count: fact.count });
    case "boarding_assistance":
      return t("shared.supportNeeds.boardingAssistance");
    case "water_entry_lift":
      return t("shared.supportNeeds.waterEntryLift");
    case "briefing_sign":
      return t("shared.supportNeeds.briefingSign");
    case "briefing_written":
      return t("shared.supportNeeds.briefingWritten");
    case "briefing_signals":
      return t("shared.supportNeeds.briefingSignals");
    case "equipment":
      return t("shared.supportNeeds.equipment", { note: fact.note });
    case "dives_with":
      return t("shared.supportNeeds.divesWith", { name: fact.name });
  }
}

/**
 * Every stated fact as its own string, in reading order.
 *
 * A list rather than one joined sentence because two of these carry the diver's
 * own free text — the equipment note and the name they dive with — and running
 * an arbitrary sentence into a comma-separated line is how a crew misreads where
 * one fact ends and the next begins.
 */
export function supportNeedsLines(t: StaffTranslator, needs: SupportNeeds | null | undefined) {
  return supportNeedFacts(needs).map((fact) => factText(t, fact));
}
