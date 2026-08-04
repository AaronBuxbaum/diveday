/**
 * Checklist-shaped skeleton for trip prep — renders as the trip layout's
 * children, so switching to the Prep tab keeps the sub-nav in place.
 */
export default function TripPrepLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-24 rounded bg-surface-sunken" />
      <div className="mt-3 h-9 w-64 max-w-full rounded bg-surface-sunken" />
      <div className="mt-2 h-4 w-56 rounded bg-surface-sunken" />
      <div className="mt-8 flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 rounded-xl border border-border bg-surface" />
        ))}
      </div>
    </div>
  );
}
