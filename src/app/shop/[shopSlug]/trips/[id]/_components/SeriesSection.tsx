import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
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
}: {
  intervalWeeks: number;
  occurrenceCount: number;
  futureScheduledCount: number;
  applyAction: () => void;
  cancelAction: () => void;
  extendAction: (formData: FormData) => void;
}) {
  const hasFuture = futureScheduledCount > 0;
  const hasOtherFuture = futureScheduledCount > 1;
  return (
    <section className="mt-12 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">Repeating series</h2>
      <p className="mt-1 text-sm text-muted">
        {recurrenceSummary({ frequency: "weekly", intervalWeeks, occurrenceCount })}
        {hasFuture
          ? ` · ${futureScheduledCount} upcoming ${futureScheduledCount === 1 ? "date" : "dates"} still on the board.`
          : " · every date has departed or been cancelled."}
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {hasOtherFuture ? (
          <form action={applyAction} className="flex flex-col gap-1.5">
            <SubmitButton
              pendingLabel="Applying…"
              className={buttonClass({ variant: "secondary" })}
            >
              Apply this date's details to the whole series
            </SubmitButton>
            <p className="text-sm text-muted">
              Copies this date's title, description, capacity, pricing, and dive plan onto every
              upcoming date. Each date's own time, crew, roster, and conditions stay put; a date
              already carrying more divers than the new capacity is left alone.
            </p>
          </form>
        ) : null}

        <form action={extendAction} className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Add more dates
              <input
                name="count"
                type="number"
                min={1}
                max={26}
                defaultValue={4}
                aria-label="How many more dates to add"
                className={`${controlClass} tabular-nums sm:w-28`}
              />
            </label>
            <SubmitButton pendingLabel="Adding…" className={buttonClass({ variant: "secondary" })}>
              Add to the schedule
            </SubmitButton>
          </div>
          <p className="text-sm text-muted">
            Rolls the series forward on the same cadence, starting the week after its last date. New
            dates inherit the latest date's details.
          </p>
        </form>

        {hasFuture ? (
          <form action={cancelAction} className="flex flex-col gap-1.5">
            <SubmitButton pendingLabel="Cancelling…" className={buttonClass({ variant: "danger" })}>
              Cancel every upcoming date
            </SubmitButton>
            <p className="text-sm text-muted">
              Takes the remaining {futureScheduledCount}{" "}
              {futureScheduledCount === 1 ? "date" : "dates"} off the public schedule. Reinstate any
              single date from its own trip page.
            </p>
          </form>
        ) : null}
      </div>
    </section>
  );
}
