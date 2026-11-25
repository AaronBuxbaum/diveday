import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { controlClass, Field } from "@/components/ui/form";
import { staffParticipantTypeLabel } from "@/i18n/participant-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { PARTICIPANT_TYPES } from "@/lib/participant-types";
import { GuestFact } from "./GuestFact";
import type { RosterEntry } from "./types";

/**
 * "Coming as": what this seat is for, and the door to change it (ADR
 * 20261007-participant-types). `certRefused` is the one row the card check
 * just refused on joining the dive; only it offers "Change anyway".
 */
export function SeatComingAs({
  booking,
  t,
  certRefused,
  setParticipantTypeAction,
  row = false,
}: {
  booking: RosterEntry["booking"];
  t: StaffTranslator;
  certRefused: boolean;
  setParticipantTypeAction: (formData: FormData) => void;
  /** One row of the opened guest's facts list (`GuestFact`). */
  row?: boolean;
}) {
  const type = staffParticipantTypeLabel(t, booking.participantType ?? "diver");
  const forms = (
    <>
      <form action={setParticipantTypeAction} className="flex max-w-md flex-wrap items-end gap-2">
        <input type="hidden" name="bookingId" value={booking.id} />
        <Field label={t("participants.roster.typeLabel")}>
          <select
            name="participantType"
            defaultValue={booking.participantType ?? "diver"}
            className={controlClass}
          >
            {PARTICIPANT_TYPES.map((type) => (
              <option key={type} value={type}>
                {staffParticipantTypeLabel(t, type)}
              </option>
            ))}
          </select>
        </Field>
        <SubmitButton
          pendingLabel={t("words.busy.saving")}
          className={buttonClass({ variant: "secondary" })}
        >
          {t("participants.roster.save")}
        </SubmitButton>
      </form>
      {/* The card check refused joining the dive; the notice above names
          the card. Only this row offers the way past it, only to a staffer
          who may make that call, and it only skips the booking-time check:
          the rail still asks for the card, and a seat already boarded is
          re-checked as a diver and refused. */}
      {certRefused ? (
        <form action={setParticipantTypeAction} className="mt-3">
          <input type="hidden" name="bookingId" value={booking.id} />
          <input type="hidden" name="participantType" value="diver" />
          <input type="hidden" name="confirmCertBlock" value="1" />
          <SubmitButton
            pendingLabel={t("words.busy.saving")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("participants.roster.changeAnyway")}
          </SubmitButton>
        </form>
      ) : null}
    </>
  );
  if (row) {
    return (
      <GuestFact
        label={t("participants.roster.typeLabel")}
        value={type}
        edit={{ label: t("trips.fact.edit"), form: forms, open: certRefused }}
      />
    );
  }
  return (
    <div className="mt-5 border-t border-border pt-3">
      <CompactDisclosureRow
        bodyClassName="mt-2"
        open={certRefused ? true : undefined}
        label={t("participants.roster.comingAs", { type })}
      >
        {forms}
      </CompactDisclosureRow>
    </div>
  );
}
