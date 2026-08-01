/**
 * Body-shaped skeleton for Staffing (design principle 1) — the shift window,
 * roster-with-shifts grid, and coverage-gap lookup have no loading state to
 * show meanwhile.
 */
export default function StaffingLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-64 rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-80 max-w-full rounded bg-surface-sunken" />

        <div className="mt-8 h-24 rounded-2xl border border-border bg-surface" />

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-40 rounded-xl border border-border bg-surface" />
          ))}
        </div>

        <div className="mt-8 grid gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
