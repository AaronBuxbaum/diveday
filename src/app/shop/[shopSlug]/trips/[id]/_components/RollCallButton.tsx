"use client";

import { type ReactNode, useActionState, useEffect } from "react";

/**
 * The result a roll-call server action returns instead of redirecting, so the
 * card can settle in place. `not_ready` is the server's fail-closed refusal —
 * readiness is re-checked on the server at board time and can always win.
 */
export type RollCallResult = { ok: true } | { ok: false; reason: "not_ready" | "error" } | null;

export type RollCallAction = (prev: RollCallResult, formData: FormData) => Promise<RollCallResult>;

/**
 * Every word this client component renders, resolved on the server — see the
 * note in src/i18n/staff-messages.ts. Pure text-source extraction: none of the
 * control flow, gating, or roll-call logic below changed.
 *
 * `blockedMessage` is pre-rendered JSX rather than a string: the "not ready"
 * refusal embeds one rich element (the "Open Guests" link to the specific
 * booking), and a translated sentence cannot correctly be reassembled here
 * from separate prefix/link/suffix string fragments — the composed-string
 * rule this codebase's i18n work follows. Passing already-rendered JSX
 * (built with `t.rich` in the Server Component caller) across the boundary is
 * fine; only a function/closure crossing it is not.
 */
export type RollCallButtonCopy = {
  errorRefusal: string;
  blockedMessage: ReactNode;
};

/**
 * A boarding control with an instant *pending* state. Tapping shows "Boarding…"
 * within a frame — never the confirmed ✓, which only ever appears when the
 * server re-renders this card as boarded. A server refusal rolls the card back
 * and shows the worded reason in place. This is the safety line for WP-6:
 * pending is a client hint; confirmed is server-authoritative.
 *
 * Without JavaScript the form still posts and the card settles from the
 * server; only the in-flight "Boarding…" hint needs JS.
 *
 * `result` lives in `useActionState`, which exposes no external setter to
 * clear it on demand. The checkpoint switcher (manifest/page.tsx's
 * `?checkpoint=` links, `scroll={false}`) reuses the same route/key across
 * checkpoints, so if `cacheComponents: true`'s Activity-based navigation is
 * ever re-enabled, a stale refusal from one checkpoint could otherwise
 * survive and misattribute to another (docs ADR
 * 20260801-cache-components-activity-state, currently reverted, commit
 * 100fcf8). The caller must render this with `key={checkpoint}` (or a key
 * that includes it) so switching checkpoints fully remounts the button —
 * and its `useActionState` — rather than carrying a prior checkpoint's
 * `result` forward.
 */
export function RollCallButton({
  action,
  bookingId,
  status,
  label,
  pendingLabel,
  className,
  formId,
  copy,
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
  copy: RollCallButtonCopy;
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
          {result.reason === "not_ready" ? copy.blockedMessage : copy.errorRefusal}
        </p>
      ) : null}
    </>
  );
}
