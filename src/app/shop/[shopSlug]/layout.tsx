import { Suspense } from "react";
import {
  ShopChrome,
  ShopChromeSkeleton,
  ShopSidebarSkeleton,
  ShopSidebarSlot,
} from "./_components/ShopChrome";

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
      {/* The page beside the sidebar from `lg` up (ADR 20261001-logbook). The
          sidebar is its own boundary, holding its width while it streams, so
          the page never shifts sideways when the nav arrives. Below `lg` the
          tab bar is fixed to the foot and `--tabbar-h` pads the page clear of
          it. */}
      <div className="flex min-h-0 flex-1">
        <Suspense fallback={<ShopSidebarSkeleton />}>
          <ShopSidebarSlot params={params} />
        </Suspense>
        <div
          id="shop-main-content"
          tabIndex={-1}
          className="min-h-0 min-w-0 flex-1 pb-(--tabbar-h) outline-none"
        >
          {children}
        </div>
      </div>
    </>
  );
}
