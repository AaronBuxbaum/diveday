import { permanentRedirect } from "next/navigation";

/**
 * The common-sites catalog is no longer a page: it is the dive-site library's
 * own **catalog view** (`?view=catalog`), folded in because it was reachable
 * from exactly two buttons on that page and nowhere else — the same move
 * 20260803-not-ready-is-a-view made for the by-departure queue. This route
 * stays only to keep the links that already exist working: a bookmark, a
 * `?page=` deep link into a long catalog, an old chat message.
 *
 * A permanent redirect, because the move is permanent. `?page=` is carried
 * across rather than dropped — landing a bookmarked page 3 on page 1 is the
 * silent kind of "it still works" that makes staff re-hunt for a template
 * they had already found.
 */
export default async function DiveSiteCatalogRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ shopSlug }, { page }] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams({ view: "catalog" });
  // Only a real page beyond the first is worth carrying; `page=1`, `page=0`,
  // and `page=banana` all mean "the start of the catalog", which is the default.
  const requested = Number.parseInt(page ?? "", 10);
  if (Number.isFinite(requested) && requested > 1) query.set("page", String(requested));
  permanentRedirect(`/shop/${shopSlug}/dive-sites?${query.toString()}`);
}
