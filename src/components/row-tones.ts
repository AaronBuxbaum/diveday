/**
 * The person-row state tones — one vocabulary for every surface that renders
 * "a person's line wearing its state" as a `border-l-4` left rule plus a
 * tinted fill. Two surfaces speak it today: the manifest's roll call
 * (`trips/[id]/manifest/_components/`) and the counter check-in queue
 * (`check-in/page.tsx`). They are read minutes apart by the same staffer —
 * counter first, dock second — so a colour must mean the same thing on both,
 * and this module is what keeps a retune on one from silently leaving the
 * other behind (FU-20260811-row-tone-vocabulary).
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
} as const;

/**
 * The counter queue's fills — the same meanings at indoor strength. A settled
 * arrival is the roll call's green a wash quieter; a blocked diver is the
 * *same* `danger/5` as the manifest's blocked row, because "readiness is the
 * thing to fix" is the identical fact on both surfaces; and an awaiting row
 * is deliberately unmarked — at the counter, "not arrived yet" is the norm,
 * not a state demanding attention the way an uncalled name at the rail does.
 */
export const CHECK_IN_ROW_TONE = {
  checkedIn: "border-success bg-success/10",
  /** Transparent, not absent: the rule holds the text aligned across states. */
  awaiting: "border-transparent",
  blocked: ROLL_CALL_ROW_TONE.blocked,
} as const;
