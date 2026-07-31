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
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
