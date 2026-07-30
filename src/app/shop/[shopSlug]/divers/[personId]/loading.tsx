/**
 * Body-shaped skeleton for a diver's profile (design principle 1). Without
 * one, this route would inherit the Divers list's row-shaped skeleton from
 * the parent segment — a shape mismatch for a single profile page.
 */
export default function DiverProfileLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-56 rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
