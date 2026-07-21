import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { CERTIFICATION_LEVEL_LABELS, SPECIALTY_LABELS } from "@/lib/readiness";
import type { Requirement, SiteRequirement, Trip } from "./types";

export function RequirementsSection({
  action,
  trip,
  requirement,
  siteRequirement,
}: {
  action: (formData: FormData) => void;
  trip: Trip;
  requirement: Requirement;
  siteRequirement: SiteRequirement;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Readiness requirements</h2>
      <p className="mt-1 text-sm text-muted">
        {trip.course
          ? "This session keeps the admission rules it was created with — editing the course later won’t change what enrolled students need."
          : "These are the trip’s rules. A diver stays blocked until every one of them checks out."}
      </p>
      {trip.course ? (
        <div className="mt-4 rounded-lg border border-border bg-surface p-5 text-sm">
          <p>
            <strong>Waiver:</strong> {requirement?.requiresWaiver ? "required" : "not required"}
          </p>
          <p className="mt-2">
            <strong>Existing certification:</strong>{" "}
            {requirement?.minimumCertificationLevel
              ? `${CERTIFICATION_LEVEL_LABELS[requirement.minimumCertificationLevel]} or higher`
              : "not required for enrollment"}
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
              Require a signed waiver
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
              <input
                name="requiresPayment"
                type="checkbox"
                defaultChecked={requirement?.requiresPayment ?? false}
                className="size-4 accent-primary"
              />
              Require payment to board
            </label>
            <FieldGrid columns={1}>
              <Field label="Minimum certification">
                <select
                  name="minimumCertificationLevel"
                  defaultValue={requirement?.minimumCertificationLevel ?? "open_water"}
                  className={controlClass}
                >
                  <option value="">No existing C-card required</option>
                  {Object.entries(CERTIFICATION_LEVEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </FieldGrid>
          </div>
          <fieldset className="mt-5">
            <legend className="text-sm font-medium">Required specialties</legend>
            <p className="mt-1 text-sm text-muted">
              A diver is blocked until a verified card for each proves the specialty.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(SPECIALTY_LABELS).map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-2 text-sm font-medium">
                  <input
                    name="specialty"
                    type="checkbox"
                    value={value}
                    defaultChecked={requirement?.requiredSpecialties?.includes(
                      value as keyof typeof SPECIALTY_LABELS,
                    )}
                    className="size-4 accent-primary"
                  />
                  {label}
                </label>
              ))}
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                <input
                  name="requiresNitrox"
                  type="checkbox"
                  defaultChecked={requirement?.requiresNitrox ?? false}
                  className="size-4 accent-primary"
                />
                Nitrox
              </label>
            </div>
          </fieldset>
          {siteRequirement &&
          (siteRequirement.minimumCertificationLevel ||
            siteRequirement.requiredSpecialties.length > 0 ||
            siteRequirement.requiresNitrox) ? (
            <p className="mt-4 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-muted">
              <strong className="font-medium text-foreground">
                {trip.diveSite?.name ?? "This site"}
              </strong>{" "}
              also requires{" "}
              {[
                siteRequirement.minimumCertificationLevel
                  ? `${CERTIFICATION_LEVEL_LABELS[siteRequirement.minimumCertificationLevel]} or higher`
                  : null,
                ...siteRequirement.requiredSpecialties.map(
                  (specialty) => `${SPECIALTY_LABELS[specialty]} specialty`,
                ),
                siteRequirement.requiresNitrox ? "a nitrox card" : null,
              ]
                .filter(Boolean)
                .join(", ")}
              . Readiness always enforces the stricter of the site and this trip.
            </p>
          ) : null}
          <SubmitButton
            pendingLabel="Saving…"
            className={buttonClass({
              variant: "secondary",
              className: "mt-5 text-foreground",
            })}
          >
            Save requirements
          </SubmitButton>
        </form>
      )}
    </section>
  );
}
