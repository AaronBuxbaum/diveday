/**
 * Notice-shaped skeleton for email verification (design principle 1). The page
 * is one short outcome message either way, so the shell is the block it lands
 * in rather than a spinner.
 */
export default function VerifyLoading() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <div className="animate-pulse">
        <div className="h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-4 h-4 w-full rounded bg-surface-sunken" />
        <div className="mt-2 h-4 w-3/4 rounded bg-surface-sunken" />
        <div className="mt-8 h-11 w-40 rounded-lg bg-surface-sunken" />
      </div>
    </main>
  );
}
