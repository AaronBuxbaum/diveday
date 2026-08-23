import type { RollCallRecordedTone } from "@/lib/manifests";

/**
 * The person-row state tones — one vocabulary for every surface that renders
 * "a person's line wearing its state" as a `border-l-4` left rule plus a
 * tinted fill. Three surfaces speak it: the manifest's roll call
 * (`trips/[id]/manifest/_components/`), the counter check-in queue
 * (`check-in/page.tsx`), and the offline boat-mode manifest
 * (`src/components/OfflineManifestView.tsx`). They are read minutes apart by
 * the same staffer — counter first, dock second, and the offline copy when the
 * signal goes — so a colour must mean the same thing on all three, and this
 * module is what keeps a retune on one from silently leaving the others
 * behind (FU-20260811-row-tone-vocabulary).
 *
 * The offline surface was the one that got away: it could not import the
 * live page's derivation (that lived under `src/app`, which `src/components`
 * may not reach) so it kept a copy, and the copy drifted into painting an
 * *awaiting* diver amber with a ring — the two marks this module reserves for
 * "left ashore" and "did not come back". The derivation now lives in
 * `src/lib/manifests.ts`, where every surface can reach it.
 *
 * The two maps deliberately differ in *strength*, not meaning: the manifest
 * is read across a wet deck in sunlight, so its fills run stronger
 * (`success/20`) and even its untouched rows carry a visible rule; the
 * counter is an indoor surface where "not arrived yet" is the calm default,
 * so its fills are quieter and its awaiting rows carry a transparent rule
 * that exists only to keep text aligned across states. Change a hue in one
 * map and the matching entry above or below it is the reminder to decide for
 * both.
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
 * The counter queue's fills — the same meanings at indoor strength. A settled
 * arrival is the roll call's green a wash quieter; a blocked diver is the
 * *same* `danger/5` as the manifest's blocked row, because "readiness is the
 * thing to fix" is the identical fact on both surfaces; and an awaiting row
 * is deliberately unmarked — at the counter, "not arrived yet" is the norm,
 * not a state demanding attention the way an uncalled name at the rail does.
 */
export const CHECK_IN_ROW_TONE = {
  checkedIn: "border-success bg-success-tint",
  /** Transparent, not absent: the rule holds the text aligned across states. */
  awaiting: "border-transparent",
  blocked: ROLL_CALL_ROW_TONE.blocked,
  // One rule per row, and this is it. A second, absolutely-positioned bar used
  // to sit on top of this border at the same 4px width — two edges of slightly
  // different colours overlapping, the top one fading on hover while the one
  // underneath did not. The border carries both the edge and the fill, which
  // is why it is the half that survived.
} as const;

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
