/**
 * Body-shaped skeleton for /recap (design principle 1) — shaped like the
 * afterglow arc it stands in for: kicker, title, the coral moment's card,
 * the route section, then the one ask card.
 */
export default function RecapLoading() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-40 rounded bg-surface-sunken" />
        <div className="mt-8 h-40 rounded-2xl border border-border bg-surface" />
        <div className="mt-10 h-3 w-36 rounded bg-surface-sunken" />
        <div className="mt-4 h-56 rounded-2xl bg-surface-sunken" />
        <div className="mt-12 h-64 rounded-2xl border border-border bg-surface sm:mt-14" />
      </div>
    </main>
  );
}
