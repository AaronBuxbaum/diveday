/** Content-shaped skeleton for the schedule agenda (design principle 1). */
export default function TripsLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {/* Masthead: reading-size title + one muted line. */}
      <div className="mb-6 animate-pulse">
        <div className="h-7 w-40 rounded bg-surface-sunken" />
        <div className="mt-2 h-4 w-72 max-w-full rounded bg-surface-sunken" />
      </div>
      {/* Month rail and filter row — present in the shell so the streamed
          list lands where the skeleton stood instead of shifting down. */}
      <div className="mb-4 flex animate-pulse items-center gap-2">
        <div className="h-6 w-32 rounded bg-surface-sunken" />
        <div className="size-11 rounded bg-surface-sunken" />
      </div>
      <div className="mb-6 flex animate-pulse items-end gap-4">
        <div className="h-11 w-40 rounded-lg bg-surface-sunken" />
        <div className="h-5 w-24 rounded bg-surface-sunken" />
      </div>
      {/* Two day groups: calendar date block, then borderless rows. */}
      <div className="animate-pulse">
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
                  <div className="mt-2 h-4 w-80 max-w-full rounded bg-surface-sunken" />
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
