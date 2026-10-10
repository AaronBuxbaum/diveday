import { RollCallMark, type RollCallMarkState } from "@/components/RollCallMark";
import { buttonClass } from "@/components/ui/button";
import type { RollCallRowState } from "@/lib/manifests";

/**
 * **The roll call's one tap, shared by both manifests** (#1840). The live
 * manifest submits it to the server (`RollCallMarkButton` under
 * `/manifest`); the offline copy queues it on this phone
 * (`offline-manifest/DiverRollCall.tsx`, `CrewRollCall.tsx`). What a crew
 * member sees and where their thumb lands is this file, so the control they
 * learned at the rail is the one they meet the moment the signal drops.
 *
 * It lives in `src/components` because the offline view may not import from
 * `src/app` (`pnpm check:architecture`), the same reason `RollCallMark` does.
 */

/**
 * The affirmative tap itself: a bare 56px circle, no box, no label text. The
 * `RollCallMark` inside it is the drawn state and the button's accessible name
 * is the words, so nothing is carried by colour alone (ADR
 * 20260827-the-departure-is-two-working-surfaces, decision 5).
 *
 * **Drawn round, tapped square — the whole column.** A browser clips an
 * element's hit area to its border radius, so the round button (K-44, for a
 * round focus ring) stopped taking a tap in the 56px square's corners, about a
 * fifth of what had been its target, and a thumb landing there met the
 * column's bare padding. This is the one-tap-per-person control, worked
 * one-handed on a pitching deck. A square stretched `::after` takes the tap
 * for the button over the whole mark column: `-inset-y-2.5` and `-inset-x-3`
 * are that column's `py-2.5 ps-3 pe-3` on both rows (the roll-call tests hold
 * the two together). It paints nothing, and radius is not inherited, so the
 * ring stays a circle.
 */
export const ROLL_CALL_MARK_BUTTON_CLASS = buttonClass({
  variant: "bare",
  size: "mark",
  busy: true,
  className: "relative after:absolute after:-inset-x-3 after:-inset-y-2.5",
});

/**
 * Which drawn mark a row wears, from the same row state every other reader
 * derives. `held` is dock-only by construction: readiness gates boarding at
 * the dock and never after a dive, so a blocked diver mid-count is an ordinary
 * "to call" like anyone else.
 */
export function rollCallMarkState(
  state: RollCallRowState,
  { blockedAtDock = false }: { blockedAtDock?: boolean } = {},
): RollCallMarkState {
  if (state.notBackAboard) return "notBack";
  if (state.boarded) return "aboard";
  if (state.recordedNotBoarded || state.impliedNotBoarded) return "ashore";
  return blockedAtDock ? "held" : "toCall";
}

/**
 * The circle as a plain button, for a caller that records the tap itself (the
 * offline copy, which has no server to submit to). It takes the handler and
 * never decides the gesture: offline, a re-tap queues a retraction naming the
 * statement it undoes (ADR 20260815-an-offline-retraction-names-its-target),
 * and only the caller knows which statement that is.
 *
 * It only ever *affirms*: aboard, or the undo of aboard. The exception — "not
 * boarded", "not back aboard" — is never this control, and a row recorded not
 * back aboard draws a static mark here instead (`RollCallMark`), because
 * turning that row green is not a thumb-under-a-list act (ADR
 * 20260815-offline-can-unsay-a-missing-diver).
 */
export function RollCallMarkTap({
  state,
  label,
  busy,
  onTap,
}: {
  state: RollCallMarkState;
  /** The words: "Mark boarded", or "Boarded — tap again to undo". */
  label: string;
  busy: boolean;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-busy={busy}
      disabled={busy}
      onClick={onTap}
      className={ROLL_CALL_MARK_BUTTON_CLASS}
    >
      <RollCallMark state={state} />
    </button>
  );
}
