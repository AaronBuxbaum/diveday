/**
 * Catalog-shaped skeleton for the diver-facing course list (design principle
 * 1): the header block, then the hairline ledger the catalog renders — rows
 * of title, pitch, and fact line with a price on the right. Course rows are
 * per-shop and visibility can change between requests, so none of it is in
 * the static shell — a diver browsing from the schedule sees this the
 * instant they tap, instead of a held page.
 */
export default function PublicCoursesLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8 animate-pulse">
        <div className="h-3 w-20 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-48 rounded bg-surface-sunken" />
        <div className="mt-2 h-4 w-full max-w-2xl rounded bg-surface-sunken" />
      </div>
      <div className="mt-8 animate-pulse divide-y divide-border border-y border-border">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-start justify-between gap-6 py-5">
            <div className="min-w-0 flex-1">
              <div className="h-6 w-56 max-w-full rounded bg-surface-sunken" />
              <div className="mt-2 h-4 w-full max-w-md rounded bg-surface-sunken" />
              <div className="mt-2 h-4 w-44 max-w-full rounded bg-surface-sunken" />
            </div>
            <div className="h-5 w-16 shrink-0 rounded bg-surface-sunken" />
          </div>
        ))}
      </div>
    </main>
  );
}
