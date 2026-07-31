/**
 * Body-shaped skeleton for a trip's public detail page (design principle 1).
 * This page runs several parallel queries plus a conditional, timeout-bound
 * marine-forecast fetch, so a cold nav previously had a real beat with
 * nothing shaped to show meanwhile.
 */
export default function TripDetailLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-56 rounded bg-surface-sunken" />
        <div className="mt-8 h-56 rounded-2xl border border-border bg-surface" />
        <div className="mt-6 h-40 rounded-2xl border border-border bg-surface" />
      </div>
    </main>
  );
}
