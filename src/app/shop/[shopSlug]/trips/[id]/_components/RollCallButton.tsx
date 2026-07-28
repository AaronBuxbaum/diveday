"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";

/**
 * The result a roll-call server action returns instead of redirecting, so the
 * card can settle in place. `not_ready` is the server's fail-closed refusal —
 * readiness is re-checked on the server at board time and can always win.
 */
export type RollCallResult = { ok: true } | { ok: false; reason: "not_ready" | "error" } | null;

export type RollCallAction = (prev: RollCallResult, formData: FormData) => Promise<RollCallResult>;

const ERROR_REFUSAL = "That didn’t save. Recheck your connection or tap again.";

/**
 * A boarding control with an instant *pending* state. Tapping shows "Boarding…"
 * within a frame — never the confirmed ✓, which only ever appears when the
 * server re-renders this card as boarded. A server refusal rolls the card back
 * and shows the worded reason in place. This is the safety line for WP-6:
 * pending is a client hint; confirmed is server-authoritative.
 *
 * Without JavaScript the form still posts and the card settles from the
 * server; only the in-flight "Boarding…" hint needs JS.
 */
export function RollCallButton({
  action,
  bookingId,
  status,
  label,
  pendingLabel,
  className,
  formId,
  guestsHref,
}: {
  action: RollCallAction;
  bookingId: string;
  status: string;
  label: string;
  pendingLabel: string;
  className: string;
  /**
   * Form id, so an external field (a drafted roll-call note that has no result
   * to auto-save to yet) can ride this submit via its `form=` attribute.
   */
  formId?: string;
  /** The actual staff control for resolving a readiness refusal. */
  guestsHref?: string;
}) {
  const [result, formAction, isPending] = useActionState(action, null);

  useEffect(() => {
    if (result) {
      if (typeof window !== "undefined" && "vibrate" in navigator) {
        try {
          if (result.ok) {
            navigator.vibrate(10);
          } else {
            navigator.vibrate([40, 40, 40]);
          }
        } catch {
          // Ignore vibration exceptions (e.g. from security policies)
        }
      }
    }
  }, [result]);
  return (
    <>
      <form action={formAction} id={formId}>
        <input type="hidden" name="bookingId" value={bookingId} />
        <input type="hidden" name="status" value={status} />
        <button type="submit" disabled={isPending} aria-busy={isPending} className={className}>
          {isPending ? pendingLabel : label}
        </button>
      </form>
      {result && !result.ok ? (
        <p role="alert" className="mt-1 text-sm font-medium text-danger sm:basis-full">
          {result.reason === "not_ready" ? (
            guestsHref ? (
              <>
                Diver is still blocked.{" "}
                <Link href={guestsHref}>Open Guests to resolve the blocker</Link>, then try again.
              </>
            ) : (
              "Diver is still blocked. Open Guests to resolve the blocker, then try again."
            )
          ) : (
            ERROR_REFUSAL
          )}
        </p>
      ) : null}
    </>
  );
}
