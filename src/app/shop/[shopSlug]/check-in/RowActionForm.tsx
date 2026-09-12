"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import { type ReactNode, useActionState, useEffect, useRef } from "react";

/** What the row knows after a tap: it landed, or it did not send. */
type RowActionResult = { ok: true } | { ok: false } | null;

/**
 * **A failed mutation fails on its row, not on the page.** Take the counter
 * offline and tap one diver's Check in, and the whole segment used to be
 * replaced by the error boundary: the 26-diver queue, the four departure
 * groups, the scroll position and anything typed into the scan field, all
 * gone, in front of a diver standing at the desk (issue #819). Whole-page
 * recovery is the right default for a failed *render*; a failed mutation knows
 * which row it was about, and the page-level boundary cannot say which row.
 *
 * **And it never claims the act did or did not happen**, because the client
 * genuinely cannot know: a failed fetch cannot tell a request that never left
 * from one the server handled and could not answer. So the message is about
 * the *send*. The row's own state is left exactly as the server last rendered
 * it, which is the honest thing on screen while the staffer decides whether to
 * try again.
 *
 * **This is the mechanism, and it holds no opinion about the control.** It was
 * born inside `CheckInActionForm`, married to that surface's one-tap
 * `QueueRowButton`, which is why every other mutation on the counter row shipped
 * as a bare `<form action={…}>` and kept the hole #819 closed for the tap alone
 * (issue #1788). The two worst were on a blocked row: the identity confirm,
 * which is the row's *only* control because a blocked row is offered no
 * check-in tap, and the "Not here" script — both reached under exactly the
 * pressure that makes losing the queue expensive. Extracting the reducer was
 * the narrow fix. The wide one was teaching `InlineConfirm` a pending-and-failed
 * state, and it is shared with the trip roster's copy of the identity
 * attestation, so it would have changed a door nobody asked about.
 *
 * The service worker is not an answer here and is not meant to be: it returns
 * early for any non-GET (`src/worker/manifest-sw.ts`), and a deferred identity
 * attestation — one that lands after the diver has gone — is the wrong shape
 * for an act that hands over another person's certifications. Failing closed on
 * the row is right.
 */
export function RowActionForm({
  action,
  sendFailedLabel,
  onSubmitting,
  className,
  sendFailedClassName = "mt-2 text-sm font-medium text-danger-strong",
  children,
}: {
  /**
   * Any counter mutation. Its resolved value is ignored — what this form reads
   * is whether it resolved at all, so an action typed `Promise<void>` and one
   * returning `{ ok: true }` compose the same way.
   */
  action: (formData: FormData) => Promise<unknown>;
  /** What the row says when the send did not go through. Words come from the page. */
  sendFailedLabel: string;
  /**
   * Called inside the action, before the await, for a caller holding optimistic
   * state of its own. `CheckInActionForm` flips the row's trailing badge here;
   * a two-step confirm has nothing to flip and passes nothing.
   */
  onSubmitting?: () => void;
  className?: string;
  /**
   * Where the failure line sits. The default suits a control with its own
   * margin; the row's check-in tap passes the page's row padding so the tap's
   * picture is exactly what it was before this form was extracted from it.
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
        // **`unstable_rethrow` first, or the refusals lie.** Every action on
        // this surface ends its refusal paths in
        // `redirect(noticeUrl(…))`, and that sentinel reaches this catch on
        // the client too. Without the rethrow the navigation still happens —
        // Next handles it out of band — and the reducer *also* returns a
        // failure, so a refused check-in landed on its `?notice=` banner with
        // "That didn't send" underneath it: two contradictory answers to one
        // tap. Measured rather than assumed, after a comment here claimed the
        // opposite.
        //
        // This is the client-side face of what
        // `scripts/check-redirect-in-try.mjs` refuses on the server.
        unstable_rethrow(error);
        // What is left is the transport failing, which is the case this exists
        // for: the tap did not send.
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
