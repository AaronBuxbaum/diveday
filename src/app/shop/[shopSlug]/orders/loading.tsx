/**
 * Body-shaped skeleton for the Orders index (design principle 1) — the
 * filtered, paginated invoice list has no loading state to show meanwhile.
 */
export default function OrdersIndexLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-64 rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-80 max-w-full rounded bg-surface-sunken" />

        <div className="mt-8 h-24 rounded-lg border border-border bg-surface" />

        <div className="mt-6 h-72 rounded-2xl border border-border bg-surface" />
      </div>
    </main>
  );
}
