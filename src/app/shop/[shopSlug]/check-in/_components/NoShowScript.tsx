import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";

/**
 * **"Not here?" — the counter's script for the diver who never turned up**
 * (issue #1209).
 *
 * Two halves of one conversation, in one file because they are read in
 * sequence: the door a staffer opens while the boat is still at the dock, and
 * what the shop can do with the seat once they have closed it.
 *
 * Every string is a prop. This is a Server Component that holds no words at
 * all, the same shape `CheckInActionForm` and `PrintRecordButton` take on this
 * surface — the counter's copy is resolved once by the page, in the locale the
 * staffer's own device asked for (ADR 20260730-staff-copy-localization).
 *
 * **The door is a disclosure, and the confirm inside it is one tap.** Closed,
 * it is three words at the foot of an ordinary queue row, so the one-tap check
 * in above it stays the only large target — this surface is used with wet
 * hands on a shared desk tablet, and a second peer control beside that tap is
 * the mis-tap a previous slice spent its length removing. Open, it says what
 * the tap does and offers exactly one button. Never a two-tap dance and never
 * a `window.confirm`: the act is undoable, and a modal over a diver standing
 * at the desk buys nothing the Undo does not.
 *
 * **The word on screen is the plain one.** A released seat is "Not here" — not
 * archived, not deactivated, not "released" — because the fact a staffer is
 * recording is that a person did not arrive (ADR 20260820-every-delete-is-soft's
 * second half: the record is soft, the word is not).
 */

export type NoShowScriptCopy = {
  /** The closed disclosure: three words, no promise. */
  door: string;
  /** What the confirm does, in one sentence, including that it can be undone. */
  consequence: string;
  confirm: string;
  confirming: string;
  /** Names the diver — one row's confirm must not read like every other row's. */
  confirmAriaLabel: string;
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
    // Native `<details>`, the one disclosure spelling this surface already
    // speaks (`BlockedDiverRow`'s reasons, `LedgerGroup folded`): keyboard and
    // screen-reader behaviour for free, and no client component for a thing
    // that is a triangle.
    <details className="group/no-show px-4 pb-3 sm:px-5">
      <summary className="-mx-2 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted transition-colors select-none [&::-webkit-details-marker]:hidden hover:bg-surface-sunken">
        <DisclosureCaret className="group-open/no-show:rotate-90" />
        {copy.door}
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-3 ps-5">
        <p className="min-w-0 text-sm text-muted">{copy.consequence}</p>
        <form action={action}>
          <input type="hidden" name="bookingId" value={bookingId} />
          <SubmitButton
            pendingLabel={copy.confirming}
            ariaLabel={copy.confirmAriaLabel}
            observabilityAction="mark_no_show"
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {copy.confirm}
          </SubmitButton>
        </form>
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
  links: readonly { href: string; label: string }[];
  /**
   * **The money, as a sentence.** What happens to the fare is a decision a
   * person makes on the shop's own terms — a refund, a credit, a regular the
   * owner waves through — so the counter says where that decision lives and
   * stops. There is no charge control and no refund control anywhere in this
   * tree, and `NoShowScript.test.tsx` asserts it rather than trusting this
   * paragraph.
   */
  money: { line: string; href: string; label: string };
};

export function NoShowSalvage({ copy }: { copy: NoShowSalvageCopy }) {
  return (
    <div className="px-4 pb-3 text-sm sm:px-5">
      <p className="text-muted">{copy.line}</p>
      {copy.links.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-x-4">
          {copy.links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={`${tapTargetLinkClass} font-medium text-primary hover:underline`}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-muted">
        {copy.money.line}{" "}
        <Link
          href={copy.money.href}
          className={`${tapTargetLinkClass} font-medium text-primary hover:underline`}
        >
          {copy.money.label}
        </Link>
      </p>
    </div>
  );
}
