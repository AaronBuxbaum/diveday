import { formatOrdinal } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { firstNameOf } from "@/lib/person-name";
import type { WelcomeCue, WelcomeHello } from "@/lib/welcome-cue";
import { CERTIFICATION_LEVEL_KEYS, type CertificationSummaryShape } from "./readiness-labels";
import type { StaffTranslator } from "./staff-messages";

/**
 * The welcome cue's words (issue #1182, delight report D22).
 *
 * `src/lib/welcome-cue.ts` returns a code and a number of years; this picks the
 * words, the same split `birthday-labels.ts` follows.
 */

/**
 * The line under a diver's name on the roster and the manifest: "First dive
 * with us", "Back after 3 years"; "First time with us" under a snorkeler or a
 * rider, whose seat is not a dive.
 *
 * Its own line, so it opens with a capital like every other line under a name,
 * and unpunctuated because it is a label, not a sentence (fourth review, item
 * 42: Today said "first dive with you", the roster "first time with us", the
 * diver record "first dive with us"; one phrase now). Sentence case, never
 * "First Time With Us": a title-cased cue is a badge with the shape filed off.
 */
export function welcomeCueText(t: StaffTranslator, cue: WelcomeCue, locale: string): string {
  if (cue.kind === "returning") return t("shared.welcomeCue.returning", { years: cue.years });
  // "25th dive day with us" (H-20261014-boat-count-milestones): a count, never a badge.
  if (cue.kind === "milestone") {
    return t("shared.welcomeCue.milestone", { ordinal: formatOrdinal(cue.count, locale) });
  }
  return cue.nonDiver ? t("shared.welcomeCue.firstTime") : t("shared.welcomeCue.firstTrip");
}

/**
 * The shop home's row: whole sentences, because there is no name above them to
 * continue from.
 *
 * The first-timers collapse into one sentence with their names joined through
 * `Intl.ListFormat` (a second for snorkelers and riders, whose first time is
 * not a first dive); each returning diver takes a sentence of their own,
 * because the number of years is theirs and averaging it would invent a fact.
 */
export function sayHelloSentences(
  t: StaffTranslator,
  locale: string,
  cues: ReadonlyArray<{ name: string; cue: WelcomeCue }>,
): string[] {
  const list = cachedListFormat(locale, { type: "conjunction" });
  const sentences: string[] = [];
  for (const [nonDiver, key] of [
    [false, "today.sayHello.firstTrip"],
    [true, "today.sayHello.firstTime"],
  ] as const) {
    const firstTimers = cues.filter(
      (entry) => entry.cue.kind === "first_trip" && Boolean(entry.cue.nonDiver) === nonDiver,
    );
    if (firstTimers.length === 0) continue;
    sentences.push(
      t(key, {
        count: firstTimers.length,
        names: list.format(firstTimers.map((entry) => entry.name)),
      }),
    );
  }
  for (const entry of cues) {
    if (entry.cue.kind === "milestone") {
      sentences.push(
        t("today.sayHello.milestone", {
          name: entry.name,
          ordinal: formatOrdinal(entry.cue.count, locale),
        }),
      );
      continue;
    }
    if (entry.cue.kind !== "returning") continue;
    sentences.push(t("today.sayHello.returning", { name: entry.name, years: entry.cue.years }));
  }
  return sentences;
}

/** The words for what a first-timer chose to add (#2425): fragments that end the dock line. */
export const WELCOME_HELLO_KEYS = {
  first_ocean_dive: "shared.welcomeCue.hello.firstOceanDive",
  celebrating: "shared.welcomeCue.hello.celebrating",
  nervous: "shared.welcomeCue.hello.nervous",
} as const satisfies Record<WelcomeHello, string>;

/**
 * The card the dock line reads: the certification summary plus the highest
 * level the shop has actually **verified** (`CertificationSummary.verifiedLevel`).
 * Optional so a summary that never read it greets as unverified, which is the
 * safe direction.
 */
export type DockLineCard = Pick<CertificationSummaryShape, "level" | "noCertificationDeclared"> & {
  verifiedLevel?: CertificationSummaryShape["level"];
};

type DockLineFact =
  | { kind: "verified"; level: NonNullable<CertificationSummaryShape["level"]> }
  | { kind: "says"; level: NonNullable<CertificationSummaryShape["level"]> }
  | { kind: "notCertified" };

/**
 * What the greeting may say about a card, strongest first. A verified level is
 * said plainly; any level nobody has verified, whether the diver typed it or a
 * staffer did, is what the diver *says*; a stated "no card" is "not certified
 * yet". Nitrox is never here: a greeting is not a fill clearance, and the gas
 * is the fill station's question.
 */
function dockLineFact(card: DockLineCard | null): DockLineFact | null {
  if (card?.verifiedLevel) return { kind: "verified", level: card.verifiedLevel };
  if (card?.level) return { kind: "says", level: card.level };
  if (card?.noCertificationDeclared) return { kind: "notCertified" };
  return null;
}

/**
 * Whether the dock line is carrying a card nobody has verified, so the row can
 * wear the same warning tone `certificationSummaryUnchecked` gives the phrase.
 */
export function welcomeDockLineUnchecked(card: DockLineCard | null): boolean {
  const fact = dockLineFact(card);
  return fact !== null && fact.kind !== "verified";
}

/**
 * **The dock line under "first time with us"** (UX review 2026-10-10, item
 * 36): the one sentence that makes the hello easy, on the arrivals roster row
 * the crew is looking at when the diver walks up. The name to say and a level
 * the shop has verified; any card nobody has verified is what the diver
 * "says", whoever typed it (dive-domain review of the demo layer: a pending
 * card a staffer typed carries no self-declared stamp, and read as checked).
 *
 * Only the card. What a diver said they came for stays the departure's count
 * and names nobody (ADR 20260904-reef-all-the-way-down, D12), and a booking's
 * free-text note can carry anything, medical included, so it stays behind the
 * row's own note count. A diver who gave the shop no card at all gets the
 * hello without one: "level not said" is a desk task, not a greeting.
 *
 * **The one other thing it may carry is the diver's own fixed choice**
 * (issue #2425): first ocean dive, celebrating, nervous, ending the line. The
 * caller passes it only for a consented seat (`welcomeCueInputsByBooking`
 * returns null without a yes), and there is deliberately no parameter a note
 * could arrive through.
 */
export function welcomeDockLine(
  t: StaffTranslator,
  {
    personName,
    certification,
    hello = null,
  }: { personName: string; certification: DockLineCard | null; hello?: WelcomeHello | null },
): string {
  const line = dockLineSentence(t, personName, certification);
  return hello ? `${line} ${t(WELCOME_HELLO_KEYS[hello])}` : line;
}

function dockLineSentence(
  t: StaffTranslator,
  personName: string,
  certification: DockLineCard | null,
): string {
  const name = firstNameOf(personName, personName);
  const fact = dockLineFact(certification);
  if (!fact) return t("shared.welcomeCue.dockLineNoCard", { name });
  if (fact.kind === "notCertified") {
    return t("shared.welcomeCue.dockLine", {
      name,
      card: t("shared.certificationSummary.notCertified"),
    });
  }
  const level = t(CERTIFICATION_LEVEL_KEYS[fact.level]);
  return fact.kind === "verified"
    ? t("shared.welcomeCue.dockLine", { name, card: level })
    : t("shared.welcomeCue.dockLineSays", { name, level });
}
