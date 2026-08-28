/**
 * **What a diver's dive needs set up, as facts a crew plans around.**
 *
 * The framework-free half of the accessible-dive record (ADR
 * 20260827-support-needs-are-a-record-about-the-dive). The row lives beside
 * `rental_fit_profiles`; this file decides what counts as an answer, what a
 * departure's totals are, and nothing else.
 *
 * **Nothing here gates.** There is no `blocks()`, no minimum, and no comparison
 * against a roster that could come out short. `src/lib/dive-recency.ts` states
 * the standard this copies:
 *
 * > A shop seeing "Advanced Open Water · last dived 5+ years ago" beside a name
 * > is the entire value; a refusal would be the software deciding a refresher
 * > question that belongs to a divemaster.
 *
 * The same is true here and matters more. A support requirement is a
 * conversation between a diver and a shop, and software that turned one into a
 * refusal would be refusing the diver rather than the arrangement — which is the
 * outcome adaptive divers already get everywhere else and the reason this record
 * exists at all. `supportDiversNeeded` feeds arithmetic the way
 * `src/lib/divemaster-ratio.ts`'s target does: shown beside what is rostered,
 * binding nothing. `src/lib/course-ratios.ts` is the opposite — agency caps that
 * really do refuse a seat — and no diver's support needs may ever move one.
 */

/**
 * Who puts the support divers in the water. See the column's own note in
 * `schema.ts`: the shop's action is opposite in the two cases, and a count
 * without this is a number nobody can staff by.
 */
export type SupportDiverProvider = "shop" | "diver";

/** The record as any reader sees it. Every field is optional; most divers state none. */
export type SupportNeeds = {
  /**
   * People this diver needs in the water with them. `null` is "not stated"; a
   * stated `0` is a different answer and is preserved as one — it is a diver
   * saying they need nobody, which a crew planning a boat is entitled to read.
   */
  supportDiversNeeded: number | null;
  /** Null exactly when the count is null or 0 — a DB check constraint pins the pairing. */
  supportDiversProvidedBy: SupportDiverProvider | null;
  needsBoardingAssistance: boolean;
  /** A lift or hoist into the water **and back out of it** — see the column's note. */
  needsWaterLift: boolean;
  briefingInSign: boolean;
  briefingInWriting: boolean;
  /** Described out loud, for a diver who cannot read a slate or a site map. */
  briefingAloud: boolean;
  briefingBySignals: boolean;
  equipmentAdaptation: string | null;
  /** Somebody who must be on the same departure and buddy team, as the diver named them. */
  divesWithName: string | null;
  /**
   * When the diver last answered, or null when nobody has asked.
   *
   * The one field here that is not itself an arrangement, and the only thing
   * that tells "asked, needs nothing" from "never asked" — every other field
   * reads identically in both. A crew surface renders neither (both ask nothing
   * of the boat), but the diver's own page reads it to stop asking a question
   * they have already answered with a no.
   */
  statedAt: Date | null;
};

/**
 * The arrangements alone -- every field except `statedAt`.
 *
 * `statedAt` answers "was this diver ever asked", which the diver's own page
 * reads and no crew surface renders. Everything that decides what a crew *does*
 * is in here, so the two readers that answer that question take this rather than
 * the whole record: `supportNeedFacts` below, and the offline manifest snapshot,
 * which carries the arrangements and deliberately not the timestamp (issue
 * #1067).
 */
export type SupportArrangements = Omit<SupportNeeds, "statedAt">;

/**
 * Whether this record says anything a crew would act on.
 *
 * A stated `0` support divers is deliberately **not** something to act on: it
 * asks nothing of the boat, so a manifest that printed a line for it would be
 * formatting the absence of information as information (design principle 9). The
 * row still exists and `statedAt` still records that the diver answered — that
 * is what a staff surface reads to tell "nothing needed" from "nobody asked".
 */
export function hasSupportNeeds(needs: SupportArrangements | null | undefined): boolean {
  if (!needs) return false;
  return (
    (needs.supportDiversNeeded ?? 0) > 0 ||
    needs.needsBoardingAssistance ||
    needs.needsWaterLift ||
    needs.briefingInSign ||
    needs.briefingInWriting ||
    needs.briefingAloud ||
    needs.briefingBySignals ||
    Boolean(needs.equipmentAdaptation?.trim()) ||
    Boolean(needs.divesWithName?.trim())
  );
}

/**
 * Whether the diver has answered at all, whatever they answered.
 *
 * Distinct from {@link hasSupportNeeds} and used in exactly one place: the
 * diver's own `/ready` row, which must stop asking once they have said "I need
 * nobody". A crew surface has no use for it — "asked, needs nothing" and "never
 * asked" both ask nothing of the boat, and a manifest that printed a line for
 * either would be formatting the absence of information as information.
 */
export function supportNeedsAnswered(needs: SupportNeeds | null | undefined): boolean {
  return Boolean(needs?.statedAt);
}

/**
 * The facts of one record, in the order a crew reads them, as codes rather than
 * words — `src/i18n/support-needs-labels.ts` turns these into a sentence.
 *
 * Codes rather than sentences because `src/lib` returns codes and the UI picks
 * the words, and because the same list is read by a staff surface in the shop's
 * language and by the diver's own page in theirs.
 */
export type SupportNeedFact =
  | { kind: "support_divers"; count: number; providedBy: SupportDiverProvider }
  | { kind: "boarding_assistance" }
  | { kind: "water_lift" }
  | { kind: "briefing_sign" }
  | { kind: "briefing_written" }
  | { kind: "briefing_aloud" }
  | { kind: "briefing_signals" }
  | { kind: "equipment"; note: string }
  | {
      kind: "dives_with";
      name: string;
      /**
       * Whether that person appears on the departure's roster, when a roster
       * was supplied. `null` means nobody checked — a surface with no roster in
       * hand says the constraint and stops, rather than implying an answer it
       * does not have.
       */
      match: DivesWithMatch | null;
    };

/**
 * Every stated fact, in reading order. Empty when nothing was stated.
 *
 * `roster` is the departure's names, when the caller has them: it decides
 * whether the `dives_with` fact can say if that person is aboard (issue #1068).
 * Omitting it is a legitimate answer, not a degraded one — the offline snapshot
 * and the diver's own record both state the constraint without a departure to
 * check it against.
 */
export function supportNeedFacts(
  needs: SupportArrangements | null | undefined,
  roster?: readonly string[],
): SupportNeedFact[] {
  if (!needs) return [];
  const facts: SupportNeedFact[] = [];
  // Ordered the way the day runs: who is in the water, then getting aboard and
  // in, then the briefing, then kit, then who they are diving with.
  if ((needs.supportDiversNeeded ?? 0) > 0) {
    facts.push({
      kind: "support_divers",
      count: needs.supportDiversNeeded as number,
      // Defaulted rather than narrowed: the DB pairs the two, and a crew reading
      // "2 support divers" with no idea who brings them is the ambiguity this
      // field exists to remove — so a row that somehow lost its provider reads
      // as the answer that makes a shop *look*, not the one that makes it relax.
      providedBy: needs.supportDiversProvidedBy ?? "shop",
    });
  }
  if (needs.needsBoardingAssistance) facts.push({ kind: "boarding_assistance" });
  if (needs.needsWaterLift) facts.push({ kind: "water_lift" });
  if (needs.briefingInSign) facts.push({ kind: "briefing_sign" });
  if (needs.briefingInWriting) facts.push({ kind: "briefing_written" });
  if (needs.briefingAloud) facts.push({ kind: "briefing_aloud" });
  if (needs.briefingBySignals) facts.push({ kind: "briefing_signals" });
  const equipment = needs.equipmentAdaptation?.trim();
  if (equipment) facts.push({ kind: "equipment", note: equipment });
  const divesWith = needs.divesWithName?.trim();
  if (divesWith) {
    facts.push({
      kind: "dives_with",
      name: divesWith,
      match: roster ? divesWithMatch(divesWith, roster) : null,
    });
  }
  return facts;
}

/**
 * **Is the person this diver must dive with actually on this departure?**
 *
 * `dives_with_name` is free text a diver typed on a bearer-token page, about
 * somebody the shop may hold no record of — so this is a name-to-name match and
 * can never be anything better. The ADR keeps it that way deliberately: asking a
 * diver to identify a `people` row they cannot see is the wrong shape.
 *
 * **Loose on purpose, and asymmetric on purpose.** Getting this wrong in the
 * confident direction — telling a crew "not booked on this departure" about
 * somebody who *is* booked under a different spelling — is worse than saying
 * nothing, because it reads as a checked fact and invites the shop to stop
 * looking. So the match normalises case, whitespace and accents, and a
 * first-name-only hit counts as a hit: "Omar" matches "Omar Haddad", and
 * "O. Haddad" matches on the surname. A false "yes" costs a glance down the
 * roster; a false "no" costs the arrangement.
 *
 * **It never gates.** Nothing calls this to refuse a booking, hold a departure,
 * or build a team — a departure with the constraint unmet sails, and the shop
 * has a conversation (the ADR's fourth refusal). It exists so the person
 * building buddy teams can see the constraint at the moment they act on it.
 */
export type DivesWithMatch = "on_departure" | "not_on_departure";

/** Case, accents, punctuation and runs of whitespace all folded away. */
function foldName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The words of a name, folded — "O. Haddad" → ["o", "haddad"]. */
function nameParts(value: string): string[] {
  const folded = foldName(value);
  return folded ? folded.split(" ") : [];
}

/**
 * Whether `named` plausibly refers to somebody on `roster`.
 *
 * Returns `null` when the diver named nobody — "no constraint" is a different
 * answer from "the person they named is not here", and a surface that conflated
 * the two would put a line on every diver on the boat.
 */
export function divesWithMatch(
  named: string | null | undefined,
  roster: readonly string[],
): DivesWithMatch | null {
  const wanted = nameParts(named ?? "");
  if (wanted.length === 0) return null;
  const hit = roster.some((candidate) => {
    const parts = nameParts(candidate);
    if (parts.length === 0) return false;
    const full = parts.join(" ");
    // The whole typed string against the whole name, first: the ordinary case,
    // and the only one that needs no charity.
    if (wanted.join(" ") === full) return true;
    // Otherwise every word the diver typed has to land somewhere in the name.
    // A single initial ("O.") matches the word it begins, which is what makes
    // "O. Haddad" work without letting one stray letter match anybody.
    return wanted.every((word) =>
      parts.some((part) => (word.length === 1 ? part.startsWith(word) : part === word)),
    );
  });
  return hit ? "on_departure" : "not_on_departure";
}

/**
 * **How many in-water supporters this departure has to find**, which is not the
 * same as how many will be in the water.
 *
 * Only the divers who asked the *shop* to arrange them. A diver bringing their
 * own adaptive-trained buddy needs seats and a buddy team, not crew — summing
 * them in would have a manager staff up for people who are already coming, and
 * that mistake in the other direction leaves a diver alone in the water
 * (`dive-domain-expert` review, 2026-08-27).
 *
 * **Information, never a gate.** Nothing compares this against the roster and
 * refuses anything — the same authority `src/lib/divemaster-ratio.ts` has, which
 * is none. A departure short of this number sails, and the shop has a
 * conversation.
 *
 * It renders on the prep list, beside the divers who asked. The crew-versus-target
 * comparison lives on the trip page's Crew panel, so no single screen shows both
 * today — worth knowing before writing that it does.
 */
export function supportDiversToArrange(
  roster: readonly { supportNeeds?: SupportNeeds | null }[],
): number {
  return roster.reduce(
    (total, diver) =>
      diver.supportNeeds?.supportDiversProvidedBy === "shop"
        ? total + (diver.supportNeeds.supportDiversNeeded ?? 0)
        : total,
    0,
  );
}
