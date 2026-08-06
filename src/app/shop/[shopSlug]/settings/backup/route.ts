import type { NextRequest } from "next/server";
import { requireStaffSession } from "@/lib/session";

/**
 * Backups are no longer a page: they are the second half of the one data-out
 * surface, `/settings/export` (ADR 20260806-one-data-out-surface). This route
 * stays only to keep the links that already exist working — a bookmark, the
 * runbook, an old chat message, a `?page=` deep link into the delivery
 * history.
 *
 * A permanent redirect, because the move is permanent: scheduled delivery *is*
 * the export bundle on a schedule (`run-backup.ts` builds it from the export
 * loader) behind the identical `canPersonExportShopData` gate, so it never
 * earned a route of its own. The whole query string is carried across rather
 * than dropped, and `#backups` lands the reader on the section they were
 * looking for instead of the top of a long page — the silent kind of "it still
 * works" is what makes staff re-hunt for something they had already found.
 *
 * A Route Handler, not a `page.tsx` calling `permanentRedirect()`: under
 * `cacheComponents` a page is partially prerendered, so a redirect thrown from
 * its body answers **200** with the hop resolving in the streamed payload — a
 * browser follows it, a bookmark, a crawler, and a `curl` do not
 * (ADR 20260806-one-trip-create-form).
 *
 * Two rules this stub still obeys, short as it is:
 *
 * - **It re-checks the session server-side** (ADR-0006), rather than trusting
 *   the edge proxy to have done it. A redirect discloses little, but "this
 *   route is only a redirect" is exactly the reasoning by which a `/shop/**`
 *   route ends up as the one that skipped the recheck. *Authorization* stays
 *   where it belongs: the target re-runs `canPersonExportShopData` on arrival,
 *   so a captain following an old bookmark gets the refusal rather than a
 *   hole.
 * - **The target is built from the session's own slug, not the URL's** —
 *   symmetric with `settings/export/actions.ts`. A cross-shop bookmark then
 *   lands on the reader's own data-out page instead of the shop shell's
 *   `notFound()`.
 */
export async function GET(request: NextRequest) {
  const session = await requireStaffSession();
  const carried = new URLSearchParams();
  for (const [key, value] of request.nextUrl.searchParams) carried.append(key, value);
  const search = carried.toString();
  // A relative `Location`, by hand: `NextResponse.redirect()` demands an
  // absolute URL, and whichever host it resolves pins the visitor to that host
  // — in the e2e fleet it resolved `localhost` for a session cookied to
  // `127.0.0.1` and landed a signed-in owner on /sign-in.
  return new Response(null, {
    status: 308,
    headers: {
      Location: `/shop/${session.user.shopSlug}/settings/export${search ? `?${search}` : ""}#backups`,
    },
  });
}
