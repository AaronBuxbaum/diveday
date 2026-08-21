import type { diveRecencyBand } from "@/db/schema";

/**
 * **How long since this diver was last in the water**, in their own words.
 *
 * The question no form in this product asked until 2026-08-21, and the one a
 * `dive-domain-expert` review named as worth more than everything the booking
 * gate does catch (ADR 20260821-currency-is-what-catches-people):
 *
 * > The claim that will hurt a Florida shop is not an inflated rung, it's an
 * > honest "Advanced Open Water" from 1998 with no dive since 2013.
 *
 * Currency is not a card. It does not expire, nothing verifies it, and no rung
 * on `CertificationLevel` can express it — which is why it lives here and on
 * `bookings.last_dived_band` rather than anywhere near `certifications`.
 *
 * **Nothing in this file gates anything.** There is no `blocks()`, no rank
 * comparison, and no minimum. A shop seeing "Advanced Open Water · last dived
 * 5+ years ago" beside a name is the entire value; a refusal would be the
 * software deciding a refresher question that belongs to a divemaster.
 */
export type DiveRecencyBand = (typeof diveRecencyBand.enumValues)[number];

/**
 * The bands in the order a person thinks about them — most recent first, with
 * `never` last because it is a different kind of answer rather than the far end
 * of the scale.
 *
 * A runtime tuple with a `satisfies`, the same guard shape as
 * `DECLARABLE_CERTIFICATION_LEVELS`: adding a band to the pgEnum without adding
 * it here is a **compile error**, so the form can never quietly stop offering an
 * answer the column accepts.
 */
export const DIVE_RECENCY_BANDS = [
  "this_season",
  "within_a_year",
  "one_to_five_years",
  "over_five_years",
  "never",
] as const satisfies readonly DiveRecencyBand[];

/**
 * **The two answers a divemaster would want to read twice.**
 *
 * Not a gate and not a warning the diver ever sees — it only decides whether a
 * staff surface renders the answer in the same attention-drawing tone a
 * self-declared card gets, rather than as one more line of a roster. A diver
 * who last dived over five years ago, or has never dived at all, is a briefing
 * and a buddy pairing, not a refusal.
 *
 * `one_to_five_years` is deliberately *not* here. Two seasons off is ordinary
 * for a holiday diver, and tinting it would tint most of a Florida shop's
 * winter roster — which is how a signal stops being read.
 */
const NOTABLE_BANDS = new Set<DiveRecencyBand>(["over_five_years", "never"]);

/**
 * Whether staff should see this answer picked out. `null` — the diver was not
 * asked, or did not say — is never notable: an absent answer is not a claim
 * about anything, and treating silence as a red flag would punish every diver
 * who booked before the question existed.
 */
export function diveRecencyIsNotable(band: DiveRecencyBand | null | undefined): boolean {
  return band != null && NOTABLE_BANDS.has(band);
}
