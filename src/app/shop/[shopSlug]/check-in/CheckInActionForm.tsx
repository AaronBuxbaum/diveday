"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import { useActionState, useEffect, useOptimistic, useRef } from "react";
import { QueueRowButton } from "./QueueRowButton";

type CheckInAction = (formData: FormData) => Promise<{ ok: true }>;

/** What the row knows after a tap: it landed, or it did not send. */
type CheckInFormResult = { ok: true } | { ok: false } | null;

/**
 * Check-in is a high-frequency toggle, so a successful write refreshes the
 * server-rendered row in place. Keeping the action inside a client form with
 * `useOptimistic` lets the row respond instantaneously on tap (Principle 1),
 * while Next refreshes the data without redirecting the document to the top
 * of the queue.
 *
 * **Counter check-in is optimistic; roll call is strictly non-optimistic.**
 * At the front desk, counter check-in satisfies all three conditions of
 * Principle 1: it is reversible (has undo), it is local to this staff screen,
 * and it is high frequency. On the boat, roll call is non-optimistic: marking
 * a diver aboard without confirmed server/store commit is how a boat sails with
 * a ghost count.
 *
 * **A failed tap fails on its row, not on the page.** Take the counter offline
 * and tap one diver's Check in, and the whole segment used to be replaced by
 * the error boundary: the 26-diver queue, the four departure groups, the scroll
 * position and anything typed into the scan field, all gone, in front of a
 * diver standing at the desk (issue #819). Whole-page recovery is the right
 * default for a failed *render*; a failed mutation knows which row it was
 * about, and the page-level boundary cannot say which row.
 *
 * **And it never claims the check-in did or did not happen**, because the
 * client genuinely cannot know: a failed fetch cannot tell a request that never
 * left from one the server handled and could not answer. So the message is
 * about the *tap*. The row's own state is left exactly as the server last
 * rendered it, which is the honest thing on screen while the staffer decides
 * whether to tap again.
 */
export function CheckInActionForm({
  action,
  bookingId,
  sendFailedLabel,
  ariaLabel,
  trailing,
  pendingTrailing,
  className,
  children,
}: {
  action: CheckInAction;
  bookingId: string;
  /** What the row says when the tap did not send. Words come from the page. */
  sendFailedLabel: string;
  ariaLabel: string;
  trailing: React.ReactNode;
  pendingTrailing: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const scrollY = useRef(0);
  const [optimisticTrailing, setOptimisticTrailing] = useOptimistic(
    trailing,
    (_current, update: React.ReactNode) => update,
  );
  const [result, formAction] = useActionState<CheckInFormResult, FormData>(
    async (_previous, formData) => {
      setOptimisticTrailing(pendingTrailing);
      try {
        return await action(formData);
      } catch (error) {
        // **`unstable_rethrow` first, or the refusals lie.** `checkInAction`
        // ends its refusal paths in `redirect(noticeUrl(…, "not-ready"))`, and
        // that sentinel reaches this catch on the client too. Without the
        // rethrow the navigation still happens — Next handles it out of band —
        // and the reducer *also* returns a failure, so a refused check-in
        // landed on its `?notice=` banner with "That didn't send" underneath
        // it: two contradictory answers to one tap. Measured rather than
        // assumed, after a comment here claimed the opposite.
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
      onSubmit={() => {
        scrollY.current = window.scrollY;
      }}
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <QueueRowButton
        ariaLabel={ariaLabel}
        className={className}
        trailing={optimisticTrailing}
        pendingTrailing={pendingTrailing}
      >
        {children}
      </QueueRowButton>
      {result?.ok === false ? (
        // Inside the form, under the row it belongs to — `role="alert"` because
        // the staffer's eyes are on the diver, not the screen, and this is the
        // one thing on the page that just changed.
        <p role="alert" className="px-4 pb-3 text-sm font-medium text-danger-strong sm:px-5">
          {sendFailedLabel}
        </p>
      ) : null}
    </form>
  );
}
