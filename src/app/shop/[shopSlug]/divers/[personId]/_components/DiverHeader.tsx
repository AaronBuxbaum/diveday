import Link from "next/link";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import { maxPlausibleBirthDate } from "@/lib/age";
import { mailtoHref, telHref } from "@/lib/contact-links";
import { savePersonAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile } from "./shared";

export function DiverHeader({
  diver,
  shopSlug,
  personId,
  locale,
  status,
  editOpen = false,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  locale: string;
  /** This form's own outcome, rendered in its action row rather than page-top. */
  status?: DiverNotice;
  /**
   * Starts the details form expanded. Set right after the roster's three-field
   * "Add a diver" form lands here: the record exists but holds a name and
   * maybe an email, and everything that makes it useful — date of birth,
   * insurance, emergency contact — is behind a disclosure the front desk had
   * to know to open.
   */
  editOpen?: boolean;
}) {
  const t = staffTranslator(locale);
  const formStatus = status?.tone === "danger" ? status : undefined;
  return (
    <>
      <Link
        href={`/shop/${shopSlug}/divers`}
        className="text-sm font-medium text-primary hover:underline"
      >
        {t("divers.header.backToAllDivers")}
      </Link>
      <div className="mt-4">
        <ShopPageHeader
          eyebrow={t("divers.header.eyebrow")}
          title={diver.person.fullName}
          align="start"
          meta={
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              {/* `mailtoHref`/`telHref` (src/lib/contact-links.ts), not a
                  template string with the sanitizing regex copied in beside
                  it: a shop stores a number the way it prints it, and a `tel:`
                  URI carrying spaces and parentheses is refused outright by
                  several diallers — which is the one tap on this page a
                  staffer makes with a diver already on the phone. Both links
                  are button-shaped and go through `buttonClass` for it, so the
                  44px target is structural rather than a remembered
                  `min-h-11`. */}
              {diver.person.email ? (
                <a
                  href={mailtoHref(diver.person.email)}
                  className={buttonClass({
                    variant: "link",
                    size: "sm",
                    className: "hover:bg-primary/10",
                  })}
                >
                  <span aria-hidden="true">📧</span>
                  {diver.person.email}
                </a>
              ) : null}
              {diver.person.phone ? (
                <a
                  href={telHref(diver.person.phone)}
                  className={buttonClass({
                    variant: "link",
                    size: "sm",
                    className: "hover:bg-primary/10",
                  })}
                >
                  <span aria-hidden="true">📞</span>
                  {diver.person.phone}
                </a>
              ) : null}
              {!diver.person.email && !diver.person.phone ? (
                <span>{t("divers.header.noContactDetails")}</span>
              ) : null}
              {diver.person.diveInsurance ? (
                <span className="inline-flex min-h-11 items-center gap-2 px-2">
                  <span aria-hidden="true">🛟</span>
                  <span>
                    <span className="sr-only">{t("divers.header.diveInsurancePrefix")}</span>
                    {diver.person.diveInsurance}
                  </span>
                </span>
              ) : null}
            </div>
          }
        />
        {status?.tone === "success" ? (
          <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} className="mt-3" />
        ) : null}
        {/* The disclosure lives *under* the header, not in its `actions` slot.
            In the slot, the trigger sat in the header's narrow right-hand
            column and the panel opened inside it — a cramped one-column card
            hanging off the side of the diver's name, pushing the header's own
            layout around as it grew. Below the header it gets the full content
            width, so the seven fields lay out two-up like every other staff
            form. */}
        <details open={editOpen} className="group mt-4">
          <summary
            className={buttonClass({
              variant: "secondary",
              size: "sm",
              className: "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
            })}
          >
            {t("divers.header.editDetails")}
            {/* The shared caret, in the `down` grammar this trigger already
                used — a chevron trailing a label, flipped a half turn on open,
                rather than the `right` one that leads a row. The inlined copy
                this replaces had drifted to `strokeWidth={2}` against the
                component's 2.5, which at 12px is the difference between a mark
                and a hairline. */}
            <DisclosureCaret direction="down" className="group-open:rotate-180" />
          </summary>
          <FieldGrid
            as="form"
            action={savePersonAction.bind(null, shopSlug, personId)}
            columns={2}
            className={sectionCardClass({ className: "mt-3 w-full gap-y-3" })}
          >
            <Field label={t("divers.header.fullNameLabel")}>
              <input
                name="fullName"
                required
                defaultValue={diver.person.fullName}
                className={controlClass}
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
              <input
                name="phone"
                type="tel"
                defaultValue={diver.person.phone ?? ""}
                className={controlClass}
              />
            </Field>
            <Field
              label={t("divers.header.dateOfBirthLabel")}
              hint={t("divers.header.optionalHint")}
            >
              <input
                name="dateOfBirth"
                type="date"
                // Mirrors the server-side plausibility bound so a mistyped
                // year is caught in the field, not by a redirect to
                // `?notice=invalid`.
                max={maxPlausibleBirthDate()}
                min="1900-01-01"
                defaultValue={diver.person.dateOfBirth ?? ""}
                className={controlClass}
              />
            </Field>
            <Field
              label={t("divers.header.diveInsuranceFieldLabel")}
              hint={t("divers.header.optionalHint")}
              description={t("divers.header.diveInsuranceDescription")}
            >
              <input
                name="diveInsurance"
                defaultValue={diver.person.diveInsurance ?? ""}
                placeholder={t("divers.header.diveInsurancePlaceholder")}
                className={controlClass}
              />
            </Field>
            {/* Task 144 — Today used to tell staff to "ask at the counter"
                    and link to a roster with nowhere to type it in. This and
                    the roster's per-diver card (RosterSection.tsx) are the two
                    staff entry points; both write through the same
                    `updateDiver`/`saveBookingEmergencyContact` columns the
                    diver's own /ready and /waivers capture use, and it prints
                    on the manifest. */}
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
            <FieldActions>
              {/* `busy`: it disables itself for its own save, which is "this
                  is happening", not "you cannot do this". */}
              <SubmitButton
                pendingLabel={t("divers.header.saving")}
                className={buttonClass({ variant: "secondary", busy: true })}
              >
                {t("divers.header.saveDetails")}
              </SubmitButton>
              {/* A field-level refusal already renders on its own control, so
                  repeating it here would say the same thing twice. */}
              {formStatus?.field ? null : (
                <DiverFormStatus status={formStatus} shopSlug={shopSlug} locale={locale} />
              )}
            </FieldActions>
          </FieldGrid>
        </details>
      </div>
      {/* Keyed on the notice text so an identical repeat refusal still re-fires:
          the effect only runs on a remount, and typing a second duplicate email
          produces the same URL as the first. */}
      {formStatus?.field ? (
        <FieldErrorFocus key={formStatus.text} field={formStatus.field} />
      ) : null}
    </>
  );
}
