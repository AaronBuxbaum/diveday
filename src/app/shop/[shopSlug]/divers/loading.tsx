/**
 * Body-shaped skeleton for the Divers roster (design principle 1) — a
 * keyset-paginated, search-filtered list with no loading state to show
 * meanwhile.
 */
export default function DiversLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-56 rounded bg-surface-sunken" />
        <div className="mt-6 h-11 w-full max-w-sm rounded-lg bg-surface-sunken" />
        <div className="mt-6 flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
