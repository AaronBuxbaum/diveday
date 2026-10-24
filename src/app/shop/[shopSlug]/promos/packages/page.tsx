import { redirect } from "next/navigation";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/**
 * **Packages live on Promos now** (visual review 2026-10-24, A26): the list,
 * its Deletes and "Add a package" are a section of the Discounts tab, so this
 * address, kept for bookmarks and old links, lands there. Promos re-checks
 * its own payment permission and its own feature switches.
 */
export default async function DivePackagesRedirect({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  // The slug gate every staff page makes; Promos then makes its own.
  await requireShopSurface(shopSlug);
  redirect(`${shopPath(shopSlug, "promos")}#dive-packages`);
}
