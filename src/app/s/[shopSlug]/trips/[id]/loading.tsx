/**
 * Body-shaped skeleton for a trip's public detail page (design principle 1).
 * This page runs several parallel queries plus a conditional, timeout-bound
 * marine-forecast fetch, so a cold nav previously had a real beat with
 * nothing shaped to show meanwhile. Shaped like the redesigned body: back
 * link, eyebrow, title, the strong when-line, the price moment, then the one
 * raised booking card and a flat supporting band.
 */
export default function TripDetailLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-6 h-3 w-28 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-4 h-6 w-56 rounded bg-surface-sunken" />
        <div className="mt-5 h-8 w-36 rounded bg-surface-sunken" />
        <div className="mt-10 h-72 rounded-2xl border border-border bg-surface shadow-sm" />
        <div className="mt-12 h-40 rounded-2xl bg-surface-sunken" />
      </div>
    </main>
  );
}
