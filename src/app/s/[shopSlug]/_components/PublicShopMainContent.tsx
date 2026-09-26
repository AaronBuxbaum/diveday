import type { ReactNode } from "react";

/**
 * **The region a shop's page renders into** — the skip link's target
 * (`PublicShopChrome` and its placeholder both point at this id), between the
 * shop's header and its footer.
 *
 * Two files frame a shop's page and both render this: the segment layout, and
 * `src/app/not-found.tsx`, which composes the same frame for a dead link the
 * edge refused before the layout could run. It was spelled in each, which is
 * how a change to one could miss the other.
 *
 * **A flex column, not a block.** The body is a column and this region takes
 * its spare height (`flex-1`), so a page inside it can fill that height with
 * its own `flex-1`, the way every page under the root layout's `#main-content`
 * can. As a block box it could not: the shop's 404 asks to centre itself
 * between header and footer, and the pixel probe measured it 70px under the
 * header and 407px over the footer at 1280. Every page here is a
 * `mx-auto w-full max-w-*` main, so none shrinks to fit the column.
 */
export function PublicShopMainContent({ children }: { children: ReactNode }) {
  return (
    <div id="public-shop-main-content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
      {children}
    </div>
  );
}
