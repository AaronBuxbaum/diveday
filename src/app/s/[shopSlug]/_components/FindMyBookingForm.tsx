"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DisclosureRow, DisclosureRowMessage } from "@/components/ui/disclosure";
import { controlClass, Field } from "@/components/ui/form";
import { type FindMyBookingFormState, requestFindMyBookingAction } from "../actions";

const INITIAL_STATE: FindMyBookingFormState = {};

/**
 * "Can't find your link?" (issue #723) — the way back for a diver whose
 * confirmation email went to spam, was mistyped, or was never read before
 * checking out of the hotel. One row of the schedule's group of asks
 * (`DisclosureRowList`), collapsed like its siblings: it exists for the diver
 * who needs it, not as a competing call to action for the diver who does not.
 *
 * `requestFindMyBookingAction` answers with the identical `{ success: true }`
 * whether or not the address has a booking here — see its own doc comment.
 * This component has no error state to render for exactly that reason.
 */
export function FindMyBookingForm({ shopSlug }: { shopSlug: string }) {
  const t = useTranslations();
  const [state, formAction] = useActionState(
    requestFindMyBookingAction.bind(null, shopSlug),
    INITIAL_STATE,
  );

  if (state.success) {
    return (
      <DisclosureRowMessage id="find-my-booking" heading={t("findMyBooking.sentHeading")}>
        {t("findMyBooking.sentBody")}
      </DisclosureRowMessage>
    );
  }

  return (
    <DisclosureRow id="find-my-booking" heading={t("findMyBooking.heading")}>
      <p className="text-sm text-muted">{t("findMyBooking.body")}</p>
      <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3">
        <Field label={t("common.email")} className="min-w-64 flex-1">
          <input
            name="email"
            type="email"
            required
            maxLength={200}
            inputMode="email"
            autoComplete="email"
            className={controlClass}
          />
        </Field>
        <SubmitButton
          pendingLabel={t("findMyBooking.submitting")}
          className={buttonClass({ variant: "secondary", className: "px-5 py-2.5" })}
        >
          {t("findMyBooking.submit")}
        </SubmitButton>
      </form>
    </DisclosureRow>
  );
}
