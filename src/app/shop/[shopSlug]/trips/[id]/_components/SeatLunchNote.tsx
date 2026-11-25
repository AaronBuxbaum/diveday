import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { controlClass, Field } from "@/components/ui/form";
import { GroupLabel } from "@/components/ui/group-label";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { DIETARY_NOTE_MAX } from "@/lib/lunch-aboard";
import { GuestFact } from "./GuestFact";
import type { RosterEntry } from "./types";

/**
 * **A seat's lunch note, and the desk's way to write it** (fifth-loop ideas,
 * item 56; dive-domain review F8): for a walk-up, a phone booking, or one
 * person who answered for a whole group. Drawn only on a departure that serves
 * lunch aboard (the action is absent otherwise), or when a note is already
 * there. A meal preference for the galley; the hint says an allergy is medical.
 */
export function SeatLunchNote({
  booking,
  t,
  updateAction,
  row = false,
}: {
  booking: RosterEntry["booking"];
  t: StaffTranslator;
  updateAction?: (bookingId: string, formData: FormData) => void;
  /** One row of the opened guest's facts list (`GuestFact`). */
  row?: boolean;
}) {
  if (!updateAction && !booking.dietaryNote) return null;
  const form = updateAction ? (
    <form
      action={updateAction.bind(null, booking.id)}
      className={
        row
          ? "flex max-w-md flex-col gap-2"
          : "mt-2 flex max-w-md flex-col gap-2 rounded-lg border border-border bg-surface-sunken/50 p-2"
      }
    >
      <Field
        label={t("trips.roster.lunchNoteLabel")}
        description={t("trips.roster.lunchNoteHint")}
        hint={t("trips.details.optionalHint")}
      >
        <input
          name="dietaryNote"
          maxLength={DIETARY_NOTE_MAX}
          defaultValue={booking.dietaryNote ?? ""}
          placeholder={t("trips.roster.lunchNotePlaceholder")}
          className={controlClass}
        />
      </Field>
      <div>
        <SubmitButton
          pendingLabel={t("words.busy.saving")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("trips.roster.lunchNoteSave")}
        </SubmitButton>
      </div>
    </form>
  ) : null;
  if (row) {
    return (
      <GuestFact
        label={t("trips.roster.lunchNoteHeading")}
        value={booking.dietaryNote ?? t("trips.fact.none")}
        empty={!booking.dietaryNote}
        edit={
          form
            ? { label: t(booking.dietaryNote ? "trips.fact.edit" : "trips.fact.add"), form }
            : undefined
        }
      />
    );
  }
  return (
    <div>
      <GroupLabel as="p">{t("trips.roster.lunchNoteHeading")}</GroupLabel>
      <p className="mt-1 text-sm break-words text-muted">
        {booking.dietaryNote ?? t("trips.roster.lunchNoteNone")}
      </p>
      {updateAction ? (
        <CompactDisclosureRow
          className="mt-1"
          bodyClassName="mt-0"
          label={
            booking.dietaryNote ? t("trips.roster.lunchNoteEdit") : t("trips.roster.lunchNoteAdd")
          }
        >
          {form}
        </CompactDisclosureRow>
      ) : null}
    </div>
  );
}
