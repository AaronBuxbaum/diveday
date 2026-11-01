"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import { type ReactNode, useActionState, useEffect, useRef } from "react";

/** Whether a non-redirect action resolved or rejected; rejection does not reveal server outcome. */
type RowActionResult = { ok: true } | { ok: false } | null;

/**
 * A resolved action triggers a refresh. A rejected non-redirect action shows
 * an inline send failure and keeps the last server-rendered row and queue; the
 * server may already have changed state if its response was lost. The message
 * describes the failed send, not the mutation's outcome. Identity attestation
 * and check-in writes remain immediate; this form does not defer them.
 */
export function RowActionForm({
  action,
  sendFailedLabel,
  onSubmitting,
  className,
  sendFailedClassName = "mt-2 text-sm font-medium text-danger",
  children,
}: {
  /**
   * Any counter mutation. Its resolved value is ignored — what this form reads
   * is whether it resolved at all, so an action typed `Promise<void>` and one
   * returning `{ ok: true }` compose the same way.
   */
  action: (formData: FormData) => Promise<unknown>;
  /** Page-provided message that the send failed; it does not assert mutation outcome. */
  sendFailedLabel: string;
  /**
   * Called inside the action, before the await, for a caller holding optimistic
   * state of its own. `ArrivalTap` flips the row's tap here;
   * a two-step confirm has nothing to flip and passes nothing.
   */
  onSubmitting?: () => void;
  className?: string;
  /**
   * Where the failure line sits. The default suits a control with its own
   * margin; the row's check-in tap passes its own 8px of room, so the line
   * sits on the column the tap's words start on.
   */
  sendFailedClassName?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const scrollY = useRef(0);
  const [result, formAction] = useActionState<RowActionResult, FormData>(
    async (_previous, formData) => {
      onSubmitting?.();
      try {
        await action(formData);
        return { ok: true };
      } catch (error) {
        // Rethrow Next's redirect sentinel before reporting a failed send, so
        // a refused action does not show a contradictory transport message.
        unstable_rethrow(error);
        // Treat the remaining non-redirect rejection as a send failure; server
        // outcome may be unknown, so do not assert whether the mutation committed.
        return { ok: false };
      }
    },
    null,
  );

  useEffect(() => {
    if (!result?.ok) return;
    router.refresh();
    // Refresh is scroll-preserving in Next, and this explicit restoration also
    // covers the browsers that briefly reset the viewport while the server
    // component tree is replaced.
    window.requestAnimationFrame(() => window.scrollTo({ top: scrollY.current, behavior: "auto" }));
  }, [result, router]);

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={() => {
        scrollY.current = window.scrollY;
      }}
    >
      {children}
      {result?.ok === false ? (
        // Inside the form, under the control it belongs to — `role="alert"`
        // because the staffer's eyes are on the diver, not the screen, and this
        // is the one thing on the page that just changed.
        <p role="alert" className={sendFailedClassName}>
          {sendFailedLabel}
        </p>
      ) : null}
    </form>
  );
}
