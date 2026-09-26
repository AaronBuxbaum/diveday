"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { SubmitButton } from "@/components/SubmitButton";
import { type ButtonSize, buttonClass } from "@/components/ui/button";

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
  /** Hidden values submitted only after the armed confirmation tap. */
  confirmFields?: Record<string, string>;
  /**
   * The action the confirm posts to, when it is not the surrounding form's:
   * a row's Delete sitting in that row's edit form, beside its Save. Set on
   * the armed confirm only, with `formNoValidate`, so a half-typed edit never
   * blocks the delete; the row's hidden id travels with it. Unarmed, the
   * trigger stays a plain button carrying no action at all.
   */
  formAction?: (formData: FormData) => void | Promise<void>;
};

type MessageModeProps = SharedProps & {
  /** Shown once armed — the refund/impact preview plus the "are you sure" line. Its presence is what selects this full shape over the compact one. */
  message: string;
  cancelLabel: string;
  /**
   * The size the armed block's Cancel is drawn at, which should be the size
   * of the confirm beside it: one size per row. `sm`, the default, is a list
   * row's; a row of `md` controls passes `md` (kinds of day).
   */
  size?: ButtonSize;
};

type CompactModeProps = SharedProps & {
  message?: undefined;
  cancelLabel?: undefined;
  /** No Cancel to size: the trigger is the whole control. */
  size?: undefined;
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
 * Must be rendered inside the `<form action={...}>` whose submit it guards —
 * or, given `formAction`, inside another action's form, whose fields it then
 * shares: a row's Delete in the row's edit form, on one line with its Save
 * (kinds of day, seasons, boats), where a form of its own had pushed it onto
 * a line by itself.
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
    confirmFields,
    formAction,
    message,
    cancelLabel,
    size = "sm",
  } = props;
  const [armed, setArmed] = useState(false);
  // In another action's form, only this action's submit is this control's:
  // a Save beside it must not read as "Deleting…".
  const status = useFormStatus();
  const pending = status.pending && (formAction === undefined || status.action === formAction);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasPending = useRef(false);
  const restoreFocus = useRef(false);

  // Disarm once the submit this guarded has landed. Without it the confirm
  // block just sits there re-asking a question that has already been answered
  // — on the roster's waiver resend, the send went out and the control stayed
  // open on "Send Ana a new waiver link?" instead of settling back to the
  // status pill, which reads as a tap that did nothing.
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    restoreFocus.current = true;
    setArmed(false);
  }, [pending]);

  // ...and put focus back where the person left it. The confirm button they
  // just pressed is unmounted by that disarm, which drops focus to `<body>`;
  // `preventScroll` keeps a long staff list from lurching as focus moves.
  // Runs in its own effect because the trigger only exists after the disarm
  // has rendered.
  useEffect(() => {
    if (armed || !restoreFocus.current) return;
    restoreFocus.current = false;
    triggerRef.current?.focus({ preventScroll: true });
  }, [armed]);

  // Disarms on the leading edge of any (re)navigation to this component's
  // route — including an Activity-preserved show/hide cycle, should
  // `cacheComponents: true` be re-enabled (its effects re-run on re-show the
  // same as a fresh mount even though local state survives). Never trust a
  // prior arm.
  //
  // The genuine first mount is exempt: effects run only once hydration
  // completes, but selective hydration makes the trigger tappable earlier, so
  // on a slow connection this effect's initial run could land *after* a
  // person armed the confirm and silently disarm it under their thumb (the
  // same race snapped ScheduleBuilder's remove panel shut on CI). A ref
  // survives the Activity hide/re-show that re-runs effects, so every
  // re-show still disarms — only the first mount, where `armed` is
  // necessarily fresh, is skipped.
  const pathnameEffectRan = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a trigger, not a value the effect body reads — any change re-arms the disarm, which is the point.
  useEffect(() => {
    if (!pathnameEffectRan.current) {
      pathnameEffectRan.current = true;
      return;
    }
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
          ref={triggerRef}
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
      <div className="rise-in rounded-lg border border-border bg-surface-sunken p-4" role="alert">
        <p className="text-sm">{message}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {Object.entries(confirmFields ?? {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <SubmitButton
            pendingLabel={pendingLabel}
            className={confirmClassName ?? triggerClassName}
            formAction={formAction}
            formNoValidate={formAction !== undefined || undefined}
          >
            {confirmLabel}
          </SubmitButton>
          <button
            type="button"
            onClick={() => setArmed(false)}
            className={buttonClass({ variant: "secondary", size })}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {armed
        ? Object.entries(confirmFields ?? {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))
        : null}
      <button
        ref={triggerRef}
        // Only the confirm tap is a real submit — the arming tap must never
        // fire the form's action, so it stays a plain button until confirmed.
        type={armed ? "submit" : "button"}
        // Only on the armed submit: a `formaction` on a plain button means
        // nothing, and React warns about one.
        formAction={armed ? formAction : undefined}
        formNoValidate={(armed && formAction !== undefined) || undefined}
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
    </>
  );
}
