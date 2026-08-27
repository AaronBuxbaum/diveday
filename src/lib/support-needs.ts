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

/** The record as any reader sees it. Every field is optional; most divers state none. */
export type SupportNeeds = {
  /**
   * People this diver needs in the water with them. `null` is "not stated"; a
   * stated `0` is a different answer and is preserved as one — it is a diver
   * saying they need nobody, which a crew planning a boat is entitled to read.
   */
  supportDiversNeeded: number | null;
  needsBoardingAssistance: boolean;
  needsWaterEntryLift: boolean;
  briefingInSign: boolean;
  briefingInWriting: boolean;
  briefingBySignals: boolean;
  equipmentAdaptation: string | null;
  /** Somebody who must be on the same departure and buddy team, as the diver named them. */
  divesWithName: string | null;
};

/**
 * Whether this record says anything a crew would act on.
 *
 * A stated `0` support divers is deliberately **not** something to act on: it
 * asks nothing of the boat, so a manifest that printed a line for it would be
 * formatting the absence of information as information (design principle 9). The
 * row still exists and `statedAt` still records that the diver answered — that
 * is what a staff surface reads to tell "nothing needed" from "nobody asked".
 */
export function hasSupportNeeds(needs: SupportNeeds | null | undefined): boolean {
  if (!needs) return false;
  return (
    (needs.supportDiversNeeded ?? 0) > 0 ||
    needs.needsBoardingAssistance ||
    needs.needsWaterEntryLift ||
    needs.briefingInSign ||
    needs.briefingInWriting ||
    needs.briefingBySignals ||
    Boolean(needs.equipmentAdaptation?.trim()) ||
    Boolean(needs.divesWithName?.trim())
  );
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
  | { kind: "support_divers"; count: number }
  | { kind: "boarding_assistance" }
  | { kind: "water_entry_lift" }
  | { kind: "briefing_sign" }
  | { kind: "briefing_written" }
  | { kind: "briefing_signals" }
  | { kind: "equipment"; note: string }
  | { kind: "dives_with"; name: string };

/** Every stated fact, in reading order. Empty when nothing was stated. */
export function supportNeedFacts(needs: SupportNeeds | null | undefined): SupportNeedFact[] {
  if (!needs) return [];
  const facts: SupportNeedFact[] = [];
  // Ordered the way the day runs: who is in the water, then getting aboard and
  // in, then the briefing, then kit, then who they are diving with.
  if ((needs.supportDiversNeeded ?? 0) > 0) {
    facts.push({ kind: "support_divers", count: needs.supportDiversNeeded as number });
  }
  if (needs.needsBoardingAssistance) facts.push({ kind: "boarding_assistance" });
  if (needs.needsWaterEntryLift) facts.push({ kind: "water_entry_lift" });
  if (needs.briefingInSign) facts.push({ kind: "briefing_sign" });
  if (needs.briefingInWriting) facts.push({ kind: "briefing_written" });
  if (needs.briefingBySignals) facts.push({ kind: "briefing_signals" });
  const equipment = needs.equipmentAdaptation?.trim();
  if (equipment) facts.push({ kind: "equipment", note: equipment });
  const divesWith = needs.divesWithName?.trim();
  if (divesWith) facts.push({ kind: "dives_with", name: divesWith });
  return facts;
}

/**
 * How many in-water supporters a whole departure has been asked for.
 *
 * **Information, never a gate.** This is the figure a shop reads beside its
 * rostered crew when deciding whether it has the day covered, exactly as
 * `divemaster-ratio.ts` shows its target beside `inWaterDivemasterCount`.
 * Nothing compares the two and refuses anything: a departure short of this
 * number sails, and the shop has a conversation.
 */
export function totalSupportDiversNeeded(
  roster: readonly { supportNeeds?: SupportNeeds | null }[],
): number {
  return roster.reduce((total, diver) => total + (diver.supportNeeds?.supportDiversNeeded ?? 0), 0);
}
