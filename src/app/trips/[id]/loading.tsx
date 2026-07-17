/** Content-shaped skeleton for the trip detail + booking form. */
export default function TripDetailLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <div className="animate-pulse">
        <div className="h-4 w-16 rounded bg-surface-sunken" />
        <div className="mt-6 h-4 w-40 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-3/4 rounded bg-surface-sunken" />
        <div className="mt-3 h-5 w-64 rounded bg-surface-sunken" />
        <div className="mt-4 h-4 w-full rounded bg-surface-sunken" />
        <div className="mt-12 h-6 w-32 rounded bg-surface-sunken" />
        <div className="mt-5 h-11 rounded-lg border border-border bg-surface" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="h-11 rounded-lg border border-border bg-surface" />
          <div className="h-11 rounded-lg border border-border bg-surface" />
        </div>
        <div className="mt-5 h-12 w-40 rounded-lg bg-surface-sunken" />
      </div>
    </main>
  );
}
