import type { RollCallRecordedTone } from "@/lib/manifests";

/**
 * The person-row state tones — one vocabulary for the surfaces that render
 * "a person's line wearing its state" as a `border-l-4` left rule plus a
 * tinted fill. Two surfaces speak it, and they are the *boat's*: the
 * manifest's roll call (`trips/[id]/manifest/_components/`) and the offline
 * boat-mode manifest (`src/components/OfflineManifestView.tsx`). They are read
 * minutes apart by the same crew, often on two devices at once, so a colour
 * must mean the same thing on both, and this module is what keeps a retune on
 * one from silently leaving the other behind
 * (FU-20260811-row-tone-vocabulary).
 *
 * The offline surface was the one that got away: it could not import the
 * live page's derivation (that lived under `src/app`, which `src/components`
 * may not reach) so it kept a copy, and the copy drifted into painting an
 * *awaiting* diver amber with a ring — the two marks this module reserves for
 * "left ashore" and "did not come back". The derivation now lives in
 * `src/lib/manifests.ts`, where every surface can reach it.
 *
 * **The counter's map is gone, and its absence is the point.** The check-in
 * queue used to carry a third, quieter set of the same fills; slice 6h of ADR
 * 20260827-clearwater-surface-language recomposed that surface as hairline
 * ledger rows with tone in the ink and a word on every state (decisions 2 and
 * 3), so there is no fill left there to keep in step. The boat keeps its
 * fills: they are read across a wet deck in sunlight, which is a different
 * problem from an indoor desk.
 *
 * Colour never carries a state alone on either surface: every row states its
 * status in words beside the fill (design principle 6).
 */

/**
 * The roll call's fills, shared by the diver rows and the crew rows so the
 * two lists can never disagree about what a colour means.
 *
 * The two *recorded* outcomes have to be told apart across a wet deck in
 * sunlight, which is why they are different hues rather than two washes of
 * the same one: aboard is green, left ashore is amber. They used to be
 * `success/10` and a plain slate `surface-sunken`, two pale neutrals that
 * read as the same card at arm's length. Awaiting takes the slate instead —
 * nothing has been said about that person yet.
 *
 * **Only one row on that page wears a ring**, and it is the one that means a
 * person is in the water. "Left ashore" is a *settled* outcome — the glossary
 * calls it benign and genuinely accounted for — so it gets the hue that
 * separates it from green and none of the alarm that separates red from
 * everything: a ringed amber sitting beside a ringed red reads as the same
 * class of emergency at arm's length in glare, and it would make the most
 * closed row on the page louder than `awaiting`, which is the state that
 * still needs a human (dive-domain review 20260804).
 */
export const ROLL_CALL_ROW_TONE = {
  /** A stated "did not come back" — the loudest thing on the page, and the only ring. */
  notBackAboard: "border-danger bg-danger/15 ring-1 ring-danger/40",
  boarded: "border-success bg-success/20",
  notBoarded: "border-warning bg-warning/15",
  /** Carried forward from the dock rather than recorded here — same hue, quieter. */
  notBoardedImplied: "border-dashed border-warning/60 bg-warning/5",
  awaiting: "border-border-strong bg-surface-sunken",
  /** Awaiting *and* blocked: readiness is the thing to fix before boarding. */
  blocked: "border-danger bg-danger/5",
  // Pinned against the domain type so the two halves cannot drift: a recorded
  // tone named in `src/lib/manifests.ts` with no fill here, or a fill renamed
  // here while a surface still asks for it, is a compile error rather than a
  // roll-call row that silently renders unstyled.
} as const satisfies Record<RollCallRecordedTone | "awaiting" | "blocked", string>;

/**
 * The offline manifest's **crew** rows — the same meanings again, on a card
 * rather than a left rule.
 *
 * The shape differs because the offline crew list is a panel of full-width
 * cards, not a ruled list: there is no column edge for a `border-l-4` to sit
 * against. The *hues* are the roll call's, deliberately, because both lists
 * are read on the same deck and often on two devices at once — a crew member
 * must not read as a warning on the phone and as settled on the tablet
 * (dive-domain review 20260804).
 *
 * `awaiting` is the one entry that is not a restatement of the roll call's:
 * it is **raised, not sunken**. These used to be small chips, where
 * `bg-surface-sunken` read as a chip against the panel; as full-width rows
 * carrying controls, that same fill *is* the panel's own background, and an
 * uncalled crew member would have no edge at all — the one row a captain is
 * looking for.
 */
export const OFFLINE_CREW_ROW_TONE = {
  notBackAboard: "bg-danger/15 font-bold text-danger",
  boarded: "bg-success/20",
  notBoarded: "bg-warning/15",
  notBoardedImplied: "bg-warning/5",
  awaiting: "border border-border bg-surface",
} as const satisfies Record<RollCallRecordedTone | "awaiting", string>;
