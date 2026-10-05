import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { ForgivingInput } from "@/components/ui/ForgivingInput";
import { forgivingCopy } from "@/components/ui/forgiving-copy";
import { controlClass, DateField, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { maxPlausibleBirthDate } from "@/lib/age";
import type { DiverStatusRow } from "../_lib/status";
import { savePersonAction } from "../actions";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile } from "./shared";

/**
 * **Contact details, as the record's first file group** (ADR 20261001-logbook,
 * decision 2: one page shape, at most one primary action).
 *
 * The editor was a second dropdown button beside Book a departure. It is a door
 * like the waiver and the gear now, and its summary is the one fact a crew
 * needs from it on the day: who to call.
 *
 * **It is the one place a missing contact is named.** The status ledger used
 * to say "No emergency contact on file" above this row and link down to it;
 * now that gap is this row's own (`splitDiverStatus`), worded by its summary
 * and inked by `gap`. `#edit-details` is kept for the deep links that still
 * name it, and the disclosure opens itself for that hash.
 */
export function DiverDetailsGroup({
  diver,
  shopSlug,
  personId,
  t,
  locale,
  country,
  status,
  gap,
  open = false,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  t: StaffTranslator;
  /** The reader's language, for the forgiving fields' readings. */
  locale: string;
  /** The shop's ISO 3166-1 alpha-2 country, so a national phone number lands. */
  country: string | null;
  /** A refused save, rendered on its field or in the action row. */
  status?: DiverNotice;
  /** The status row about the emergency contact, when one is missing. */
  gap?: DiverStatusRow;
  /**
   * Starts the group open. Set right after the roster's three-field "Add a
   * diver" form lands here, when the record holds a name and little else, and
   * for a refused save, so the staffer can correct the fields in place.
   */
  open?: boolean;
}) {
  const formStatus = status?.tone === "danger" ? status : undefined;
  const emergencyName = diver.person.emergencyContactName?.trim();
  const emergencyPhone = diver.person.emergencyContactPhone?.trim();
  // The summary says the gap in words, so the gap adds only its ink: a contact
  // is never a departure blocker (readiness does not gate on it).
  return (
    <DiverFileGroupDisclosure
      id="edit-details"
      label={t("divers.details.label")}
      summary={
        !emergencyName
          ? emergencyPhone
            ? t("divers.details.summaryEmergencyNoName", { phone: emergencyPhone })
            : t("divers.details.summaryNoEmergency")
          : // "On file" needs a name and a number (glossary — Emergency
            // contact), so a name alone reads as the half it is.
            emergencyPhone
            ? t("divers.details.summaryEmergency", { name: emergencyName })
            : t("divers.details.summaryEmergencyNoPhone", { name: emergencyName })
      }
      summaryTone={gap?.tone ?? (emergencyName && emergencyPhone ? "muted" : "warning")}
      stacked
      open={open}
    >
      <FieldGrid
        as="form"
        action={savePersonAction.bind(null, shopSlug, personId)}
        columns={2}
        className={sectionCardClass({ className: "w-full gap-y-3" })}
      >
        {/* "SHARMA, PRIYA" turns around into "Priya Sharma"; ten digits in a
            Florida shop is a US number (ADR 20260906-before-you-ask,
            decision 3). Both boxes settle to what they read and submit
            exactly that. */}
        <Field label={t("divers.header.fullNameLabel")}>
          <ForgivingInput
            kind="name"
            name="fullName"
            required
            defaultValue={diver.person.fullName}
            locale={locale}
            copy={forgivingCopy(t)}
          />
        </Field>
        {/* The one refusal on this form the server can point at exactly: an
            email another active diver already holds. It belongs on the box,
            not in a sentence beside the button — and `Field`'s `error` wires
            `aria-invalid`/`aria-describedby`, which is what `FieldErrorFocus`
            below finds to put the cursor there. */}
        <Field
          label={t("divers.header.emailLabel")}
          hint={t("divers.header.optionalHint")}
          htmlFor="diver-email"
          error={formStatus?.field === "diver-email" ? formStatus.text : undefined}
        >
          <input
            id="diver-email"
            name="email"
            type="email"
            defaultValue={diver.person.email ?? ""}
            className={controlClass}
          />
        </Field>
        <Field label={t("divers.header.phoneLabel")} hint={t("divers.header.optionalHint")}>
          <ForgivingInput
            kind="phone"
            name="phone"
            autoComplete="tel"
            defaultValue={diver.person.phone ?? ""}
            locale={locale}
            country={country}
            copy={forgivingCopy(t)}
          />
        </Field>
        <Field label={t("divers.header.dateOfBirthLabel")} hint={t("divers.header.optionalHint")}>
          <DateField
            name="dateOfBirth"
            // Mirrors the server-side plausibility bound so a mistyped year
            // is caught in the field, not by a redirect to `?notice=invalid`.
            max={maxPlausibleBirthDate()}
            min="1900-01-01"
            defaultValue={diver.person.dateOfBirth ?? ""}
          />
        </Field>
        {/* Task 144 — Today used to tell staff to "ask at the counter" and
            link to a roster with nowhere to type it in. This and the
            roster's per-diver card are the two staff entry points; both
            write through the same columns the diver's own /ready and
            /waivers capture use, and it prints on the manifest. */}
        <Field
          label={t("divers.header.emergencyContactNameLabel")}
          hint={t("divers.header.optionalHint")}
        >
          <input
            name="emergencyContactName"
            autoComplete="name"
            defaultValue={diver.person.emergencyContactName ?? ""}
            className={controlClass}
          />
        </Field>
        <Field
          label={t("divers.header.emergencyContactPhoneLabel")}
          hint={t("divers.header.optionalHint")}
        >
          <input
            name="emergencyContactPhone"
            type="tel"
            autoComplete="tel"
            defaultValue={diver.person.emergencyContactPhone ?? ""}
            className={controlClass}
          />
        </Field>
        <Field
          label={t("divers.header.diveInsuranceFieldLabel")}
          hint={t("divers.header.optionalHint")}
        >
          <input
            name="diveInsurance"
            defaultValue={diver.person.diveInsurance ?? ""}
            placeholder={t("divers.header.diveInsurancePlaceholder")}
            className={controlClass}
          />
        </Field>
        <FieldActions>
          {/* `busy`: it disables itself for its own save, which is "this is
              happening", not "you cannot do this". */}
          <SubmitButton
            pendingLabel={t("divers.header.saving")}
            className={buttonClass({ variant: "secondary", busy: true })}
          >
            {t("divers.header.saveDetails")}
          </SubmitButton>
          {/* A field-level refusal already renders on its own control, so
              repeating it here would say the same thing twice. */}
          {formStatus?.field ? null : <DiverFormStatus status={formStatus} />}
        </FieldActions>
      </FieldGrid>
      {/* Keyed on the notice text so an identical repeat refusal still re-fires:
          the effect only runs on a remount, and typing a second duplicate email
          produces the same URL as the first. */}
      {formStatus?.field ? (
        <FieldErrorFocus key={formStatus.text} field={formStatus.field} />
      ) : null}
    </DiverFileGroupDisclosure>
  );
}
