import Link from "next/link";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import { maxPlausibleBirthDate } from "@/lib/age";
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
              {diver.person.email ? (
                <a
                  href={`mailto:${diver.person.email}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 font-medium text-primary hover:bg-primary/10 hover:underline"
                >
                  <span aria-hidden="true">✉</span>
                  {diver.person.email}
                </a>
              ) : null}
              {diver.person.phone ? (
                <a
                  href={`tel:${diver.person.phone.replace(/[^\d+]/g, "")}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 font-medium text-primary hover:bg-primary/10 hover:underline"
                >
                  <span aria-hidden="true">☎</span>
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
        {/* The disclosure lives *under* the header, not in its `actions` slot.
            In the slot, the trigger sat in the header's narrow right-hand
            column and the panel opened inside it — a cramped one-column card
            hanging off the side of the diver's name, pushing the header's own
            layout around as it grew. Below the header it gets the full content
            width, so the seven fields lay out two-up like every other staff
            form. */}
        <details open={editOpen} className="group mt-4">
          <summary
            className={`${buttonClass({
              variant: "secondary",
              size: "sm",
            })} w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
          >
            {t("divers.header.editDetails")}
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-3 transition-transform group-open:rotate-180"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <FieldGrid
            as="form"
            action={savePersonAction.bind(null, shopSlug, personId)}
            columns={2}
            className="mt-3 w-full gap-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm"
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
              error={status?.field === "diver-email" ? status.text : undefined}
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
              <SubmitButton pendingLabel={t("divers.header.saving")} className={buttonClass()}>
                {t("divers.header.saveDetails")}
              </SubmitButton>
              {/* A field-level refusal already renders on its own control, so
                  repeating it here would say the same thing twice. */}
              {status?.field ? null : (
                <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} />
              )}
            </FieldActions>
          </FieldGrid>
        </details>
      </div>
      {/* Keyed on the notice text so an identical repeat refusal still re-fires:
          the effect only runs on a remount, and typing a second duplicate email
          produces the same URL as the first. */}
      {status?.field ? <FieldErrorFocus key={status.text} field={status.field} /> : null}
    </>
  );
}
