import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { RowActionForm } from "./RowActionForm";

/**
 * Localized native disclosure for recording a diver as not here. Its closed
 * label is the factual "Not here"; confirmation is explicit, undoable, and
 * names the diver accessibly. Rebooking and seat-salvage precedence is
 * resolved upstream (`src/lib/no-show.ts`, `src/db/no-show.ts`); fare decisions
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

export function NoShowScript({
  action,
  bookingId,
  copy,
}: {
  action: (formData: FormData) => Promise<void>;
  bookingId: string;
  copy: NoShowScriptCopy;
}) {
  return (
    // Native <details> supplies keyboard and screen-reader disclosure
    // semantics. The row stays quiet when closed; open, it shows the
    // consequence and one confirmation.
    <details className="group/no-show pb-2">
      <summary
        className={buttonClass({
          variant: "ghost",
          size: "sm",
          flush: true,
          className: "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        })}
      >
        {copy.door}
      </summary>
      {/* **The confirm ends on the row's edge** (K-253), where the row's own
          Check in ends: the sentence grows from its own width and the line
          packs to its end, so the button stands at the end beside the
          sentence, or under it once the two do not share a line. `grow`, not
          `flex-1`, whose zero basis never wraps and squeezed the sentence into
          a narrow column beside the button on a phone. */}
      <div className="mt-1 flex flex-wrap items-center justify-end gap-3 rounded-lg bg-surface-sunken p-3">
        <p className="min-w-0 grow text-sm text-muted">{copy.consequence}</p>
        <RowActionForm action={action} sendFailedLabel={copy.sendFailed}>
          <input type="hidden" name="bookingId" value={bookingId} />
          <SubmitButton
            pendingLabel={copy.confirming}
            ariaLabel={copy.confirmAriaLabel}
            observabilityAction="mark_no_show"
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {copy.confirm}
          </SubmitButton>
        </RowActionForm>
      </div>
    </details>
  );
}

/**
 * What the shop can still do once the seat is released, already worded.
 *
 * The precedence — wait list, then a rebooking for the diver who missed, then
 * nothing — is decided in `src/lib/no-show.ts` and read in `src/db/no-show.ts`;
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
