import Link from "next/link";
import { foundItemsText } from "@/i18n/lost-item-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";

/**
 * Something the crew found against this diver's seat, still waiting (fifth
 * loop, item 7): said under the header so the desk hands it over on this
 * visit. Nothing at all when nothing is waiting.
 */
export function FoundItemLine({
  shopSlug,
  items,
  t,
}: {
  shopSlug: string;
  items: readonly string[];
  t: StaffTranslator;
}) {
  if (items.length === 0) return null;
  return (
    <p className="-mt-4 mb-6 text-sm" data-testid="found-item-line">
      <Link href={shopPath(shopSlug, "lost-found")} className="hover:underline">
        {foundItemsText(t, items)}
      </Link>
    </p>
  );
}
