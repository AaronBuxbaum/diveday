import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { controlClass, Field } from "@/components/ui/form";
import { GroupLabel } from "@/components/ui/group-label";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { DIETARY_NOTE_MAX } from "@/lib/lunch-aboard";
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
}: {
  booking: RosterEntry["booking"];
  t: StaffTranslator;
  updateAction?: (bookingId: string, formData: FormData) => void;
}) {
  if (!updateAction && !booking.dietaryNote) return null;
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
          <form
            action={updateAction.bind(null, booking.id)}
            className="mt-2 flex max-w-md flex-col gap-2 rounded-lg border border-border bg-surface-sunken/50 p-2"
          >
            <Field
              label={t("trips.roster.lunchNoteLabel")}
              description={t("trips.roster.lunchNoteHint")}
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
                pendingLabel={t("trips.roster.saving")}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("trips.roster.lunchNoteSave")}
              </SubmitButton>
            </div>
          </form>
        </CompactDisclosureRow>
      ) : null}
    </div>
  );
}
