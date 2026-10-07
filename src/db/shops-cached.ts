import { cache } from "react";
import { getDb } from "./client";
import { getShopBySlug } from "./shops";

// Apart from `./shops` because this is the one shop reader that opens the
// database itself: `./shops` is imported across the seed graph, and its
// reaching for `getDb()` put `client.ts` in an import cycle
// (`src/db/import-cycles.test.ts`). Only a render imports this.

/**
 * **The same row, read once per render** (issue #1737).
 *
 * A diver-facing `/s/**` page used to resolve its slug five times: the brand,
 * the header chrome and the footer each read it inside their own `<Suspense>`
 * boundary in `src/app/s/[shopSlug]/_components/PublicShopShell.tsx`, and the
 * page under them read it again in `generateMetadata` and once more in its
 * body. Five `select * from shops where slug = $1` for a row that cannot have
 * changed between the first and the last, against a pool capped at five
 * connections (`DEFAULT_POOL_MAX`, `src/lib/db-pool-config.ts`) — on the one
 * page a stranger loads most often. Nothing was broken by it; it was cost.
 *
 * **Why this is a second reader rather than a memo around the first.**
 * `getShopBySlug` (`./shops`) takes its executor as an argument, and several `/s/**`
 * callers hand it a *transaction* (`s/[shopSlug]/actions.ts`,
 * `trips/[id]/actions.ts`). React's `cache()` keys on argument identity, so
 * memoizing that signature would either miss on every transaction handle or,
 * far worse, serve a pool-read row to a caller that must see its own
 * transaction's snapshot. This reader takes only the slug and calls `getDb()`
 * itself — which memoizes on a global (`src/db/client.ts`), so there is no
 * reason to pass an executor through the memo boundary at all.
 *
 * **Request-scoped, never longer.** `cache()`'s memo table hangs off React's
 * per-request async dispatcher, so it is created fresh for every render and
 * cannot outlive one. A shop that edits its name sees it on the next load,
 * which is the same rule the edge check already keeps: positive results may be
 * reused within a request and never across one.
 *
 * **What it does and does not collapse.** Measured on 2026-09-12 by rendering
 * three sibling async components — each behind its own `<Suspense>`, one of
 * them nested two boundaries deep — through React 19.3's own Flight server:
 * one read, not three. A boundary is not a new scope; a *render* is. Two
 * renders read twice, and two slugs in one render read twice, which is the
 * property that keeps this honest. So the layout's three collapse to one and
 * the page's `generateMetadata` and body collapse to one — **but the layout's
 * pass and the page's pass are two scopes**, which is measured and written up
 * on `inHorizonReadiness` (`src/db/blockers.ts`, issue #1121): under Cache
 * Components the App Shell and the page it wraps render separately. Five reads
 * become two, and no `cache()` will make them one. Doing that needs the
 * layout's read hoisted into the page's pass, which is a different change.
 */
export const shopBySlugCached = cache(async (slug: string) => getShopBySlug(await getDb(), slug));
