"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { KIOSK_INPUT_MAX } from "@/lib/kiosk-check-in";
import { kioskCheckInAction } from "../actions";
import { IDLE_KIOSK_RESULT, type KioskCopy, type KioskResult } from "../kiosk-types";

/**
 * How long an answer stays on the glass before the tablet asks the next person.
 *
 * This is a privacy control as much as a courtesy: the screen names a diver, it
 * stands unattended in a lobby, and the next person to walk up must not read the
 * last one's answer. Long enough to read three lines twice, short enough that
 * nobody walks away and leaves a name on a wall.
 */
const CLEAR_AFTER_MS = 12_000;

function CheckInButton({ copy }: { copy: KioskCopy }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClass({ size: "boat", busy: true, className: "text-[1.25rem]" })}
    >
      {pending ? copy.submitting : copy.submit}
    </button>
  );
}

/**
 * **Self check-in at the counter** (N-24): one box, one answer, and a screen
 * that forgets.
 *
 * The answer lives here in `useActionState` and nowhere else — not in the URL,
 * not in history, not on a bookmark — because this tablet is shared. It clears
 * itself after {@link CLEAR_AFTER_MS}, emptying the box and putting the cursor
 * back in it, so the next diver walks up to a blank prompt.
 *
 * Every word arrives as a prop or inside the action's own result: the diver
 * bundle never ships to this page, and nothing here decides what to say about a
 * booking.
 */
export function KioskConsole({ token, copy }: { token: string; copy: KioskCopy }) {
  const [result, formAction] = useActionState<KioskResult, FormData>(
    kioskCheckInAction.bind(null, token),
    IDLE_KIOSK_RESULT,
  );
  /**
   * What is on the glass, which trails the action's own answer by up to
   * `CLEAR_AFTER_MS`. Separate state rather than a `hidden` flag so the panel
   * has exactly one source, and so re-submitting the same answer twice still
   * restarts the countdown.
   */
  const [shown, setShown] = useState<KioskResult>(IDLE_KIOSK_RESULT);
  const inputId = useId();
  const form = useRef<HTMLFormElement>(null);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setShown(result);
    if (result.status === "idle") return;
    const timer = setTimeout(() => {
      setShown(IDLE_KIOSK_RESULT);
      form.current?.reset();
      box.current?.focus();
    }, CLEAR_AFTER_MS);
    return () => clearTimeout(timer);
  }, [result]);

  return (
    <>
      <form ref={form} action={formAction} className="mt-8 grid gap-4">
        <label htmlFor={inputId} className="text-[1.5rem] leading-tight font-medium">
          {copy.prompt}
        </label>
        <input
          ref={box}
          id={inputId}
          name="who"
          type="text"
          required
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={KIOSK_INPUT_MAX}
          className={`${controlClass} min-h-16 text-[1.5rem]`}
        />
        <div>
          <CheckInButton copy={copy} />
        </div>
      </form>

      {shown.status === "idle" ? null : (
        <div
          role="status"
          className={`mt-8 rounded-panel border p-6 ${
            shown.status === "ready"
              ? "border-success/30 bg-success/10"
              : "border-warning/30 bg-warning/10"
          }`}
        >
          <p className="text-[2rem] leading-tight font-bold text-balance">{shown.heading}</p>
          {shown.status === "ready" ? (
            shown.lines.map((line) => (
              <p key={line} className="mt-2 text-[1.5rem] leading-tight">
                {line}
              </p>
            ))
          ) : (
            <p className="mt-2 text-[1.5rem] leading-tight">{shown.body}</p>
          )}
        </div>
      )}
    </>
  );
}
