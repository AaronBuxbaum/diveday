"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The settings surface's sub-nav (surface-consolidation task T3): a Settings
 * hub plus its seven full-page surfaces (Team, Website embed, Calendar
 * subscriptions, WhatsApp, Backups, Import, Export), each of which used to
 * hand-roll its own "Back to settings" button and had no way to move
 * sideways to a sibling surface. Grouped to mirror the hub's own group
 * order (`SETTINGS_GROUPS` in `SettingsPage.tsx`) — "Your shop" then
 * "Data & integrations"; nothing here currently lives under "Money", so that
 * group has no row.
 *
 * Reads the active item from the pathname, matching `WaiversSubNav.tsx`'s and
 * `PublicShopNav.tsx`'s pattern, so it can live in the shared layout without
 * re-rendering on every tab switch.
 */
export type SettingsSubNavCopy = {
  ariaLabel: string;
  hub: string;
  groups: {
    yourShop: string;
    dataIntegrations: string;
  };
  team: string;
  embed: string;
  calendar: string;
  whatsapp: string;
  backup: string;
  import: string;
  export: string;
};

interface SettingsNavItem {
  key: string;
  href: string;
  label: string;
}

/**
 * Which nav item the current URL belongs to, or `null` for none.
 *
 * A plain prefix test is wrong here for the same reason as
 * `PublicShopNav.tsx`'s `activeNavIndex`: every settings sub-route starts
 * with the hub's own path, so the hub would light up on every sub-page too.
 * Longest matching href wins instead.
 */
export function activeSettingsNavKey(
  pathname: string,
  items: readonly SettingsNavItem[],
): string | null {
  let best: SettingsNavItem | null = null;
  for (const item of items) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > best.href.length)) {
      best = item;
    }
  }
  return best?.key ?? null;
}

const itemClass =
  "inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold whitespace-nowrap transition-colors duration-200";

export function SettingsSubNav({
  shopSlug,
  copy,
  className = "",
}: {
  shopSlug: string;
  copy: SettingsSubNavCopy;
  className?: string;
}) {
  const root = `/shop/${shopSlug}/settings`;
  const pathname = usePathname();

  const hubItem: SettingsNavItem = { key: "hub", href: root, label: copy.hub };
  const yourShopItems: SettingsNavItem[] = [
    { key: "team", href: `${root}/team`, label: copy.team },
  ];
  const dataItems: SettingsNavItem[] = [
    { key: "embed", href: `${root}/embed`, label: copy.embed },
    { key: "calendar", href: `${root}/calendar`, label: copy.calendar },
    { key: "whatsapp", href: `${root}/whatsapp`, label: copy.whatsapp },
    { key: "backup", href: `${root}/backup`, label: copy.backup },
    { key: "import", href: `${root}/import`, label: copy.import },
    { key: "export", href: `${root}/export`, label: copy.export },
  ];

  const current = activeSettingsNavKey(pathname, [hubItem, ...yourShopItems, ...dataItems]);

  const renderItem = (item: SettingsNavItem) => {
    const active = item.key === current;
    const cls = `${itemClass} ${
      active
        ? "bg-surface text-primary shadow-sm"
        : "text-muted hover:bg-surface hover:text-foreground"
    }`;
    return active ? (
      <span key={item.key} aria-current="page" data-tab-active="true" className={cls}>
        {item.label}
      </span>
    ) : (
      <Link key={item.key} href={item.href} className={cls}>
        {item.label}
      </Link>
    );
  };

  return (
    <nav
      aria-label={copy.ariaLabel}
      className={`flex flex-col gap-3 rounded-2xl border border-border bg-surface-sunken p-3 print:hidden ${className}`}
    >
      <div className="flex flex-wrap gap-2">{renderItem(hubItem)}</div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">
          {copy.groups.yourShop}
        </span>
        {yourShopItems.map(renderItem)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">
          {copy.groups.dataIntegrations}
        </span>
        {dataItems.map(renderItem)}
      </div>
    </nav>
  );
}
