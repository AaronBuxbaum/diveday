/**
 * Board-shaped skeleton for `/board/[token]` — the header line, then three
 * rows the height a departure takes at display size. Painted while the token
 * verifies and the day reads; a screen on a wall must not flash white in
 * between, so it wears the same `boat-mode` ground the board does.
 */
export default function BoardLoading() {
  return (
    <main className="boat-mode flex min-h-screen flex-col bg-background px-6 py-6 text-foreground sm:px-10 sm:py-8 lg:px-14 lg:py-12">
      <div className="animate-pulse">
        <div className="flex items-end justify-between gap-6">
          <div className="h-10 w-72 max-w-full rounded bg-surface-sunken" />
          <div className="h-7 w-40 rounded bg-surface-sunken" />
        </div>
        <div className="mt-8 grid gap-4 lg:mt-10 lg:gap-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-36 rounded-panel border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
