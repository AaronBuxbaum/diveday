import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { hasCrewPrediction } from "@/lib/marine-forecast";
import type { Trip } from "./types";

export function ConditionsSection({
  saveAction,
  clearAction,
  trip,
}: {
  saveAction: (formData: FormData) => void;
  clearAction: () => void;
  trip: Trip;
}) {
  return (
    <section className="mt-10 rounded-lg border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">Crew prediction</h2>
      <p className="mt-1 text-sm text-muted">
        Publish the crew’s read on the day. It replaces the automated marine outlook for divers.
      </p>
      <form action={saveAction} className="mt-5 flex flex-col gap-5">
        <FieldGrid columns={1} className="max-w-2xl">
          <Field label="Conditions overview">
            <textarea
              name="conditionsSummary"
              rows={2}
              maxLength={600}
              defaultValue={trip.conditionsSummary ?? ""}
              placeholder="A calm morning is expected; the crew will confirm the final call at the dock."
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={3} className="gap-x-5 gap-y-5">
          <Field label="Water temp °C">
            <input
              name="waterTemperatureC"
              type="number"
              min={-2}
              max={40}
              defaultValue={trip.waterTemperatureC ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label="Visibility metres">
            <input
              name="visibilityMeters"
              type="number"
              min={0}
              max={100}
              defaultValue={trip.visibilityMeters ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label="Surface notes">
            <input
              name="surfaceConditions"
              maxLength={300}
              defaultValue={trip.surfaceConditions ?? ""}
              placeholder="Light breeze · gentle chop"
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <SubmitButton
          pendingLabel="Publishing…"
          className={buttonClass({
            variant: "secondary",
            className: "self-start text-foreground",
          })}
        >
          Publish crew prediction
        </SubmitButton>
      </form>
      {hasCrewPrediction(trip) ? (
        <form action={clearAction} className="mt-3">
          <SubmitButton
            pendingLabel="Clearing…"
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            Return to automated outlook
          </SubmitButton>
        </form>
      ) : null}
    </section>
  );
}
