import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { GroupLabel } from "@/components/ui/group-label";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { GuestFact } from "./GuestFact";
import type { RosterEntry } from "./types";

/**
 * Hotel pickup / lodging details, with the form that sets them. While the shop
 * does not offer hotel pickups (the Features page) the roster passes no
 * action: the form goes, but a pickup a seat already holds is still said,
 * because the crew still has to collect that diver. A seat with none says
 * nothing.
 */
export function SeatPickup({
  booking,
  t,
  updatePickupAction,
  row = false,
}: {
  booking: RosterEntry["booking"];
  t: StaffTranslator;
  updatePickupAction?: (bookingId: string, formData: FormData) => void;
  /** One row of the opened guest's facts list (`GuestFact`). */
  row?: boolean;
}) {
  const held = Boolean(booking.hotelPickupLocation || booking.pickupTime);
  if (!updatePickupAction && !held) return null;
  const form = updatePickupAction ? (
    <form
      action={updatePickupAction.bind(null, booking.id)}
      className={
        row
          ? "flex max-w-md flex-col gap-2"
          : "mt-2 flex max-w-md flex-col gap-2 rounded-lg border border-border bg-surface-sunken/50 p-2"
      }
    >
      <FieldGrid columns={2}>
        <Field label={t("trips.roster.pickupLocationLabel")} hint={t("trips.details.optionalHint")}>
          <input
            name="hotelPickupLocation"
            maxLength={300}
            defaultValue={booking.hotelPickupLocation ?? ""}
            placeholder={t("trips.roster.pickupLocationPlaceholder")}
            className={controlClass}
          />
        </Field>
        <Field label={t("trips.roster.pickupTimeLabel")} hint={t("trips.details.optionalHint")}>
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
          pendingLabel={t("words.busy.saving")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("trips.roster.savePickup")}
        </SubmitButton>
      </div>
    </form>
  ) : null;
  if (row) {
    return (
      <GuestFact
        label={t("trips.roster.hotelPickupHeading")}
        value={
          held
            ? `${booking.hotelPickupLocation ?? t("trips.roster.hotelNotSpecified")}${booking.pickupTime ? ` · ${booking.pickupTime}` : ""}`
            : t("trips.fact.none")
        }
        empty={!held}
        edit={form ? { label: t(held ? "trips.fact.edit" : "trips.fact.add"), form } : undefined}
      />
    );
  }
  return (
    <div>
      <GroupLabel as="p">{t("trips.roster.hotelPickupHeading")}</GroupLabel>
      {held ? (
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
          label={held ? t("trips.roster.editPickup") : t("trips.roster.setPickup")}
        >
          {form}
        </CompactDisclosureRow>
      ) : null}
    </div>
  );
}
