/**
 * The staff subtree's page frame (design principle 1) — the shop home's own
 * skeleton, and the floor every `/shop/[shopSlug]` descendant falls back to.
 *
 * Deliberately generic, and that is the interesting part. A `loading.tsx`
 * covers its own segment *and* everything below it, so this is also what paints
 * while `trips/[id]/layout.tsx` or `waivers/layout.tsx` resolve their sub-nav —
 * those two stay async by decision (ADR 20260803-instant-opt-out-placement's
 * amendment) and sit above their own segment's skeleton. A home-shaped frame,
 * stat row and all, would therefore flash a glimpse of Today on the way to a
 * trip. An eyebrow, a title, and a stack of cards is the shape every staff
 * surface genuinely shares, so the transition reads as "this page is arriving"
 * rather than as a different page briefly appearing.
 *
 * Every staff route that can say something more specific already does — see the
 * `loading.tsx` beside each of them.
 */
export default function ShopSurfaceLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-56 rounded bg-surface-sunken" />
        <div className="mt-2 h-4 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-8 flex flex-col gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 rounded-xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
