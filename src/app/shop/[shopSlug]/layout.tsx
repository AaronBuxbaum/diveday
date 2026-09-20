import { Suspense } from "react";
import { ShopChrome, ShopChromeSkeleton } from "./_components/ShopChrome";

/**
 * Staff-surface shell. Every page below it is staff-only — the diver-facing
 * schedule, trip, and course pages that used to be carved out of this
 * namespace by an allowlist now live under `/s/[shopSlug]` with a shell of
 * their own (ADR 20260803-public-shop-namespace), so this layout no longer has
 * a signed-out branch or an embed mode to account for.
 *
 * **It is synchronous, and that is the point** (issue #1446). It used to be
 * `async` with six awaits above `{children}` — the params, the db handle, the
 * shop row and the session together, the negotiated locale, a demo-role query,
 * and the blocked-diver count with the boat link — and it declared
 * `instant = false` to be allowed them. A layout wraps its page, so no
 * `<Suspense>` can sit between the two: every one of those awaits was an await
 * the *page* waited on, on every navigation, for chrome that had not changed.
 * A staffer turning a page of the roster watched a few hundred milliseconds of
 * nothing before the skeleton they were owed appeared.
 *
 * All of it now lives in `ShopChrome`, beside `{children}` rather than above
 * it, behind a boundary that holds the bar's own height — the same shape
 * `src/app/s/[shopSlug]/layout.tsx` uses for the diver-facing shell. The page's
 * own `loading.tsx` paints immediately and the chrome streams in.
 *
 * The tenant gate moved into `ShopChrome` with the reads it protects. Read its
 * docblock before touching it: it is safe because the refusal is doubled at
 * every staff page, not because of where it sits — and closing the one hole in
 * that doubling, on the shop home, is part of this change.
 */
export default function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shopSlug: string }>;
}) {
  return (
    <>
      <Suspense fallback={<ShopChromeSkeleton />}>
        <ShopChrome params={params} />
      </Suspense>
      {/* **Nothing owns the bottom edge.** The phone dock did, so this wrapper
          published the clearance it demanded and padded itself by it, and every
          fixed element down there (the toasts, a sticky form action row) added
          the same offset. The dock left with the nav of nouns (ADR
          20260919-one-idea, slice 23b) and the clearance went with it: a page
          ends where the page ends. */}
      {/* `water-band`: Reef's page top — the lagoon wash settling into sand
          over the first 168px, behind every staff page's header (ADR
          20260901-diveday-reimagined, decision 1; the system sheet's "water
          band wash → sand · page tops only"). A wash, not a drawing, so it
          may sit behind a manifest; the swell that rides it on the home is
          the drawing, and that one stays on the home.

          The wash's *hour* (ADR 20260904-reef-all-the-way-down, decision 2,
          Budget rule 1) is four washes by the **shop's** clock, which is a
          shop read — so it can no longer be an attribute on this element,
          which wraps `{children}`. `ShopChrome` emits it as a `<style>`
          setting the same `--water-crest` this element's own class defaults;
          same property, same pixels, no request read above the page. */}
      <div id="shop-main-content" tabIndex={-1} className="water-band min-h-0 flex-1 outline-none">
        {children}
      </div>
    </>
  );
}
