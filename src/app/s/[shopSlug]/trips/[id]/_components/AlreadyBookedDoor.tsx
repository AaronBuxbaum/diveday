"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { type FindMyBookingFormState, requestFindMyBookingAction } from "../../../actions";

const INITIAL_STATE: FindMyBookingFormState = {};

/**
 * **The door on "You're already on this trip's list"** (UX review 2026-10-11,
 * item 8). The refusal is right, and on its own it was a wall: the repeat
 * diver most likely to hit it is the one who lost the email. One tap sends
 * their link again, through the same "Can't find your link?" action the
 * schedule offers, so it mails only the address on file and answers the same
 * whether or not that address holds a booking. The second line says where a
 * second seat comes from: the diver's own page, which can add one.
 *
 * Its own form, below the booking form rather than inside it: forms do not
 * nest, and this one posts a different action.
 */
export function AlreadyBookedDoor({ shopSlug, email }: { shopSlug: string; email: string }) {
  const t = useTranslations();
  const [state, formAction] = useActionState(
    requestFindMyBookingAction.bind(null, shopSlug),
    INITIAL_STATE,
  );
  return (
    <div className="mt-3 space-y-3">
      {state.success ? (
        <p role="status" className="text-sm text-muted">
          {t("findMyBooking.sentBody")}
        </p>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="email" value={email} />
          <SubmitButton
            pendingLabel={t("findMyBooking.submitting")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("booking.alreadyDoor.sendLink")}
          </SubmitButton>
        </form>
      )}
      <p className="text-sm text-muted">{t("booking.alreadyDoor.addSeat")}</p>
    </div>
  );
}
