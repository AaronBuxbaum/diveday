import type { KnownDiver } from "@/db/booking-handoff";
import type { DiverTranslator } from "@/i18n/messages";
import { DIVER_CERT_LEVEL_KEYS } from "@/i18n/next-dive-labels";
import type { DiverLocale } from "@/i18n/settings";
import { formatShortDate } from "@/lib/format";

/**
 * The known diver's facts as sentences (ADR 20260906-before-you-ask, decision
 * 3), worded on the server where the locale and the shop's zone are, so they
 * reach the client already said.
 */
export function knownDiverFactLines(
  facts: KnownDiver["facts"],
  t: DiverTranslator,
  where: { locale: DiverLocale; timeZone: string },
): string[] {
  return facts.map((fact) => {
    const on = (at: Date) => formatShortDate(at, where.locale, where.timeZone);
    switch (fact.kind) {
      case "card":
        return t("booking.knownDiver.card", {
          level: t(DIVER_CERT_LEVEL_KEYS[fact.level]),
          date: on(fact.keptAt),
        });
      case "waiver":
        return t("booking.knownDiver.waiver", { date: on(fact.keptAt) });
      case "own_gear":
        return t("booking.knownDiver.ownGear", { date: on(fact.keptAt) });
      case "sizes":
        return t("booking.knownDiver.sizes", { date: on(fact.keptAt) });
      case "contact":
        return t("booking.knownDiver.contact", { name: fact.name });
      default:
        return "";
    }
  });
}

/**
 * The booking form's known-diver panel, built from the handoff's read: who it
 * is, their facts said in their language, and the gear they took last time
 * (fifth-loop ideas, item 40). Null when the handoff named nobody.
 */
export function knownDiverPanelFor(
  knownDiver: KnownDiver | null,
  t: DiverTranslator,
  input: { handoff: string | null; blankHref: string; locale: DiverLocale; timeZone: string },
) {
  if (!knownDiver) return null;
  return {
    name: knownDiver.fullName,
    handoff: input.handoff ?? "",
    blankHref: input.blankHref,
    lead: { fullName: knownDiver.fullName, email: knownDiver.email, phone: knownDiver.phone },
    lines: knownDiverFactLines(knownDiver.facts, t, input),
    lastGear: knownDiver.lastGear,
  };
}
