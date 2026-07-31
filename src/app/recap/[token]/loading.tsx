/**
 * Body-shaped skeleton for /recap (design principle 1) — the token lookup and
 * trip/review summary have no loading state to show meanwhile.
 */
export default function RecapLoading() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-6 h-40 rounded-2xl border border-border bg-surface" />
        <div className="mt-8 h-32 rounded-2xl border border-border bg-surface" />
      </div>
    </main>
  );
}
