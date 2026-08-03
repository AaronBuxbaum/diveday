import Link from "next/link";
import { PublicShopNav, type PublicShopNavItem } from "@/components/PublicShopNav";
import type { DiverTranslator } from "@/i18n/messages";
import { publicSchedulePath } from "@/lib/public-routes";

/**
 * The public shop's own identity and the map of its public pages, shown on
 * every `/s/[shopSlug]` page (task 9,
 * docs/product/archive/ux-personas-20260730-findings.md). Before this, the
 * schedule's `<h1>` read "Schedule" with no shop name, logo, or contact
 * anywhere — nothing told a diver comparing two shops in another tab which one
 * they were looking at. Staff get `ShopNav` on their own namespace instead
 * (src/app/shop/[shopSlug]/layout.tsx); this is the diver-side counterpart, and
 * never renders in `?embed=1` mode, which already carries its own framing on
 * the page that embeds it.
 *
 * The header shows the shop's name and where a diver can go — nothing else.
 * Phone and email live in the footer, once: repeating them up here made the
 * top of every page a contact card and left no room for the navigation that
 * was actually missing.
 */
export function PublicShopHeader({
  shop,
  navAriaLabel,
  navItems,
}: {
  shop: { slug: string; name: string };
  navAriaLabel: string;
  navItems: readonly PublicShopNavItem[];
}) {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
        <Link
          href={publicSchedulePath(shop.slug)}
          className="inline-flex min-h-11 items-center text-lg font-semibold tracking-tight"
        >
          {shop.name}
        </Link>
        <PublicShopNav ariaLabel={navAriaLabel} items={navItems} />
      </div>
    </header>
  );
}

export function PublicShopFooter({
  shop,
  t,
}: {
  shop: { slug: string; name: string; contactEmail: string | null; contactPhone: string | null };
  t: DiverTranslator;
}) {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>{t("shopChrome.footerLine", { shop: shop.name })}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {shop.contactPhone ? (
            <a href={`tel:${shop.contactPhone}`} className="hover:text-foreground hover:underline">
              {shop.contactPhone}
            </a>
          ) : null}
          {shop.contactEmail ? (
            <a
              href={`mailto:${shop.contactEmail}`}
              className="hover:text-foreground hover:underline"
            >
              {shop.contactEmail}
            </a>
          ) : null}
        </p>
      </div>
    </footer>
  );
}
