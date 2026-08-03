import { permanentRedirect } from "next/navigation";

/**
 * Not ready is no longer a page: it is the shop home's **by-departure view** of
 * the one work queue (`?view=departures`). This route stays only to keep the
 * links that already exist working — a bookmark, a `?page=` deep link into a
 * busy week, an old chat message.
 *
 * A permanent redirect, because the move is permanent: the surface ran
 * byte-for-byte the same queries as Today and re-ranked them, which is the
 * separate attention route ADR 20260720-today-work-queue rejected when Today
 * was designed. `?page=` is carried across rather than dropped — landing a
 * bookmarked page 3 on page 1 is the silent kind of "it still works" that
 * makes staff re-hunt for a departure they had already found.
 */
export default async function BlockersRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ shopSlug }, { page }] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams({ view: "departures" });
  // Only a real page beyond the first is worth carrying; `page=1`, `page=0`,
  // and `page=banana` all mean "the start of the queue", which is the default.
  const requested = Number.parseInt(page ?? "", 10);
  if (Number.isFinite(requested) && requested > 1) query.set("page", String(requested));
  permanentRedirect(`/shop/${shopSlug}?${query.toString()}`);
}
