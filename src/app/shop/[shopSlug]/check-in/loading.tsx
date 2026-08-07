/**
 * Body-shaped skeleton for Check-in (design principle 1) — the readiness
 * lookup across today's departures has no loading state to show meanwhile,
 * and this page runs during the morning rush.
 */
export default function CheckInLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-64 rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-80 max-w-full rounded bg-surface-sunken" />
        <div className="mt-8 flex flex-col gap-6">
          {[0, 1].map((group) => (
            <div key={group} className="rounded-2xl border border-border bg-surface">
              <div className="border-b border-border px-4 py-3">
                <div className="h-5 w-56 rounded bg-surface-sunken" />
                <div className="mt-1.5 h-4 w-40 rounded bg-surface-sunken" />
              </div>
              <div className="divide-y divide-border">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex items-center justify-between px-4 py-3">
                    <div className="h-5 w-44 rounded bg-surface-sunken" />
                    <div className="h-9 w-24 rounded-lg bg-surface-sunken" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
