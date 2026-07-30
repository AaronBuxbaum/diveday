import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import { hasCrewPrediction } from "@/lib/marine-forecast";
import type { Trip } from "./types";

export function ConditionsSection({
  saveAction,
  clearAction,
  trip,
  locale,
}: {
  saveAction: (formData: FormData) => void;
  clearAction: () => void;
  trip: Trip;
  locale: string;
}) {
  const t = staffTranslator(locale);
  return (
    <section className="mt-10 rounded-lg border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">{t("trips.conditions.heading")}</h2>
      <p className="mt-1 text-sm text-muted">{t("trips.conditions.description")}</p>
      <form action={saveAction} className="mt-5 flex flex-col gap-5">
        <label className="flex min-h-11 max-w-2xl items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <input
            id="conditions-hold"
            type="checkbox"
            name="conditionsHold"
            defaultChecked={trip.conditionsHold}
            className="mt-1 size-5 accent-current"
          />
          <span>
            <span className="font-semibold">{t("trips.conditions.holdLabel")}</span>
            <span className="mt-0.5 block text-sm text-muted">
              {t("trips.conditions.holdDescription")}
            </span>
          </span>
        </label>
        <FieldGrid columns={1} className="max-w-2xl">
          <Field label={t("trips.conditions.overviewLabel")}>
            <textarea
              name="conditionsSummary"
              rows={2}
              maxLength={600}
              defaultValue={trip.conditionsSummary ?? ""}
              placeholder={t("trips.conditions.overviewPlaceholder")}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={3} className="gap-x-5 gap-y-5">
          <Field label={t("trips.conditions.waterTempLabel")}>
            <input
              name="waterTemperatureC"
              type="number"
              min={-2}
              max={40}
              defaultValue={trip.waterTemperatureC ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label={t("trips.conditions.visibilityLabel")}>
            <input
              name="visibilityMeters"
              type="number"
              min={0}
              max={100}
              defaultValue={trip.visibilityMeters ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label={t("trips.conditions.surfaceNotesLabel")}>
            <input
              name="surfaceConditions"
              maxLength={300}
              defaultValue={trip.surfaceConditions ?? ""}
              placeholder={t("trips.conditions.surfaceNotesPlaceholder")}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <SubmitButton
          pendingLabel={t("trips.conditions.publishing")}
          className={buttonClass({
            variant: "secondary",
            className: "self-start text-foreground",
          })}
        >
          {t("trips.conditions.publish")}
        </SubmitButton>
      </form>
      {hasCrewPrediction(trip) ? (
        <form action={clearAction} className="mt-3">
          <SubmitButton
            pendingLabel={t("trips.conditions.clearing")}
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            {t("trips.conditions.returnToAutomated")}
          </SubmitButton>
        </form>
      ) : null}
    </section>
  );
}
