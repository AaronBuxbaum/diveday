import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { GroupLabel } from "@/components/ui/group-label";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * The seat's emergency contact: on file or not, with its form under it. Staff
 * record or correct a contact from the same form wherever it is rendered — in
 * the open when the seat has none (that is work), behind the disclosure when
 * it does (that is reference).
 *
 * On a **held seat** (`held`, issue #2145) the contact is the seat's own
 * (`bookings.held_emergency_contact_*`), never the matched record's: the same
 * form writes it onto the booking (`saveBookingEmergencyContact`), and the
 * manifest shows it in place of the withheld one.
 */
export function SeatEmergencyContact({
  bookingId,
  contact,
  held = false,
  holdOpen,
  t,
  saveEmergencyContactAction,
}: {
  bookingId: string;
  contact: { name: string | null; phone: string | null };
  held?: boolean;
  holdOpen: boolean;
  t: StaffTranslator;
  saveEmergencyContactAction: (formData: FormData) => void;
}) {
  const hasEmergencyContact = Boolean(contact.name && contact.phone);
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
            defaultValue={contact.name ?? ""}
            className={controlClass}
          />
        </Field>
        <Field label={t("trips.roster.emergencyContactPhoneLabel")}>
          <input
            name="emergencyContactPhone"
            type="tel"
            autoComplete="tel"
            maxLength={40}
            defaultValue={contact.phone ?? ""}
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
      <GroupLabel as="p">
        {t(
          held
            ? "trips.roster.heldEmergencyContactHeading"
            : "trips.roster.emergencyContactHeading",
        )}
      </GroupLabel>
      {hasEmergencyContact ? (
        <p className="mt-1 text-sm text-muted">
          {t("trips.roster.emergencyContactOnFile", {
            name: contact.name ?? "",
            phone: contact.phone ?? "",
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
