"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * One destination in the diver's public header.
 *
 * Labels are resolved server-side and passed in, so this client component
 * needs no `DiverIntlProvider` (`AGENTS.md`). `usePathname()` marks the active
 * destination; the layout supplies the same translated labels as page titles.
 */
export interface PublicShopNavItem {
  href: string;
  label: string;
}

/**
 * Which destination the current URL belongs to, or `-1` for none.
 *
 * Longest matching path wins, so nested course routes mark Courses active
 * instead of Schedule. Trip routes remain under Schedule.
 *
 * Exported for its test; the component is the only production caller.
 */
export function activeNavIndex(pathname: string, items: readonly PublicShopNavItem[]): number {
  let best = -1;
  for (const [index, item] of items.entries()) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (best === -1 || item.href.length > items[best].href.length)) {
      best = index;
    }
  }
  return best;
}

// Keep labels at the 16px critical-text floor (design principle 2,
// `check:critical-text`) and controls at the 44px target. Tight phone padding
// preserves room for the three tabs beneath the shop name and language control
// (issue #2303).
const linkClass =
  "inline-flex min-h-11 items-center rounded-lg px-1.5 text-base font-medium transition-colors sm:px-3";

/**
 * Public destinations for a shop: Schedule, Courses when the shop teaches, and
 * Packages when something is on sale. Keep the map here rather than adding
 * per-page cross-links.
 *
 * Never rendered in `?embed=1` mode: the layout drops the entire header there
 * (ADR 20260726-schedule-embed), so an iframe on a shop's own site gets the
 * schedule and nothing else.
 */
export function PublicShopNav({
  ariaLabel,
  items,
  action,
}: {
  ariaLabel: string;
  items: readonly PublicShopNavItem[];
  /** A related control follows the destinations in the same wrapping flow. */
  action?: ReactNode;
}) {
  const pathname = usePathname();
  const active = activeNavIndex(pathname, items);
  return (
    <nav aria-label={ariaLabel} className="min-w-0 flex-auto">
      <ul className="flex flex-wrap items-center gap-0.5 sm:gap-1">
        {items.map((item, index) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={index === active ? "page" : undefined}
              className={`${linkClass} ${
                index === active
                  ? "bg-primary-tint text-primary"
                  : "text-muted hover:bg-surface-sunken hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          </li>
        ))}
        {action ? <li className="ms-auto ps-1 lg:ps-2">{action}</li> : null}
      </ul>
    </nav>
  );
}
