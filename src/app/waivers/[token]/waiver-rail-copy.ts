import { fill, pluralForm } from "@/i18n/fill";
import type { DiverTranslator } from "@/i18n/messages";
import type { WaiverRailLabels } from "./WaiverStepRail";

/**
 * The rail's names, in the reader's own language: the three every release
 * has, and Questions when the shop asks its own. One resolver, because both
 * states that render a rail — the page a diver is filling in and the
 * completed state — have to say the same words.
 */
export function railLabels(t: DiverTranslator, withShopQuestions = false): WaiverRailLabels {
  return {
    release: t("waiver.railRelease"),
    medical: t("waiver.railMedical"),
    ...(withShopQuestions ? { questions: t("waiver.railQuestions") } : {}),
    sign: t("waiver.railSign"),
    states: { done: t("waiver.railStepDone"), open: t("waiver.railStepOpen") },
  };
}

/**
 * "2 of 3 done", pluralised against the reader's negotiated locale rather than
 * the server process's — `pluralForm` defaults to the runtime's own locale,
 * which on a server is whatever the box was booted with and is nobody's.
 */
export function railDoneLabel(
  t: DiverTranslator,
  locale: string,
  done: number,
  total: number,
): string {
  return fill(
    pluralForm(
      done,
      { one: t.raw("waiver.railProgressOne"), other: t.raw("waiver.railProgressOther") },
      locale,
    ),
    { done, total },
  );
}
