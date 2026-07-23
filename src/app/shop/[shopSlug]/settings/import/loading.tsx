/** Header + honesty-table skeleton, so the route never blocks blank. */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-3 w-20 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-64 rounded bg-surface-sunken" />
        <div className="mt-3 h-4 w-full max-w-xl rounded bg-surface-sunken" />
        <div className="mt-8 rounded-2xl border border-border bg-surface p-6">
          <div className="h-5 w-44 rounded bg-surface-sunken" />
          <div className="mt-4 space-y-2">
            {["a", "b", "c", "d", "e", "f"].map((slot) => (
              <div key={slot} className="h-12 rounded-xl bg-surface-sunken" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
