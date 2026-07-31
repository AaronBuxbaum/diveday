/**
 * Body-shaped skeleton for Reviews (design principle 1) — the moderation
 * queue and stats row have no loading state to show meanwhile.
 */
export default function ReviewsLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-64 rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-80 max-w-full rounded bg-surface-sunken" />
        <div className="mt-8 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-2xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
