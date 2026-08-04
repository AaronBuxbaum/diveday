/**
 * Diver-picker skeleton for step two of "add a booking" — the roster search
 * that seats someone on the departure named in the path.
 */
export default function NewBookingForTripLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-64 max-w-full rounded bg-surface-sunken" />
        <div className="mt-2 h-4 w-48 rounded bg-surface-sunken" />
        <div className="mt-6 h-11 w-full max-w-sm rounded-lg bg-surface-sunken" />
        <div className="mt-6 flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
