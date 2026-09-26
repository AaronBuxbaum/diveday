/**
 * Counter-shaped skeleton for `/check-in/[token]` — the shop's name, the
 * prompt, the box, the button. Painted while the token verifies; a tablet on a
 * counter must not flash white, so it wears the same `boat-mode` ground the
 * console does.
 *
 * Each bar is the line box it stands in for — the name `text-[2rem]`, the date
 * `text-[1.25rem]`, the prompt `text-[1.75rem]`, the label `text-[1.5rem]`,
 * all `leading-tight` — then the `min-h-16` box and the 56px `boat` button.
 * The console centres in what the header leaves, so a short bar anywhere
 * moves it when the token verifies (K-531).
 */
export default function KioskCheckInLoading() {
  return (
    <main className="boat-mode mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-8 sm:px-10 sm:py-12">
      <div className="flex flex-1 animate-pulse flex-col">
        {/* The page's header row, class for class: at 390 the name and the
            date stack, and the console centres in what the header leaves. */}
        <div className="flex flex-wrap items-baseline-last justify-between gap-x-8 gap-y-2">
          <div className="h-10 w-64 max-w-full rounded bg-surface-sunken" />
          <div className="h-[1.5625rem] w-32 rounded bg-surface-sunken" />
        </div>
        {/* Same centred block the page paints into, so the console does not
            jump up the glass when the token finishes verifying. */}
        <div className="flex flex-1 flex-col justify-center py-6">
          <div className="h-[2.1875rem] w-40 rounded bg-surface-sunken" />
          <div className="mt-8 h-[1.875rem] w-32 rounded bg-surface-sunken" />
          <div className="mt-4 h-16 w-full rounded-lg bg-surface-sunken" />
          <div className="mt-4 h-14 w-44 rounded-lg bg-surface-sunken" />
        </div>
      </div>
    </main>
  );
}
