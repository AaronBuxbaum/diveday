import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { cachedListFormat } from "@/lib/intl-cache";
import type { FormNotice } from "@/lib/staff-notices";
import { EditDisclosure } from "./EditDisclosure";
import type { Requirement, SiteRequirement, Trip } from "./types";

/**
 * The four wordings of "the site also asks for this", spelled out rather than
 * built with a template literal so every key stays statically visible to the
 * staff bundle's type checking.
 */
function siteNoteKey(kind: "trip" | "course", multipleSites: boolean) {
  if (kind === "course") {
    return multipleSites
      ? ("trips.requirements.sitesAlsoRequireCourse" as const)
      : ("trips.requirements.siteAlsoRequiresCourse" as const);
  }
  return multipleSites
    ? ("trips.requirements.sitesAlsoRequire" as const)
    : ("trips.requirements.siteAlsoRequires" as const);
}

export function RequirementsSection({
  action,
  status,
  trip,
  requirement,
  siteRequirement,
  siteNames,
  locale,
}: {
  action: (formData: FormData) => void;
  /** This form's own outcome, rendered beside its Save button. */
  status?: FormNotice;
  trip: Trip;
  requirement: Requirement;
  siteRequirement: SiteRequirement;
  /**
   * Every distinct site this trip visits, in dive order — the same list the
   * header shows. `siteRequirement` is the union across *all* of them
   * (`getTripSiteRequirement`), so naming one site as the source of the rule
   * is only honest when the trip visits exactly one.
   */
  siteNames: string[];
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
  const siteRequirementList = cachedListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(siteRequirementParts);
  const hasSiteRequirement = siteRequirementParts.length > 0;
  /**
   * The itinerary's own gate, said out loud.
   *
   * It used to render only in the editable (non-course) branch, which is
   * exactly backwards for the case that hurts: a course session's requirements
   * are frozen — `saveRequirementsAction` refuses to edit them — so on the one
   * surface where staff have no control over the gate, the gate was also
   * invisible. An AOW course dives a site marked `advanced_open_water` by
   * design, and staff could see nothing saying so.
   *
   * And *which* site imposes it: this used to read `trip.diveSite` — dive one's site, copied onto the trip
   * row — while `siteRequirement` was already the union across every site the
   * trip visits. On a two-site day whose Deep gate comes from the *second*
   * tank, that named the wrong site as the source of the rule, sending staff
   * to the wrong card to understand or change it. Both plural keys drop the
   * singular verb along with the singular name.
   */
  const multipleSites = siteNames.length > 1;
  const siteNoteSubject = multipleSites
    ? cachedListFormat(locale, { style: "long", type: "conjunction" }).format(siteNames)
    : (siteNames[0] ?? t("trips.requirements.thisSite"));
  const siteNote = (kind: "trip" | "course") => (
    <p className="mt-4 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-muted">
      {t.rich(siteNoteKey(kind, multipleSites), {
        site: siteNoteSubject,
        list: siteRequirementList,
        strong: (chunks) => <strong className="font-medium text-foreground">{chunks}</strong>,
      })}
    </p>
  );
  // The gate as the list of things a diver must actually bring — and only
  // those. "Payment: not required" and "Specialties: None required" rendered
  // the absence of a rule as a rule (design/principles.md #9); what the gate
  // does not ask for simply isn't on it, and a trip that asks for nothing says
  // so in one quiet sentence. Exact words, never color alone: these lines are
  // what admission and readiness will enforce (principle 6).
  const requirementLines =
    requirement === null
      ? []
      : [
          requirement.requiresWaiver ? t("trips.requirements.summaryWaiver") : null,
          !trip.course && requirement.requiresPayment
            ? t("trips.requirements.summaryPayment")
            : null,
          requirement.minimumCertificationLevel
            ? t("trips.requirements.summaryCert", {
                level: t(CERTIFICATION_LEVEL_KEYS[requirement.minimumCertificationLevel]),
              })
            : null,
          ...(trip.course
            ? []
            : requirement.requiredSpecialties.map((specialty) =>
                t("trips.requirements.summarySpecialtyCard", {
                  specialty: t(SPECIALTY_KEYS[specialty]),
                }),
              )),
          !trip.course && requirement.requiresNitrox
            ? t("trips.requirements.summaryNitroxCard")
            : null,
        ].filter((line): line is string => Boolean(line));
  const requirementSummary =
    requirementLines.length > 0 ? (
      <ul className="mt-4 grid gap-2 text-sm">
        {requirementLines.map((line) => (
          <li key={line} className="flex gap-2">
            <span aria-hidden="true" className="text-muted">
              •
            </span>
            <span className="font-medium">{line}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="mt-4 text-sm text-muted">{t("trips.requirements.summaryNoneRequired")}</p>
    );
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">{t("trips.requirements.heading")}</h2>
      <p className="mt-1 text-sm text-muted">
        {trip.course
          ? t("trips.requirements.courseDescription")
          : t("trips.requirements.tripDescription")}
      </p>
      {trip.course ? (
        <>
          {requirementSummary}
          {hasSiteRequirement ? siteNote("course") : null}
        </>
      ) : (
        <>
          {/* Fail-closed words for a fail-closed state: with no requirements
              row, readiness blocks every diver (`requirements_not_configured`,
              src/lib/readiness.ts) — so the summary must never read as
              "nothing required" (dive-domain review). */}
          {requirement === null ? (
            <p className="mt-4 text-sm font-medium text-warning-strong">
              {t("trips.requirements.notConfigured")}
            </p>
          ) : (
            requirementSummary
          )}
          {hasSiteRequirement ? siteNote("trip") : null}
          <EditDisclosure
            label={t("trips.requirements.edit")}
            open={Boolean(status) || requirement === null}
          >
            <form action={action} className="mt-2 rounded-lg border border-border bg-surface p-5">
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
                    <label
                      key={value}
                      className="flex min-h-11 items-center gap-2 text-sm font-medium"
                    >
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
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <SubmitButton
                  pendingLabel={t("trips.requirements.saving")}
                  className={buttonClass({
                    variant: "secondary",
                    className: "text-foreground",
                  })}
                >
                  {t("trips.requirements.save")}
                </SubmitButton>
                <FormStatus tone={status?.tone}>{status?.text}</FormStatus>
              </div>
            </form>
          </EditDisclosure>
        </>
      )}
    </section>
  );
}
