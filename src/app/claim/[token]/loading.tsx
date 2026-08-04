/**
 * Body-shaped skeleton for /claim (design principle 1) — the token lookup has
 * no loading state of its own to show, and this page is opened from a chat
 * message on a phone more often than anywhere else.
 */
export default function ClaimLoading() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-6 h-28 rounded-2xl border border-border bg-surface" />
        <div className="mt-6 h-64 rounded-2xl border border-border bg-surface" />
      </div>
    </main>
  );
}
