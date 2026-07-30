/**
 * Body-shaped skeleton for Blockers (design principle 1) — the queue runs a
 * cross-trip aggregate query with no loading state to show meanwhile.
 */
export default function BlockersLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-64 rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-80 max-w-full rounded bg-surface-sunken" />
        <div className="mt-8 flex flex-col gap-5">
          {[0, 1].map((i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="h-14 border-b border-border bg-surface-sunken" />
              <div className="flex flex-col gap-3 p-4">
                {[0, 1].map((j) => (
                  <div key={j} className="h-16 rounded-lg bg-surface-sunken" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
