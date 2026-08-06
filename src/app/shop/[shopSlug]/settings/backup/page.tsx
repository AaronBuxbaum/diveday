import { permanentRedirect } from "next/navigation";

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
 * Redirect only: no gate here, deliberately. The target re-runs
 * `canPersonExportShopData` against the database on arrival, so this route
 * discloses nothing that the target would not.
 */
export default async function BackupSettingsRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ shopSlug }, query] = await Promise.all([params, searchParams]);
  const carried = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") carried.append(key, value);
    else if (Array.isArray(value)) for (const one of value) carried.append(key, one);
  }
  const search = carried.toString();
  permanentRedirect(`/shop/${shopSlug}/settings/export${search ? `?${search}` : ""}#backups`);
}
