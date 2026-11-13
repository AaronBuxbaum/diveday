import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { type SiteListFilters, siteListHref } from "@/features/dive-sites";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";

/**
 * **Your sites / DiveDay catalog, as one toggle** on both views, in place of a
 * breadcrumb back out of the catalog. The two are the same kind of thing, a
 * list of sites on a map; one is the shop's own and one is DiveDay's. The
 * search and chips travel across it: they mean the same in both.
 */
export function SiteLibraryViews({
  shopSlug,
  current,
  carry = {},
  t,
}: {
  shopSlug: string;
  current: "library" | "catalog";
  carry?: { q?: string } & Pick<SiteListFilters, "difficulty" | "need">;
  t: StaffTranslator;
}) {
  const library = shopPath(shopSlug, "dive-sites");
  return (
    <SegmentedControl
      className="my-4"
      ariaLabel={t("diveSites.list.viewsLabel")}
      currentKey={current}
      ariaCurrentValue="true"
      scroll={false}
      items={[
        {
          key: "library",
          label: t("diveSites.list.viewLibrary"),
          href: siteListHref(library, carry),
        },
        {
          key: "catalog",
          label: t("diveSites.list.viewCatalog"),
          href: siteListHref(library, { ...carry, view: "catalog" }),
        },
      ]}
    />
  );
}
