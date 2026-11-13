import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";

/**
 * **Your sites / DiveDay catalog, as one toggle** on both views, in place of a
 * breadcrumb back out of the catalog. The two are the same kind of thing, a
 * list of sites on a map; one is the shop's own and one is DiveDay's.
 */
export function SiteLibraryViews({
  shopSlug,
  current,
  t,
}: {
  shopSlug: string;
  current: "library" | "catalog";
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
        { key: "library", label: t("diveSites.list.viewLibrary"), href: library },
        { key: "catalog", label: t("diveSites.list.viewCatalog"), href: `${library}?view=catalog` },
      ]}
    />
  );
}
