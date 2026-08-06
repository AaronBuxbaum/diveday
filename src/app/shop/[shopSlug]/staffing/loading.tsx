/**
 * Body-shaped skeleton for the shift roster (design principle 1): the window
 * form, the one crew-gap summary line, the roster-with-shifts grid, and the
 * add-a-shift form — in the order the page renders them.
 */
export default function StaffingLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-64 rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-80 max-w-full rounded bg-surface-sunken" />

        <div className="mt-8 h-24 rounded-2xl border border-border bg-surface" />

        <div className="mt-4 h-14 rounded-2xl border border-border bg-surface" />

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-40 rounded-xl border border-border bg-surface" />
          ))}
        </div>

        <div className="mt-8 h-64 rounded-2xl border border-border bg-surface" />
      </div>
    </main>
  );
}
