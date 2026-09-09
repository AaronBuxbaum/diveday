/**
 * Counter-shaped skeleton for `/check-in/[token]` — the shop's name, the
 * prompt, the box, the button. Painted while the token verifies; a tablet on a
 * counter must not flash white, so it wears the same `boat-mode` ground the
 * console does.
 */
export default function KioskCheckInLoading() {
  return (
    <main className="boat-mode mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-8 sm:px-10 sm:py-12">
      <div className="animate-pulse">
        <div className="flex items-end justify-between gap-6">
          <div className="h-9 w-64 max-w-full rounded bg-surface-sunken" />
          <div className="h-6 w-32 rounded bg-surface-sunken" />
        </div>
        <div className="mt-6 h-8 w-40 rounded bg-surface-sunken" />
        <div className="mt-8 h-7 w-32 rounded bg-surface-sunken" />
        <div className="mt-4 h-16 w-full rounded-lg bg-surface-sunken" />
        <div className="mt-4 h-14 w-44 rounded-lg bg-surface-sunken" />
      </div>
    </main>
  );
}
