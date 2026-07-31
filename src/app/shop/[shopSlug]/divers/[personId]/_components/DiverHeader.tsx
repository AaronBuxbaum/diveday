import Link from "next/link";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import { maxPlausibleBirthDate } from "@/lib/age";
import { savePersonAction } from "../actions";
import type { DiverProfile } from "./shared";

export function DiverHeader({
  diver,
  shopSlug,
  personId,
  locale,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  locale: string;
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
          actions={
            <details className="rounded-lg border border-border bg-surface px-4 py-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">
                {t("divers.header.editDetails")}
              </summary>
              <FieldGrid
                as="form"
                action={savePersonAction.bind(null, shopSlug, personId)}
                columns={1}
                className="mt-4 gap-y-3 sm:w-80"
              >
                <Field label={t("divers.header.fullNameLabel")}>
                  <input
                    name="fullName"
                    required
                    defaultValue={diver.person.fullName}
                    className={controlClass}
                  />
                </Field>
                <Field label={t("divers.header.emailLabel")}>
                  <input
                    name="email"
                    type="email"
                    defaultValue={diver.person.email ?? ""}
                    className={controlClass}
                  />
                </Field>
                <Field label={t("divers.header.phoneLabel")}>
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
                  description={t("divers.header.dateOfBirthDescription")}
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
                  hint={t("divers.header.diveInsuranceHint")}
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
                <Field label={t("divers.header.emergencyContactNameLabel")}>
                  <input
                    name="emergencyContactName"
                    autoComplete="name"
                    defaultValue={diver.person.emergencyContactName ?? ""}
                    className={controlClass}
                  />
                </Field>
                <Field label={t("divers.header.emergencyContactPhoneLabel")}>
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
                </FieldActions>
              </FieldGrid>
            </details>
          }
        />
      </div>
    </>
  );
}
