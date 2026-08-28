import { sectionCardClass } from "@/components/ui/card";

/**
 * Content-shaped skeleton for the shopfront (design principle 1): the identity
 * band and the next boat share one row at desktop, and the week follows.
 */
export default function TripsLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {/* The identity band — the shop's name at display scale, its tagline and
          the rating line — beside the next boat's card. */}
      <div className="grid animate-pulse gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div>
          <div className="h-10 w-72 max-w-full rounded bg-surface-sunken" />
          <div className="mt-3 h-6 w-96 max-w-full rounded bg-surface-sunken" />
          <div className="mt-4 h-5 w-80 max-w-full rounded bg-surface-sunken" />
        </div>
        <div className={sectionCardClass({ className: "h-56" })} />
      </div>
      {/* The week: its heading and timezone line, the month rail and the filter
          row — present in the shell so the streamed list lands where the
          skeleton stood instead of shifting down. */}
      <div className="mt-10 animate-pulse">
        <div className="mb-4">
          <div className="h-6 w-28 rounded bg-surface-sunken" />
          <div className="mt-1 h-4 w-72 max-w-full rounded bg-surface-sunken" />
        </div>
        <div className="mb-4 flex items-center gap-2">
          <div className="h-6 w-32 rounded bg-surface-sunken" />
          <div className="size-11 rounded bg-surface-sunken" />
        </div>
        <div className="mb-6 flex items-end gap-4">
          <div className="h-11 w-40 rounded-lg bg-surface-sunken" />
          <div className="h-5 w-24 rounded bg-surface-sunken" />
        </div>
        {/* Two day groups: the calendar date block, then borderless rows with
            one meta line each. */}
        {[0, 1].map((day) => (
          <div key={day} className={day === 0 ? "" : "mt-8"}>
            <div className="flex items-center gap-3 pt-2 pb-3">
              <div className="h-8 w-9 rounded bg-surface-sunken" />
              <div className="flex flex-col gap-1">
                <div className="h-3 w-10 rounded bg-surface-sunken" />
                <div className="h-3 w-10 rounded bg-surface-sunken" />
              </div>
              <div className="h-px flex-1 bg-border" />
            </div>
            {[0, 1].map((row) => (
              <div key={row} className="flex flex-col gap-2 py-4 sm:flex-row sm:gap-4 sm:py-5">
                <div className="h-5 w-36 rounded bg-surface-sunken" />
                <div className="min-w-0 flex-1">
                  <div className="h-5 w-56 max-w-full rounded bg-surface-sunken" />
                  <div className="mt-1 h-4 w-64 max-w-full rounded bg-surface-sunken" />
                </div>
                <div className="h-4 w-20 rounded bg-surface-sunken" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
