import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import type { Requirement, SiteRequirement, Trip } from "./types";

export function RequirementsSection({
  action,
  trip,
  requirement,
  siteRequirement,
  locale,
}: {
  action: (formData: FormData) => void;
  trip: Trip;
  requirement: Requirement;
  siteRequirement: SiteRequirement;
  locale: string;
}) {
  const t = staffTranslator(locale);
  // The site's extra rules read as one locale-appropriate list ("X, Y and Z"),
  // not an English-only comma join — each part is itself a translated phrase.
  const siteRequirementParts = [
    siteRequirement?.minimumCertificationLevel
      ? t("trips.requirements.certOrHigher", {
          level: t(CERTIFICATION_LEVEL_KEYS[siteRequirement.minimumCertificationLevel]),
        })
      : null,
    ...(siteRequirement?.requiredSpecialties.map((specialty) =>
      t("trips.requirements.specialtyRequired", { specialty: t(SPECIALTY_KEYS[specialty]) }),
    ) ?? []),
    siteRequirement?.requiresNitrox ? t("trips.requirements.nitroxCardRequired") : null,
  ].filter((part): part is string => Boolean(part));
  const siteRequirementList = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(siteRequirementParts);
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">{t("trips.requirements.heading")}</h2>
      <p className="mt-1 text-sm text-muted">
        {trip.course
          ? t("trips.requirements.courseDescription")
          : t("trips.requirements.tripDescription")}
      </p>
      {trip.course ? (
        <div className="mt-4 rounded-lg border border-border bg-surface p-5 text-sm">
          <p>
            <strong>{t("trips.requirements.waiverLabel")}</strong>{" "}
            {requirement?.requiresWaiver
              ? t("trips.requirements.required")
              : t("trips.requirements.notRequired")}
          </p>
          <p className="mt-2">
            <strong>{t("trips.requirements.certificationLabel")}</strong>{" "}
            {requirement?.minimumCertificationLevel
              ? t("trips.requirements.certOrHigher", {
                  level: t(CERTIFICATION_LEVEL_KEYS[requirement.minimumCertificationLevel]),
                })
              : t("trips.requirements.notRequiredForEnrollment")}
          </p>
        </div>
      ) : (
        <form action={action} className="mt-4 rounded-lg border border-border bg-surface p-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:items-end">
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
              <input
                name="requiresWaiver"
                type="checkbox"
                defaultChecked={requirement?.requiresWaiver ?? true}
                className="size-4 accent-primary"
              />
              {t("trips.requirements.requireWaiver")}
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
              <input
                name="requiresPayment"
                type="checkbox"
                defaultChecked={requirement?.requiresPayment ?? false}
                className="size-4 accent-primary"
              />
              {t("trips.requirements.requirePayment")}
            </label>
            <FieldGrid columns={1}>
              <Field label={t("trips.requirements.minimumCertificationLabel")}>
                <select
                  name="minimumCertificationLevel"
                  defaultValue={requirement?.minimumCertificationLevel ?? "open_water"}
                  className={controlClass}
                >
                  <option value="">{t("trips.requirements.noCardRequired")}</option>
                  {Object.entries(CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
                    <option key={value} value={value}>
                      {t(key)}
                    </option>
                  ))}
                </select>
              </Field>
            </FieldGrid>
          </div>
          <fieldset className="mt-5">
            <legend className="text-sm font-medium">
              {t("trips.requirements.requiredSpecialtiesLegend")}
            </legend>
            <p className="mt-1 text-sm text-muted">
              {t("trips.requirements.requiredSpecialtiesDescription")}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(SPECIALTY_KEYS).map(([value, key]) => (
                <label key={value} className="flex min-h-11 items-center gap-2 text-sm font-medium">
                  <input
                    name="specialty"
                    type="checkbox"
                    value={value}
                    defaultChecked={requirement?.requiredSpecialties?.includes(
                      value as keyof typeof SPECIALTY_KEYS,
                    )}
                    className="size-4 accent-primary"
                  />
                  {t(key)}
                </label>
              ))}
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                <input
                  name="requiresNitrox"
                  type="checkbox"
                  defaultChecked={requirement?.requiresNitrox ?? false}
                  className="size-4 accent-primary"
                />
                {t("trips.requirements.nitrox")}
              </label>
            </div>
          </fieldset>
          {siteRequirement &&
          (siteRequirement.minimumCertificationLevel ||
            siteRequirement.requiredSpecialties.length > 0 ||
            siteRequirement.requiresNitrox) ? (
            <p className="mt-4 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-muted">
              {t.rich("trips.requirements.siteAlsoRequires", {
                site: trip.diveSite?.name ?? t("trips.requirements.thisSite"),
                list: siteRequirementList,
                strong: (chunks) => (
                  <strong className="font-medium text-foreground">{chunks}</strong>
                ),
              })}
            </p>
          ) : null}
          <SubmitButton
            pendingLabel={t("trips.requirements.saving")}
            className={buttonClass({
              variant: "secondary",
              className: "mt-5 text-foreground",
            })}
          >
            {t("trips.requirements.save")}
          </SubmitButton>
        </form>
      )}
    </section>
  );
}
