/**
 * Board-shaped skeleton for `/board/[token]` — the header line, then three
 * rows the height a departure takes at display size. Painted while the token
 * verifies and the day reads; a screen on a wall must not flash white in
 * between, so it wears the same `boat-mode` ground the board does.
 *
 * The bars are the page's line boxes, step for step: the name is
 * `text-[2rem]`/`lg:text-[2.75rem]` at `leading-tight` (40px, 55px), the date
 * `text-[1.5rem]`/`lg:text-[1.75rem]` (30px, 35px). A card is a departure as
 * the seeded board draws one — 270px stacked on a phone, where its title
 * wraps, 235px stacked on a portrait tablet, 163px across three columns from
 * `lg` — so the first card paints where it lands (K-468: it painted 15px high
 * at 1280, and every card grew 19px when the board arrived).
 */
export default function BoardLoading() {
  return (
    <main className="boat-mode flex min-h-screen flex-col bg-background px-6 py-6 text-foreground sm:px-10 sm:py-8 lg:px-14 lg:py-12">
      <div className="animate-pulse">
        {/* The page's header row, class for class: at 390 the name and the
            date stack, and so do these. An empty bar's baseline is its bottom
            edge, so on one row the two bars stand on one line. */}
        <div className="flex flex-wrap items-baseline-last justify-between gap-x-8 gap-y-2">
          <div className="h-10 w-72 max-w-full rounded bg-surface-sunken lg:h-[3.4375rem]" />
          <div className="h-[1.875rem] w-40 rounded bg-surface-sunken lg:h-[2.1875rem]" />
        </div>
        <div className="mt-8 grid gap-4 lg:mt-10 lg:gap-5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[16.875rem] rounded-panel border border-border bg-surface sm:h-[14.6875rem] lg:h-[10.1875rem]"
            />
          ))}
        </div>
      </div>
    </main>
  );
}
