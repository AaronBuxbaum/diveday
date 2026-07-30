import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import { recurrenceSummary } from "@/lib/recurrence";

/**
 * Series-wide controls for a materialized recurring trip: apply this date's
 * template to the rest of the run, roll the finite horizon forward, or cancel
 * every upcoming date at once. Each instance stays fully independent — these
 * are conveniences over the per-date tooling, never a live link that rewrites
 * siblings behind staff's back (20260719-recurring-trip-series).
 */
export function SeriesSection({
  intervalWeeks,
  occurrenceCount,
  futureScheduledCount,
  applyAction,
  cancelAction,
  extendAction,
  locale,
}: {
  intervalWeeks: number;
  occurrenceCount: number;
  futureScheduledCount: number;
  applyAction: () => void;
  cancelAction: () => void;
  extendAction: (formData: FormData) => void;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const hasFuture = futureScheduledCount > 0;
  const hasOtherFuture = futureScheduledCount > 1;
  // `recurrenceSummary` returns an already-composed English phrase from
  // src/lib (out of scope for a component-level extraction — flagged for the
  // domain layer to return a code instead); it nests here as one opaque value.
  const summary = recurrenceSummary({ frequency: "weekly", intervalWeeks, occurrenceCount });
  return (
    <section className="mt-12 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">{t("trips.series.heading")}</h2>
      <p className="mt-1 text-sm text-muted">
        {hasFuture
          ? t("trips.series.summaryWithFuture", { summary, count: futureScheduledCount })
          : t("trips.series.summaryAllDone", { summary })}
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {hasOtherFuture ? (
          <form action={applyAction} className="flex flex-col gap-1.5">
            <SubmitButton
              pendingLabel={t("trips.series.applying")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("trips.series.applyToSeries")}
            </SubmitButton>
            <p className="text-sm text-muted">{t("trips.series.applyDescription")}</p>
          </form>
        ) : null}

        <form action={extendAction} className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t("trips.series.addMoreDates")}
              <input
                name="count"
                type="number"
                min={1}
                max={26}
                defaultValue={4}
                aria-label={t("trips.series.addMoreDatesAriaLabel")}
                className={`${controlClass} tabular-nums sm:w-28`}
              />
            </label>
            <SubmitButton
              pendingLabel={t("trips.series.adding")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("trips.series.addToSchedule")}
            </SubmitButton>
          </div>
          <p className="text-sm text-muted">{t("trips.series.extendDescription")}</p>
        </form>

        {hasFuture ? (
          <form action={cancelAction} className="flex flex-col gap-1.5">
            <SubmitButton
              pendingLabel={t("trips.series.cancelling")}
              className={buttonClass({ variant: "danger" })}
            >
              {t("trips.series.cancelAllUpcoming")}
            </SubmitButton>
            <p className="text-sm text-muted">
              {t("trips.series.cancelDescription", { count: futureScheduledCount })}
            </p>
          </form>
        ) : null}
      </div>
    </section>
  );
}
