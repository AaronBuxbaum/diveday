import { fill, pluralForm } from "@/i18n/fill";
import type { DiverTranslator } from "@/i18n/messages";
import { WAIVER_RAIL_TOTAL, type WaiverRailSegmentId } from "./WaiverStepRail";

/**
 * The rail's three names, in the reader's own language. One resolver, because
 * both states that render a rail — the page a diver is filling in and the
 * completed state — have to say the same three words.
 */
export function railLabels(t: DiverTranslator): Record<WaiverRailSegmentId, string> {
  return {
    release: t("waiver.railRelease"),
    medical: t("waiver.railMedical"),
    sign: t("waiver.railSign"),
  };
}

/**
 * "2 of 3 done", pluralised against the reader's negotiated locale rather than
 * the server process's — `pluralForm` defaults to the runtime's own locale,
 * which on a server is whatever the box was booted with and is nobody's.
 */
export function railDoneLabel(t: DiverTranslator, locale: string, done: number): string {
  return fill(
    pluralForm(
      done,
      { one: t.raw("waiver.railProgressOne"), other: t.raw("waiver.railProgressOther") },
      locale,
    ),
    { done, total: WAIVER_RAIL_TOTAL },
  );
}
