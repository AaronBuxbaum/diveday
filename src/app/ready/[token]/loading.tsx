/**
 * Body-shaped skeleton for /ready (design principle 1) — the token lookup and
 * readiness summary have no loading state to show meanwhile, and this is a
 * page divers often open on hotel wifi the night before a trip.
 */
export default function ReadyLoading() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-6 h-24 rounded-2xl border border-border bg-surface" />
        <div className="mt-8 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-2xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
