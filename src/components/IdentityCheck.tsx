import type { ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceRow, controlClass, DateField, Field, FieldGrid } from "@/components/ui/form";

/** Words for {@link IdentityCheck}, resolved by the page (staff copy is server-side). */
export type IdentityCheckWords = {
  different: string;
  newNameLabel: string;
  dateOfBirthLabel: string;
  emailLabel: string;
  phoneLabel: string;
  optional: string;
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
 * The split also takes who the new diver is (issue #2081): a date of birth,
 * required on a course with a minimum age because the age check and the
 * guardian rule both read it and fail open without it, and an optional email
 * or phone so the shop can send their own waiver. When other held seats were
 * booked under the same name and matched to the same diver, one box moves
 * them all onto the one new record.
 *
 * Nothing from the matched record is printed here: the flag gates disclosure
 * as well as boarding (security review 2026-09-11). Every field starts empty
 * but the name, which is what the seat was booked under.
 */
export function IdentityCheck({
  bookingId,
  bookedAs,
  words,
  confirm,
  splitAction,
  asksDateOfBirth,
  maxDateOfBirth,
  sameNameSeatsLabel,
  className = "",
}: {
  bookingId: string;
  bookedAs: string | null;
  words: IdentityCheckWords;
  /** The "Same person" control: a form around an `InlineConfirm`. */
  confirm: ReactNode;
  splitAction: (formData: FormData) => void | Promise<void>;
  /** The departure is a course with a minimum age: the date is required. */
  asksDateOfBirth: boolean;
  /** `maxPlausibleBirthDate()`, so the browser refuses a future date first. */
  maxDateOfBirth: string;
  /**
   * "Also move their 2 other held seats booked as …", when there are any.
   * Absent, no box is drawn: there is nothing else to move.
   */
  sameNameSeatsLabel?: string;
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
        <form action={splitAction} className="mt-2 flex flex-col gap-3 sm:w-96">
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
          <Field label={words.dateOfBirthLabel} hint={asksDateOfBirth ? undefined : words.optional}>
            <DateField name="dateOfBirth" required={asksDateOfBirth} max={maxDateOfBirth} />
          </Field>
          <FieldGrid columns={2}>
            <Field label={words.emailLabel} hint={words.optional}>
              <input
                name="email"
                type="email"
                autoComplete="off"
                inputMode="email"
                className={controlClass}
              />
            </Field>
            <Field label={words.phoneLabel} hint={words.optional}>
              <input
                name="phone"
                type="tel"
                autoComplete="off"
                inputMode="tel"
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          {sameNameSeatsLabel ? (
            <ChoiceRow type="checkbox" name="includeSameNameSeats" value="on" defaultChecked>
              {sameNameSeatsLabel}
            </ChoiceRow>
          ) : null}
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
