/** Shaped like the header, a station or two, and their rows (principle 1). */
export function TodaySkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-32 rounded bg-surface-sunken" />
      <div className="mt-2 h-10 w-72 rounded bg-surface-sunken" />
      <div className="mt-3 h-6 w-full max-w-2xl rounded bg-surface-sunken" />

      <div className="mt-11 flex flex-col gap-10">
        {[0, 1].map((station) => (
          <div
            key={`station-${station}`}
            // The station's own three tracks, so the skeleton hands over
            // without the spine shifting under the reader. It had drifted on
            // both counts: 40px in the middle where the mark needs 112, and
            // 96px in the time column that a 12-hour time no longer fits
            // (issue #1112).
            className="grid grid-cols-1 gap-y-2 sm:grid-cols-[112px_112px_1fr] sm:gap-y-0"
          >
            <div className="sm:flex sm:justify-end">
              <div className="h-6 w-20 rounded bg-surface-sunken" />
            </div>
            <div className="hidden sm:block" />
            <div>
              <div className="h-6 w-2/3 max-w-sm rounded bg-surface-sunken" />
              <div className="mt-2 h-4 w-1/2 max-w-xs rounded bg-surface-sunken" />
              <div className="mt-3 h-1 w-full rounded-full bg-surface-sunken" />
              <div className="mt-4 flex flex-col gap-px">
                {[0, 1].map((row) => (
                  <div key={`row-${station}-${row}`} className="h-12 rounded bg-surface-sunken" />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
