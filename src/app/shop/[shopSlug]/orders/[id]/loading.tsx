/**
 * Receipt-shaped skeleton for one order (design principle 1) — line items,
 * payment state, and refund history are all read per request.
 */
export default function OrderLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-64 max-w-full rounded bg-surface-sunken" />
        <div className="mt-2 h-4 w-48 rounded bg-surface-sunken" />
        <div className="mt-8 rounded-2xl border border-border bg-surface p-6">
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 rounded-xl bg-surface-sunken" />
            ))}
          </div>
        </div>
        <div className="mt-6 h-32 rounded-2xl border border-border bg-surface" />
      </div>
    </main>
  );
}
