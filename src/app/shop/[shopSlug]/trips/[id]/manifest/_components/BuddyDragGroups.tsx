"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BuddyMemberOption } from "./BuddyTeamsPanel";

/** Every word this renders, resolved server-side — `staffTranslator` is server-only. */
export type BuddyDragCopy = {
  /** How to pair by dragging, said once above the groups. */
  hint: string;
  /** Announced while a person is held, with `{name}` filled in. */
  holding: string;
  /** Announced when a drag is over someone, with `{a}` and `{b}`. */
  over: string;
};

/** How long a press has to be held before it becomes a drag rather than a tap. */
const HOLD_MS = 250;
/** How far a finger may wander during that hold before it counts as a scroll. */
const SLOP_PX = 10;

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  );
}

/**
 * The buddy-team builder's people, pairable by dragging one onto another.
 *
 * **The checkboxes are still the form.** Every chip is the same
 * `<label><input type="checkbox" name="members">` the builder has always
 * rendered, inside the same `<form>`, posting to the same server action — so
 * keyboard, screen-reader, and no-JavaScript use are untouched, and a team of
 * three or more is still built by ticking three boxes and pressing the button.
 * Dragging is a second way to express the *two-person* case, which is most of
 * them, and it works by ticking those two boxes and submitting the form the
 * page already has. There is no second code path to keep in step.
 *
 * **Why pointer events and a hold, rather than HTML5 drag-and-drop.** The
 * native `draggable` API does not fire on touch at all, and this is asked for
 * on a phone at a dock. Pointer events cover mouse, touch and stylus in one
 * path. The 250ms hold is what keeps the chip's ordinary behaviours: a quick
 * tap still toggles the checkbox, and a finger that moves before the hold
 * elapses is scrolling the page, not picking someone up.
 *
 * **Why `touchmove` is cancelled imperatively** rather than with a
 * `touch-action: none` class: `touch-action` has to be in place before the
 * gesture starts, so declaring it on the chips would cost the page the ability
 * to scroll by dragging from one — on a panel that is mostly chips. Holding
 * still for 250ms means the browser has not committed to a scroll yet, so a
 * non-passive `touchmove` listener registered at that moment can still cancel
 * it.
 */
export function BuddyDragGroups({
  groups,
  copy,
}: {
  groups: ReadonlyArray<{ heading: string; options: readonly BuddyMemberOption[] }>;
  copy: BuddyDragCopy;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  /** The token being carried, once the hold has elapsed. */
  const [heldToken, setHeldToken] = useState<string | null>(null);
  /** The token currently under the pointer, if it is a different person. */
  const [overToken, setOverToken] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number; token: string; label: string } | null>(null);

  const labelFor = useCallback(
    (token: string | null) =>
      groups.flatMap((group) => group.options).find((option) => option.token === token)?.label ??
      "",
    [groups],
  );

  const endDrag = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    origin.current = null;
    setHeldToken(null);
    setOverToken(null);
    setGhost(null);
  }, []);

  // While someone is held, the page must not scroll under them. Registered
  // only for the duration of the drag, and non-passive so it can cancel.
  useEffect(() => {
    if (!heldToken) return;
    const prevent = (event: TouchEvent) => event.preventDefault();
    document.addEventListener("touchmove", prevent, { passive: false });
    return () => document.removeEventListener("touchmove", prevent);
  }, [heldToken]);

  /** The chip under a point, if it belongs to someone else. */
  function tokenAt(x: number, y: number, exclude: string): string | null {
    const element = document.elementFromPoint(x, y);
    const chip = element?.closest<HTMLElement>("[data-buddy-token]");
    const token = chip?.dataset.buddyToken ?? null;
    return token && token !== exclude ? token : null;
  }

  function onPointerDown(event: React.PointerEvent<HTMLLabelElement>, option: BuddyMemberOption) {
    // Secondary buttons belong to the browser's own menus.
    if (event.button !== 0) return;
    origin.current = {
      x: event.clientX,
      y: event.clientY,
      token: option.token,
      label: option.label,
    };
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    holdTimer.current = setTimeout(() => {
      if (!origin.current) return;
      // Capture so the drag survives the pointer leaving this chip — without
      // it, `pointerup` lands on whatever is underneath instead.
      target.setPointerCapture(pointerId);
      setHeldToken(option.token);
      setGhost({ x: origin.current.x, y: origin.current.y, label: option.label });
    }, HOLD_MS);
  }

  function onPointerMove(event: React.PointerEvent<HTMLLabelElement>) {
    const start = origin.current;
    if (!start) return;
    if (!heldToken) {
      // Still deciding. Movement before the hold elapses is a scroll, so let
      // the page have it back.
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (moved > SLOP_PX) endDrag();
      return;
    }
    setGhost({ x: event.clientX, y: event.clientY, label: start.label });
    setOverToken(tokenAt(event.clientX, event.clientY, heldToken));
  }

  function onPointerUp(event: React.PointerEvent<HTMLLabelElement>) {
    const held = heldToken;
    if (!held) {
      // A tap: let the label toggle its own checkbox, as it always has.
      endDrag();
      return;
    }
    // A completed drag is not also a click on the chip it started from.
    event.preventDefault();
    const dropped = tokenAt(event.clientX, event.clientY, held);
    endDrag();
    if (!dropped) return;

    const root = rootRef.current;
    const form = root?.closest("form");
    if (!root || !form) return;
    // Tick exactly these two and submit the builder's own form. Anything the
    // staffer had already ticked is cleared first, so a drag means what it
    // looks like — these two people, and nobody else.
    for (const input of root.querySelectorAll<HTMLInputElement>('input[name="members"]')) {
      input.checked = input.value === held || input.value === dropped;
    }
    form.requestSubmit();
  }

  const announcement = heldToken
    ? overToken
      ? fill(copy.over, { a: labelFor(heldToken), b: labelFor(overToken) })
      : fill(copy.holding, { name: labelFor(heldToken) })
    : "";

  return (
    <div ref={rootRef}>
      <p className="mt-3 text-sm text-muted">{copy.hint}</p>
      {groups.map((group) => (
        <div key={group.heading}>
          <p className="mt-3 text-xs font-semibold tracking-wide text-muted uppercase">
            {group.heading}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
            {group.options.map((option) => (
              // A horizontal checkbox row is not a stacked `Field`
              // (docs/design/forms-and-controls.md), but it is still a target:
              // `min-h-11` and a control big enough to hit without aiming.
              <label
                key={option.token}
                data-buddy-token={option.token}
                onPointerDown={(event) => onPointerDown(event, option)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={endDrag}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-base transition-colors select-none ${
                  overToken === option.token
                    ? "bg-primary/15 ring-2 ring-primary"
                    : heldToken === option.token
                      ? "opacity-50"
                      : ""
                }`}
              >
                <input
                  type="checkbox"
                  name="members"
                  value={option.token}
                  className="size-5 accent-primary"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
      {/* Follows the finger so it is clear who is being carried — a phone hides
          the chip itself under the hand holding it. `pointer-events-none` keeps
          it out of `elementFromPoint`, which is what finds the drop target. */}
      {ghost ? (
        <div
          aria-hidden="true"
          style={{ left: ghost.x, top: ghost.y }}
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[150%] rounded-lg border border-primary bg-surface px-3 py-2 text-base font-medium shadow-lg"
        >
          {ghost.label}
        </div>
      ) : null}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
