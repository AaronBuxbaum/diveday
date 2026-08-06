import { permanentRedirect } from "next/navigation";
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
 * Two rules this stub still obeys, short as it is:
 *
 * - **It re-checks the session server-side** (ADR-0006), rather than trusting
 *   the edge proxy to have done it. A redirect discloses little, but "this
 *   route is only a redirect" is exactly the reasoning by which a `/shop/**`
 *   route ends up as the one that skipped the recheck. (`blockers/page.tsx`,
 *   the redirect this one is modelled on, still has that gap; it is not this
 *   change's to close.) *Authorization* stays where it belongs: the target
 *   re-runs `canPersonExportShopData` on arrival, so a captain following an
 *   old bookmark gets the refusal rather than a hole.
 * - **The target is built from the session's own slug, not the URL's** —
 *   symmetric with `settings/export/actions.ts`. A cross-shop bookmark then
 *   lands on the reader's own data-out page instead of the shop shell's
 *   `notFound()`.
 */
export default async function BackupSettingsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [session, query] = await Promise.all([requireStaffSession(), searchParams]);
  const carried = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") carried.append(key, value);
    else if (Array.isArray(value)) for (const one of value) carried.append(key, one);
  }
  const search = carried.toString();
  permanentRedirect(
    `/shop/${session.user.shopSlug}/settings/export${search ? `?${search}` : ""}#backups`,
  );
}
