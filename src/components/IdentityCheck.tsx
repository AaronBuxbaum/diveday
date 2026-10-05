import type { ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";

/** Words for {@link IdentityCheck}, resolved by the page (staff copy is server-side). */
export type IdentityCheckWords = {
  different: string;
  newNameLabel: string;
  split: string;
  splitting: string;
};

/**
 * **Both answers to a held seat's question** (H-13; Aaron, 2026-10-05: the
 * old row named the problem and offered one of its two answers).
 *
 * A seat flagged `identity_unconfirmed` was attached to an existing diver on a
 * guess, and its reason line already names the two people the guess was
 * between (`identityReasonText`). Under it sit the two answers: "Same person",
 * the attestation, passed in by the caller as a blocking confirm because each
 * door words and wires it differently; and "Different person", which splits
 * the seat off into a new diver of its own (`splitBookingIdentity`), named by
 * the staffer and prefilled with the name it was booked under.
 *
 * Nothing from the matched record is printed here: the flag gates disclosure
 * as well as boarding (security review 2026-09-11).
 */
export function IdentityCheck({
  bookingId,
  bookedAs,
  words,
  confirm,
  splitAction,
  className = "",
}: {
  bookingId: string;
  bookedAs: string | null;
  words: IdentityCheckWords;
  /** The "Same person" control: a form around an `InlineConfirm`. */
  confirm: ReactNode;
  splitAction: (formData: FormData) => void | Promise<void>;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-start gap-2 ${className}`} data-testid="identity-check">
      {confirm}
      <details className="group/split">
        <summary
          className={buttonClass({
            variant: "secondary",
            size: "sm",
            className: "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
          })}
        >
          {words.different}
        </summary>
        <form action={splitAction} className="mt-2 flex flex-col gap-3 sm:w-72">
          <input type="hidden" name="bookingId" value={bookingId} />
          <Field label={words.newNameLabel} markRequired={false}>
            <input
              name="fullName"
              required
              defaultValue={bookedAs ?? ""}
              autoComplete="off"
              className={controlClass}
            />
          </Field>
          <SubmitButton
            pendingLabel={words.splitting}
            className={buttonClass({ variant: "primary", size: "sm", className: "self-start" })}
          >
            {words.split}
          </SubmitButton>
        </form>
      </details>
    </div>
  );
}
