/**
 * **A palm or a sheet of spray is not a tap.** The roll call's aboard mark is
 * one plain tap (ADR 20261001-logbook cut the water lock that once sat in
 * front of it), and a wet hand or water on the glass lands as several
 * contacts at once where a deliberate thumb is one. So the page counts the
 * touch contacts on the screen, and a roll-call press made while more than
 * one was down — at any point in that gesture — does not submit.
 *
 * Touch only: a mouse, a pen and a keyboard press are never refused.
 *
 * Two ways in: `RollCallButton` checks `wasMultiTouch()` on its own press,
 * and a surface marked `data-roll-call-surface` (the offline manifest, whose
 * marks are plain buttons) has every click inside it dropped at the document,
 * in the capture phase, before React sees it.
 *
 * **A refusal is never silent** (issue #2328). Both ways in answer it through
 * {@link refusePress}: the control the press landed on carries
 * `data-touch-refused` for a moment (the outline in globals.css), and a
 * {@link TOUCH_REFUSED_EVENT} bubbles from it to the surface's
 * `RollCallTouchCue`, which says "Tap again with one finger". Nothing is
 * retried: a mark written from an accidental palm is the failure this guard
 * exists to prevent, so the crew taps again or nobody does.
 */
const down = new Set<number>();
let most = 0;
let listening = false;

function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener(
    "pointerdown",
    (event) => {
      // A new gesture starts the count again: any mouse or pen press, or the
      // first finger after every finger has lifted. The count outlives the
      // lift on purpose — the click a gesture makes lands after its pointerup.
      if (event.pointerType !== "touch") {
        if (down.size === 0) most = 0;
        return;
      }
      if (down.size === 0) most = 0;
      down.add(event.pointerId);
      most = Math.max(most, down.size);
    },
    { capture: true },
  );
  document.addEventListener(
    "click",
    (event) => {
      if (most <= 1) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest("[data-roll-call-surface]")) return;
      event.preventDefault();
      event.stopPropagation();
      refusePress(target.closest("button") ?? target);
    },
    { capture: true },
  );
  document.addEventListener(
    "keydown",
    () => {
      if (down.size === 0) most = 0;
    },
    { capture: true },
  );
  const lift = (event: PointerEvent) => {
    if (event.pointerType === "touch") down.delete(event.pointerId);
  };
  document.addEventListener("pointerup", lift, { capture: true });
  document.addEventListener("pointercancel", lift, { capture: true });
}

/** Starts counting contacts; idempotent, and a no-op on the server. */
export function watchRollCallTouches(): void {
  listen();
}

/** Whether the gesture behind the press now landing had more than one contact. */
export function wasMultiTouch(): boolean {
  return most > 1;
}

/** The event a refused press sends up from its control (issue #2328). */
export const TOUCH_REFUSED_EVENT = "diveday:roll-call-touch-refused";
/** The attribute a refused control wears while its cue shows. */
export const TOUCH_REFUSED_ATTRIBUTE = "data-touch-refused";
/** How long the control wears it: long enough to see, gone by the next name. */
export const TOUCH_REFUSED_CUE_MS = 1200;

const clearCue = new WeakMap<Element, ReturnType<typeof setTimeout>>();

/**
 * Answers a press this guard refused: the cue on the control, and the event
 * the surface's words listen for. The one place either happens, so the live
 * control and the offline copy cannot drift. It submits nothing.
 */
export function refusePress(control: Element): void {
  const pending = clearCue.get(control);
  if (pending) clearTimeout(pending);
  control.setAttribute(TOUCH_REFUSED_ATTRIBUTE, "");
  clearCue.set(
    control,
    setTimeout(() => {
      control.removeAttribute(TOUCH_REFUSED_ATTRIBUTE);
      clearCue.delete(control);
    }, TOUCH_REFUSED_CUE_MS),
  );
  control.dispatchEvent(new CustomEvent(TOUCH_REFUSED_EVENT, { bubbles: true }));
}
