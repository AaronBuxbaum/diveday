import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { GroupLabel } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { RosterEntry } from "./types";

/** Hotel pickup / lodging details, with the form that sets them. */
export function SeatPickup({
  booking,
  t,
  updatePickupAction,
}: {
  booking: RosterEntry["booking"];
  t: StaffTranslator;
  updatePickupAction?: (bookingId: string, formData: FormData) => void;
}) {
  return (
    <div>
      <GroupLabel as="p">{t("trips.roster.hotelPickupHeading")}</GroupLabel>
      {booking.hotelPickupLocation || booking.pickupTime ? (
        <p className="mt-1 text-sm text-muted">
          {booking.hotelPickupLocation ?? t("trips.roster.hotelNotSpecified")}
          {booking.pickupTime ? ` · ${booking.pickupTime}` : ""}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">{t("trips.roster.noPickupScheduled")}</p>
      )}
      {updatePickupAction ? (
        <CompactDisclosureRow
          className="mt-1"
          bodyClassName="mt-0"
          label={
            booking.hotelPickupLocation || booking.pickupTime
              ? t("trips.roster.editPickup")
              : t("trips.roster.setPickup")
          }
        >
          <form
            action={updatePickupAction.bind(null, booking.id)}
            className="mt-2 flex max-w-md flex-col gap-2 rounded-lg border border-border bg-surface-sunken/50 p-2"
          >
            <FieldGrid columns={2}>
              <Field label={t("trips.roster.pickupLocationLabel")}>
                <input
                  name="hotelPickupLocation"
                  maxLength={300}
                  defaultValue={booking.hotelPickupLocation ?? ""}
                  placeholder={t("trips.roster.pickupLocationPlaceholder")}
                  className={controlClass}
                />
              </Field>
              <Field label={t("trips.roster.pickupTimeLabel")}>
                <input
                  name="pickupTime"
                  maxLength={20}
                  defaultValue={booking.pickupTime ?? ""}
                  placeholder="07:15"
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
            <div>
              <SubmitButton
                pendingLabel={t("trips.roster.saving")}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("trips.roster.savePickup")}
              </SubmitButton>
            </div>
          </form>
        </CompactDisclosureRow>
      ) : null}
    </div>
  );
}
