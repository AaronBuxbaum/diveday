/**
 * The mark at the end of a roll-call row — the one thing on the boat surface
 * that says where a person is (ADR
 * 20260827-the-departure-is-two-working-surfaces, decision 5).
 *
 * **Drawn, never typed.** These were `☑️` and `❌` in a message bundle until
 * this slice: emoji render as a different picture on every platform, cannot be
 * styled, and are the wrong size at arm's length — on the one surface in the
 * product read in direct sun, off a wet screen, at a distance. An inline SVG on
 * the 16/20/24px grid is the same shape everywhere and takes the row's own ink.
 *
 * **Colour never carries a state by itself.** Every mark here has a *shape* a
 * monochrome reader can tell apart — a check, a minus, a cross, an empty ring,
 * a dashed ring — and every row that renders one also states the same fact in
 * words (the button's accessible name, and the row's own audit line). The five
 * shapes are deliberately distinguishable before the fill is: a boat deck in
 * glare washes hue out long before it washes out geometry.
 *
 * Purely presentational, and `aria-hidden`: the control that wraps it carries
 * the accessible name, so a reader hears "Mark boarded" / "Aboard — tap again
 * to undo" rather than a description of a circle. It lives in `src/components`
 * rather than beside the manifest page because the offline boat-mode manifest
 * renders the same five states and may not import from `src/app`
 * (`pnpm check:architecture`) — the drift that gave that surface its own,
 * wrong, copy of the row tones once already.
 */

/**
 * What a mark can say. These are the states of one *person at one checkpoint*,
 * not a superset of every roll-call record: `notBack` is only reachable after a
 * dive, and `held` only at the dock, because that is where each fact exists
 * (`isNotBackAboard`, and readiness gating boarding at the dock only).
 */
export type RollCallMarkState =
  /** A human recorded them aboard. */
  | "aboard"
  /** A human recorded them left ashore — settled, accounted for on land. */
  | "ashore"
  /** A human recorded them **not back aboard** after a dive. The loud one. */
  | "notBack"
  /** Nobody has said anything yet. "Not yet" — never a warning. */
  | "toCall"
  /** Awaiting *and* blocked at the dock: readiness is the thing to fix first. */
  | "held";

/**
 * The circle's fill and rule per state.
 *
 * `toCall` is deliberately the quietest thing here and deliberately not empty:
 * a plain ring is the "not yet" of decision 4 — a crew starts a count believing
 * everyone is back, so the ordinary mid-count row must not look like a problem.
 * `held` differs from it by a dashed rule rather than by a hue, because a diver
 * the desk has not cleared is not an emergency at the rail; the fix is ashore.
 */
const MARK_CLASS: Record<RollCallMarkState, string> = {
  // Filled, not tinted: this is the one state the tap is *for*, and the row's
  // own green is what a captain reads down the list. `text-surface` inverts
  // correctly in both schemes — light mode paints a white check on a dark
  // green, dark mode a dark check on a bright one.
  aboard: "border border-success bg-success text-surface",
  ashore: "border-2 border-warning bg-warning-tint text-warning-strong",
  notBack: "border-2 border-danger bg-danger-tint text-danger",
  toCall: "border-2 border-border-strong bg-surface",
  held: "border-2 border-dashed border-border-strong bg-surface",
};

/**
 * The glyph inside the circle. `stroke="currentColor"` throughout, so the mark
 * takes the state's ink from the class above and needs no colour of its own —
 * which is also what lets `.boat-mode`'s contrast-boosted palette reach it.
 */
function MarkGlyph({ state }: { state: RollCallMarkState }) {
  if (state === "aboard") {
    return (
      <svg
        width="26"
        height="26"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4.5 10.5 8 14l7.5-8.5" />
      </svg>
    );
  }
  if (state === "ashore") {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M3.5 8h9" />
      </svg>
    );
  }
  if (state === "notBack") {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    );
  }
  // `toCall` and `held` are the ring itself — an empty circle is the shape that
  // means "nothing has been said", and drawing anything inside it would be
  // saying something.
  return null;
}

/**
 * The mark, at the one size the rail uses. 56px is the dock target
 * (`docs/design/forms-and-controls.md`) — the size a wet thumb hits on a moving
 * boat — and it is not configurable here: a smaller roll-call mark somewhere
 * else on the same page would be a second, worse, version of this control.
 */
export function RollCallMark({ state }: { state: RollCallMarkState }) {
  return (
    <span
      className={`grid size-14 shrink-0 place-items-center rounded-full ${MARK_CLASS[state]}`}
      aria-hidden="true"
    >
      <MarkGlyph state={state} />
    </span>
  );
}
