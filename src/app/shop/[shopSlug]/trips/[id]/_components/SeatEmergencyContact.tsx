import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { GroupLabel } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { RosterEntry } from "./types";

/**
 * The seat's emergency contact: on file or not, with its form under it. Staff
 * record or correct a contact from the same form wherever it is rendered — in
 * the open when the seat has none (that is work), behind the disclosure when
 * it does (that is reference).
 */
export function SeatEmergencyContact({
  bookingId,
  person,
  hasEmergencyContact,
  holdOpen,
  t,
  saveEmergencyContactAction,
}: {
  bookingId: string;
  person: RosterEntry["person"];
  hasEmergencyContact: boolean;
  holdOpen: boolean;
  t: StaffTranslator;
  saveEmergencyContactAction: (formData: FormData) => void;
}) {
  // Staff record or correct a contact from the same form wherever it is
  // rendered — in the open when the seat has none (that is work), behind
  // the disclosure when it does (that is reference).
  const contactForm = (
    <form
      action={saveEmergencyContactAction}
      className="mt-2 flex max-w-md flex-col gap-3 rounded-lg border border-border bg-surface-sunken/50 p-3"
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <FieldGrid columns={2}>
        <Field label={t("trips.roster.emergencyContactNameLabel")}>
          <input
            name="emergencyContactName"
            autoComplete="name"
            maxLength={120}
            defaultValue={person.emergencyContactName ?? ""}
            className={controlClass}
          />
        </Field>
        <Field label={t("trips.roster.emergencyContactPhoneLabel")}>
          <input
            name="emergencyContactPhone"
            type="tel"
            autoComplete="tel"
            maxLength={40}
            defaultValue={person.emergencyContactPhone ?? ""}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <div>
        <SubmitButton
          pendingLabel={t("trips.roster.savingContact")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("trips.roster.saveEmergencyContact")}
        </SubmitButton>
      </div>
    </form>
  );
  const emergencyContactForm = (
    <CompactDisclosureRow
      className="mt-1"
      bodyClassName="mt-0"
      label={
        hasEmergencyContact
          ? t("trips.roster.emergencyContactEdit")
          : t("trips.roster.emergencyContactAddFull")
      }
      // A refused save comes back to the form, not to its closed label.
      holdOpen={holdOpen && !hasEmergencyContact}
    >
      {contactForm}
    </CompactDisclosureRow>
  );
  // One fact, on file or not, with its form under it: a missing contact is
  // also a reason line under the name, so the fact says only "Not on file".
  return (
    <div>
      <GroupLabel as="p">{t("trips.roster.emergencyContactHeading")}</GroupLabel>
      {hasEmergencyContact ? (
        <p className="mt-1 text-sm text-muted">
          {t("trips.roster.emergencyContactOnFile", {
            name: person.emergencyContactName ?? "",
            phone: person.emergencyContactPhone ?? "",
          })}
        </p>
      ) : (
        <p className="mt-1 text-sm font-medium text-warning-strong">
          {t("trips.roster.emergencyContactMissing")}
        </p>
      )}
      {emergencyContactForm}
    </div>
  );
}
