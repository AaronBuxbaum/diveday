"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";

type SharedProps = {
  triggerLabel: React.ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  triggerClassName?: string;
  /** Defaults to `triggerClassName` — pass a distinct one when the confirm action should read differently (rare). */
  confirmClassName?: string;
  /** Distinct accessible name for the trigger when the visible label repeats elsewhere on the page. */
  ariaLabel?: string;
  /**
   * Reverts to idle if left armed and untouched this long. Off by default: a
   * message block already has an explicit "never mind", and silently
   * resetting out from under someone re-reading a refund preview would be a
   * worse surprise than leaving it armed. A compact trigger with no visible
   * cancel affordance (sign out) should pass this explicitly.
   */
  autoResetMs?: number;
};

type MessageModeProps = SharedProps & {
  /** Shown once armed — the refund/impact preview plus the "are you sure" line. Its presence is what selects this full shape over the compact one. */
  message: string;
  cancelLabel: string;
};

type CompactModeProps = SharedProps & {
  message?: undefined;
  cancelLabel?: undefined;
};

export type InlineConfirmProps = MessageModeProps | CompactModeProps;

/**
 * Two-step, translated in-page confirmation for a form submit that principle
 * 7 (docs/design/principles.md) reserves `confirm()`-equivalents for:
 * genuinely irreversible or a send. Replaces `window.confirm`, whose native
 * dialog (a) can't carry the shop's own locale — it's whatever the
 * browser/OS happens to be set to — and (b) can only show a fixed string,
 * never a value computed server-side (a refund preview, say).
 *
 * `armed` resets on every (re)navigation, keyed off `usePathname()`. This is
 * defensive against React preserving a client component's local state across
 * a navigate-away-and-back instead of remounting it (as `cacheComponents:
 * true`'s Activity-based navigation would — see docs ADR
 * 20260801-cache-components-activity-state, currently reverted, commit
 * 100fcf8): an armed confirm sitting at the same route/key could otherwise
 * resurface still armed, one tap from firing, with no fresh confirming
 * gesture from the person looking at it. This effect re-fires on the leading
 * edge of any such show/re-show cycle exactly like it does on a normal
 * navigation, so it always lands unarmed.
 *
 * Must be rendered inside the `<form action={...}>` whose submit it guards.
 * Unarmed, it's always a plain `type="button"` that never submits anything;
 * no request is sent until a deliberate second tap, and none is sent by
 * backing out. Server-roundtrip pattern: the arm/disarm toggle is local
 * state for responsiveness, but nothing here is optimistic — the real effect
 * only happens on the server action the surrounding form already posts to.
 *
 * Two shapes, selected by whether `message` is passed:
 * - **With a message** (a refund preview, an impact statement that needs
 *   room to read): arming reveals a block with the message, a real submit
 *   button (`SubmitButton`, so `useFormStatus` pending state works), and an
 *   explicit "never mind".
 * - **Without one** (the action is self-explanatory, e.g. sign out — no
 *   extra ceremony is warranted beside Search): the trigger swaps its own
 *   label/style to the confirm state in place. Escape, a blur, or
 *   `autoResetMs` of inactivity disarms it instead of an explicit button.
 */
export function InlineConfirm(props: InlineConfirmProps) {
  const {
    triggerLabel,
    confirmLabel,
    pendingLabel,
    triggerClassName,
    confirmClassName,
    ariaLabel,
    autoResetMs,
    message,
    cancelLabel,
  } = props;
  const [armed, setArmed] = useState(false);
  const { pending } = useFormStatus();
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pathname = usePathname();

  // Disarms on the leading edge of any (re)navigation to this component's
  // route — including an Activity-preserved show/hide cycle, should
  // `cacheComponents: true` be re-enabled (its effects re-run on re-show the
  // same as a fresh mount even though local state survives). Never trust a
  // prior arm.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a trigger, not a value the effect body reads — any change re-arms the disarm, which is the point.
  useEffect(() => {
    setArmed(false);
  }, [pathname]);

  useEffect(() => {
    if (!armed || !autoResetMs) return;
    resetTimer.current = setTimeout(() => setArmed(false), autoResetMs);
    return () => clearTimeout(resetTimer.current);
  }, [armed, autoResetMs]);

  if (message !== undefined) {
    if (!armed) {
      return (
        <button
          type="button"
          onClick={() => setArmed(true)}
          className={triggerClassName}
          aria-label={ariaLabel}
        >
          {triggerLabel}
        </button>
      );
    }
    return (
      <div className="rounded-lg border border-border bg-surface-sunken p-4" role="alert">
        <p className="text-sm">{message}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <SubmitButton
            pendingLabel={pendingLabel}
            className={confirmClassName ?? triggerClassName}
          >
            {confirmLabel}
          </SubmitButton>
          <button
            type="button"
            onClick={() => setArmed(false)}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      // Only the confirm tap is a real submit — the arming tap must never
      // fire the form's action, so it stays a plain button until confirmed.
      type={armed ? "submit" : "button"}
      disabled={pending}
      aria-busy={pending}
      className={armed ? (confirmClassName ?? triggerClassName) : triggerClassName}
      aria-label={ariaLabel}
      onClick={(event) => {
        if (!armed) {
          event.preventDefault();
          setArmed(true);
        }
      }}
      onBlur={() => setArmed(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setArmed(false);
      }}
    >
      {pending ? pendingLabel : armed ? confirmLabel : triggerLabel}
    </button>
  );
}
