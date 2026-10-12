import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import type { DiverTranslator } from "@/i18n/messages";
import { SectionHeading } from "./SectionHeading";
import type { WaiverFieldError } from "./waiver-fields";

/**
 * The signing form's emergency contact: a name and a reachable number, editable
 * whether or not something is on file, each refusal under its own box.
 */
export function EmergencyContactSection({
  emergencyContact,
  namedFieldError,
  t,
}: {
  emergencyContact: { name: string | null; phone: string | null } | null;
  namedFieldError: WaiverFieldError | undefined;
  t: DiverTranslator;
}) {
  return (
    <>
      {/* No card here: the heading, helper line, and the two fields carry
        the section by themselves (principle 10 — type and space before
        boxes). The one card left in the form is the signature block. */}
      <section>
        <SectionHeading>{t("waiver.emergencyContact")}</SectionHeading>
        {/* Editable whether or not something is on file. It used to go
          read-only the moment a contact existed, on the reasoning that a
          correction was staff work — but this is the one screen a diver
          fills in the week before a trip, and the person they'd name has
          often changed since they booked. `saveBookingEmergencyContact`
          never lets a blank overwrite a stored value, so re-showing the
          fields can only ever improve what the crew has. */}
        {emergencyContact?.name && emergencyContact?.phone ? (
          <p className="mt-2 text-sm text-muted">
            {/* The number is set whole: it broke after "+1-305-555-" at 390
              (K-257). A `nowrap` span, never non-breaking hyphens, so a
              number copied off the page still dials; the bundle glues the
              dot before it to both sides. */}
            {t.rich("waiver.emergencyOnFile", {
              name: emergencyContact.name,
              phone: emergencyContact.phone,
              nowrap: (chunks) => <span className="whitespace-nowrap">{chunks}</span>,
            })}{" "}
            {t("waiver.emergencyContactChangeHint")}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">{t("waiver.emergencyContactDescription")}</p>
        )}
        {/* A half-filled pair is refused on the empty box, in the same
          shape as every other refusal on this page: the words under the
          control the reader was just sent to, not a banner at the top. */}
        <FieldGrid columns={2} className="mt-4">
          <Field
            label={t("waiver.contactName")}
            error={
              namedFieldError?.anchor === "emergencyContactName"
                ? t(namedFieldError.textKey)
                : undefined
            }
          >
            <input
              id="emergencyContactName"
              name="emergencyContactName"
              autoComplete="name"
              maxLength={120}
              defaultValue={emergencyContact?.name ?? ""}
              className={controlClass}
            />
          </Field>
          <Field
            label={t("waiver.contactPhone")}
            error={
              namedFieldError?.anchor === "emergencyContactPhone"
                ? t(namedFieldError.textKey)
                : undefined
            }
          >
            <input
              id="emergencyContactPhone"
              name="emergencyContactPhone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={40}
              defaultValue={emergencyContact?.phone ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
      </section>
    </>
  );
}
