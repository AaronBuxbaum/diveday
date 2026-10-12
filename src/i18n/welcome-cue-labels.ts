import { cachedListFormat } from "@/lib/intl-cache";
import { firstNameOf } from "@/lib/person-name";
import type { WelcomeCue } from "@/lib/welcome-cue";
import { type CertificationSummaryShape, certificationSummaryText } from "./readiness-labels";
import type { StaffTranslator } from "./staff-messages";

/**
 * The welcome cue's words (issue #1182, delight report D22).
 *
 * `src/lib/welcome-cue.ts` returns a code and a number of years; this picks the
 * words, the same split `birthday-labels.ts` follows.
 */

/**
 * The fragment under a diver's name on the manifest: "first time with us",
 * "back after 3 years".
 *
 * Lower case and unpunctuated on purpose — it is a continuation of the name
 * above it, not a sentence about a record, and a capitalised "First Time With
 * Us" beside a name is a badge with the badge shape filed off.
 */
export function welcomeCueText(t: StaffTranslator, cue: WelcomeCue): string {
  return cue.kind === "first_trip"
    ? t("shared.welcomeCue.firstTrip")
    : t("shared.welcomeCue.returning", { years: cue.years });
}

/**
 * The shop home's row: whole sentences, because there is no name above them to
 * continue from.
 *
 * The first-timers collapse into one sentence with their names joined through
 * `Intl.ListFormat`; each returning diver takes a sentence of their own,
 * because the number of years is theirs and averaging it would invent a fact.
 */
export function sayHelloSentences(
  t: StaffTranslator,
  locale: string,
  cues: ReadonlyArray<{ name: string; cue: WelcomeCue }>,
): string[] {
  const firstTimers = cues.filter((entry) => entry.cue.kind === "first_trip");
  const list = cachedListFormat(locale, { type: "conjunction" });
  const sentences =
    firstTimers.length > 0
      ? [
          t("today.sayHello.firstTrip", {
            count: firstTimers.length,
            names: list.format(firstTimers.map((entry) => entry.name)),
          }),
        ]
      : [];
  for (const entry of cues) {
    if (entry.cue.kind !== "returning") continue;
    sentences.push(t("today.sayHello.returning", { name: entry.name, years: entry.cue.years }));
  }
  return sentences;
}

/**
 * **The dock line under "first time with us"** (UX review 2026-10-10, item
 * 36): the one sentence that makes the hello easy, on the arrivals roster row
 * the crew is looking at when the diver walks up. The name to say and the card
 * they hold, in the same words the waitlist and the deal list use for a card
 * (`certificationSummaryText`), so a level that is only the diver's word says
 * so here too.
 *
 * Only the card. What a diver said they came for stays the departure's count
 * and names nobody (ADR 20260904-reef-all-the-way-down, D12), and a booking's
 * free-text note can carry anything, medical included, so it stays behind the
 * row's own note count. A diver who gave the shop no card at all gets the
 * hello without one: "level not said" is a desk task, not a greeting.
 */
export function welcomeDockLine(
  t: StaffTranslator,
  locale: string,
  {
    personName,
    certification,
  }: { personName: string; certification: CertificationSummaryShape | null },
): string {
  const name = firstNameOf(personName, personName);
  if (!certification?.level && !certification?.noCertificationDeclared) {
    return t("shared.welcomeCue.dockLineNoCard", { name });
  }
  return t("shared.welcomeCue.dockLine", {
    name,
    card: certificationSummaryText(t, certification, locale),
  });
}
