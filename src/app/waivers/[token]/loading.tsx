/**
 * Body-shaped skeleton for /waivers (design principle 1) — the token lookup,
 * booking, and shop context have no loading state to show meanwhile, and
 * this is the page a diver opens from an email link the night before.
 */
export default function WaiverLoading() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-56 max-w-full rounded bg-surface-sunken" />
        <div className="mt-8 flex flex-col gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
