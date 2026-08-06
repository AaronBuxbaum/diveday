"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SETTINGS_DESTINATIONS,
  SETTINGS_GROUPS,
  type SettingsDestinationId,
  type SettingsGroupId,
} from "../settings-destinations";

/**
 * The settings surface's sub-nav (surface-consolidation task T3): a Settings
 * hub plus its seven full-page surfaces (Team, Website embed, Calendar
 * subscriptions, WhatsApp, Backups, Import, Export), each of which used to
 * hand-roll its own "Back to settings" button and had no way to move
 * sideways to a sibling surface. Grouping and order come from
 * `settings-destinations.ts` — the same registry `SettingsPage.tsx`'s hub
 * groups derive from — so the two can never disagree about which group a
 * surface belongs to.
 *
 * Reads the active item from the pathname, matching `WaiversSubNav.tsx`'s and
 * `PublicShopNav.tsx`'s pattern, so it can live in the shared layout without
 * re-rendering on every tab switch.
 */
export type SettingsSubNavCopy = {
  ariaLabel: string;
  hub: string;
  groupLabels: Record<SettingsGroupId, string>;
  destinationLabels: Record<SettingsDestinationId, string>;
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

  // Groups in `SETTINGS_GROUPS`' own order, each carrying the destinations
  // registered under it (also in registry order); a group with no
  // destination today (Money) renders no row.
  const groupRows = SETTINGS_GROUPS.map((group) => ({
    group,
    items: SETTINGS_DESTINATIONS.filter((destination) => destination.groupId === group.id).map(
      (destination): SettingsNavItem => ({
        key: destination.id,
        href: `${root}/${destination.path}`,
        label: copy.destinationLabels[destination.id],
      }),
    ),
  })).filter((row) => row.items.length > 0);

  const current = activeSettingsNavKey(pathname, [
    hubItem,
    ...groupRows.flatMap((row) => row.items),
  ]);

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
      {groupRows.map(({ group, items }) => (
        <div key={group.id} className="flex flex-wrap items-center gap-2">
          <span className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">
            {copy.groupLabels[group.id]}
          </span>
          {items.map(renderItem)}
        </div>
      ))}
    </nav>
  );
}
