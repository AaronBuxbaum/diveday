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
 * hub plus its six full-page surfaces (Team, Website embed, Calendar
 * subscriptions, WhatsApp, Import, Export), each of which used to
 * hand-roll its own "Back to settings" button and had no way to move
 * sideways to a sibling surface. Grouping and order come from
 * `settings-destinations.ts` — the same registry `SettingsPage.tsx`'s hub
 * groups derive from — so the two can never disagree about which group a
 * surface belongs to.
 *
 * Reads the active item from the pathname, matching `WaiversSubNav.tsx`'s and
 * `PublicShopNav.tsx`'s pattern, so it can live in the shared layout without
 * re-rendering on every tab switch.
 *
 * **On the hub this is a quiet anchor row, not the card.** The hub is a
 * directory now — every destination this card would list renders 400px lower
 * as a door row with a better description, so the full card there was the
 * page's own contents repeated above its `<h1>` (and on a phone it was the
 * entire first viewport). On the hub only the three group names render, as
 * plain same-document anchors into the sections they name; the grouped pill
 * card appears on the six sub-pages, where "back to the hub / sideways to a
 * sibling" is real work it does.
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

  // Whether the hub itself is the page being read — which is what decides
  // whether this nav is the way *around* the page (three quiet anchors) or
  // the way *back and sideways* from a sub-page (the grouped pill card).
  const onHub = pathname === root;

  if (onHub) {
    return (
      // Same column as the hub's own `<main>` (max-w-3xl), so the anchors sit
      // on the page's left edge; `-ml-3` cancels the first pill's own padding
      // so its label lines up optically with the `<h1>` beneath.
      <div className="mx-auto w-full max-w-3xl px-4 pt-8 sm:px-6 sm:pt-10 print:hidden">
        <nav aria-label={copy.ariaLabel} className={`-ml-3 flex flex-wrap gap-1 ${className}`}>
          {SETTINGS_GROUPS.map((group) => (
            // A same-document anchor, which the browser handles itself: no
            // re-render, no refetch, works before JavaScript arrives — the
            // same reasoning the retired `JumpNav` recorded.
            <a
              key={group.id}
              href={`#${group.id}`}
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-muted transition-colors duration-200 hover:bg-surface-sunken hover:text-foreground"
            >
              {copy.groupLabels[group.id]}
            </a>
          ))}
        </nav>
      </div>
    );
  }

  // Groups in `SETTINGS_GROUPS`' own order, each carrying the destinations
  // registered under it (also in registry order). A group with no destination
  // today (Money) renders no row here — its section lives on the hub.
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
    // Hover is a weaker tint than the active pill's solid fill + shadow —
    // a hovered sibling must never read as "you are here".
    const cls = `${itemClass} ${
      active
        ? "bg-surface text-primary shadow-sm"
        : "text-muted hover:bg-surface/60 hover:text-foreground"
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
    <div className="mx-auto w-full max-w-5xl px-4 pt-8 sm:px-6 sm:pt-10 print:hidden">
      <nav
        aria-label={copy.ariaLabel}
        className={`flex flex-col gap-3 rounded-2xl border border-border bg-surface-sunken p-3 ${className}`}
      >
        {/* The way back to the hub. */}
        <div className="flex flex-wrap gap-2">{renderItem(hubItem)}</div>
        {/* The group name sits on its own line, above the pills it owns — not
          beside them. Inline, a 12px uppercase caption and a 14px semibold pill
          shared a line at two different weights, and on a phone the pills
          wrapped out from under their own caption: "Data & integrations" ended
          three lines above the last thing that belonged to it. A caption and an
          indented row underneath says which pills are whose at any width. */}
        {groupRows.map(({ group, items }) => (
          <div key={group.id} className="flex flex-col gap-1">
            <span className="px-2 text-xs font-semibold tracking-wide text-muted uppercase">
              {copy.groupLabels[group.id]}
            </span>
            <div className="flex flex-wrap gap-2">{items.map(renderItem)}</div>
          </div>
        ))}
      </nav>
    </div>
  );
}
