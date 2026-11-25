import Link from "next/link";
import type { ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { RowActionForm } from "./RowActionForm";

/**
 * Recording a diver as not here, from the opened guest's "Not here" (its
 * More menu): the confirm is explicit, undoable, and names the diver
 * accessibly. Rebooking and seat-salvage precedence is
 * resolved upstream (`src/lib/no-show.ts`, `src/features/boarding/no-show.ts`); fare decisions
 * are described in copy, with no charge or refund action here. ADR
 * 20260730-staff-copy-localization covers page-resolved staff copy.
 */

export type NoShowScriptCopy = {
  /** The closed disclosure: two words, no promise and no question mark. */
  door: string;
  /** What the confirm does, in one sentence, including that it can be undone. */
  consequence: string;
  confirm: string;
  confirming: string;
  /** Names the diver — one row's confirm must not read like every other row's. */
  confirmAriaLabel: string;
  /**
   * What this script says when the send did not go through. A failed release
   * used to replace the whole counter with the error boundary (issue #1788):
   * the script is reached at the desk with the diver's seat in the balance, and
   * the queue behind it is the last thing a staffer can afford to lose.
   */
  sendFailed: string;
};

/**
 * The confirm itself: what the tap records, and the one button, as the opened
 * guest's sheet (its More menu), with "Never mind" beside it as every sheet has.
 */
export function NoShowConfirm({
  action,
  bookingId,
  copy,
  dismiss,
}: {
  action: (formData: FormData) => Promise<void>;
  bookingId: string;
  copy: Omit<NoShowScriptCopy, "door">;
  /** "Never mind", beside the confirm as on every sheet of the opened guest. */
  dismiss?: ReactNode;
}) {
  return (
    <RowActionForm action={action} sendFailedLabel={copy.sendFailed}>
      <input type="hidden" name="bookingId" value={bookingId} />
      <div className="space-y-3">
        <p className="text-sm">{copy.consequence}</p>
        <div className="flex flex-wrap gap-3">
          <SubmitButton
            pendingLabel={copy.confirming}
            ariaLabel={copy.confirmAriaLabel}
            observabilityAction="mark_no_show"
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {copy.confirm}
          </SubmitButton>
          {dismiss}
        </div>
      </div>
    </RowActionForm>
  );
}

/**
 * What the shop can still do once the seat is released, already worded.
 *
 * The precedence — wait list, then a rebooking for the diver who missed, then
 * nothing — is decided in `src/lib/no-show.ts` and read in `src/features/boarding/no-show.ts`;
 * `salvage-copy.ts` turns it into these strings a layer up, where the
 * translator and the shop's timezone both are.
 */
export type NoShowSalvageCopy = {
  /**
   * One line naming the offer **and who it is for**: the divers waiting for
   * this seat, or the diver, by name, the shop can put on another day.
   */
  line: string;
  /** Where to act on it. At most two — the wait list, or two days to seat them on. */
  links: readonly {
    href: string;
    label: string;
    /**
     * The same day, sent to the diver instead of seated by the desk (UX review
     * 2026-10-11, item 14): the departure the button invites them to, and the
     * button's name for a screen reader, which names the diver and the day.
     */
    offer?: { tripId: string; ariaLabel: string };
  }[];
  /** The send button's words and whom it sends to; present only on the rebooking offer. */
  offerCopy?: { personId: string; label: string; pending: string; sendFailed: string };
  /** Fare handling is copy and a link only; there is no charge or refund control. */
  money: { line: string; href?: string; label?: string };
};

export function NoShowSalvage({
  copy,
  offerAction,
}: {
  copy: NoShowSalvageCopy;
  /** Sends a rebooking offer to the diver; absent, the panel only links to seating them. */
  offerAction?: (formData: FormData) => Promise<void>;
}) {
  const offerCopy = copy.offerCopy;
  return (
    <div className="pb-3 text-sm">
      <p className="text-muted">{copy.line}</p>
      {copy.links.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-1">
          {copy.links.map((link) => (
            <li key={link.href} className="flex flex-wrap items-center gap-x-4">
              <Link
                href={link.href}
                className={`${tapTargetLinkClass} font-medium text-primary hover:underline`}
              >
                {link.label}
              </Link>
              {/* The diver books from the offer; the desk does not seat them. */}
              {link.offer && offerAction && offerCopy ? (
                <RowActionForm action={offerAction} sendFailedLabel={offerCopy.sendFailed}>
                  <input type="hidden" name="offerTripId" value={link.offer.tripId} />
                  <input type="hidden" name="personId" value={offerCopy.personId} />
                  <SubmitButton
                    pendingLabel={offerCopy.pending}
                    ariaLabel={link.offer.ariaLabel}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    {offerCopy.label}
                  </SubmitButton>
                </RowActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-muted">
        {copy.money.line}
        {copy.money.href && copy.money.label ? (
          <>
            {" "}
            <Link
              href={copy.money.href}
              className={`${tapTargetLinkClass} font-medium text-primary hover:underline`}
            >
              {copy.money.label}
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}
