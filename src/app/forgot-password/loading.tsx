/**
 * Card-shaped skeleton for "reset your password" (design principle 1). The
 * page's own words need the negotiated locale (`requestLocale()`, backed by
 * `headers()`) and its banner needs `searchParams`, so neither can be in the
 * static shell — this is what a visitor sees the instant the shell lands,
 * instead of a blank page while the request resolves.
 */
export default function ForgotPasswordLoading() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="animate-pulse rounded-lg border border-border bg-surface p-6">
        <div className="h-8 w-52 rounded bg-surface-sunken" />
        <div className="mt-3 h-4 w-full rounded bg-surface-sunken" />
        <div className="mt-6 h-4 w-20 rounded bg-surface-sunken" />
        <div className="mt-2 h-11 w-full rounded-lg bg-surface-sunken" />
        <div className="mt-4 h-11 w-full rounded-lg bg-surface-sunken" />
        <div className="mx-auto mt-6 h-4 w-32 rounded bg-surface-sunken" />
      </div>
    </main>
  );
}
