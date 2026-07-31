"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";

/**
 * Two-step, translated in-page confirmation for a destructive or
 * money-moving form submit. Replaces `window.confirm`, whose native dialog
 * (a) can't carry the shop's own locale — it's whatever the browser/OS
 * happens to be set to — and (b) can only show a fixed string, never a
 * value computed server-side (a refund preview, say).
 *
 * Must be rendered inside the `<form action={...}>` whose submit it guards.
 * Unarmed, it's a plain `type="button"` that never submits anything. A click
 * reveals `message` plus a real submit button (so `useFormStatus`-driven
 * pending state still works through `SubmitButton`) and a "never mind" that
 * only resets local state — no request is ever sent until the person
 * deliberately confirms a second time, and none is sent by backing out.
 *
 * Server-roundtrip pattern: the arm/disarm toggle is local state for
 * responsiveness, but nothing this component does is optimistic — the real
 * effect only happens on the server action the surrounding form already
 * posts to.
 */
export function InlineConfirm({
  message,
  triggerLabel,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  triggerClassName,
  confirmClassName,
  ariaLabel,
}: {
  /** Shown once armed — the refund/impact preview plus the "are you sure" line. */
  message: string;
  triggerLabel: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  pendingLabel: string;
  triggerClassName?: string;
  /** Defaults to `triggerClassName` — pass a distinct one when the confirm action should read differently (rare). */
  confirmClassName?: string;
  /** Distinct accessible name for the trigger when the visible label repeats elsewhere on the page. */
  ariaLabel?: string;
}) {
  const [armed, setArmed] = useState(false);

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
        <SubmitButton pendingLabel={pendingLabel} className={confirmClassName ?? triggerClassName}>
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
