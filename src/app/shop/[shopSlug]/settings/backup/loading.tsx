/** Header + status card + form skeleton, so the route never blocks blank. */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-3 w-20 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-56 rounded bg-surface-sunken" />
        <div className="mt-3 h-4 w-full max-w-xl rounded bg-surface-sunken" />
        <div className="mt-8 rounded-lg border border-border bg-surface p-6">
          <div className="h-5 w-44 rounded bg-surface-sunken" />
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {["a", "b", "c", "d"].map((slot) => (
              <div key={slot} className="h-10 rounded-lg bg-surface-sunken" />
            ))}
          </div>
        </div>
        <div className="mt-6 rounded-lg border border-border bg-surface p-6">
          <div className="h-5 w-52 rounded bg-surface-sunken" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {["a", "b", "c", "d", "e", "f"].map((slot) => (
              <div key={slot} className="h-11 rounded-lg bg-surface-sunken" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
