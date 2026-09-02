"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * One destination in the diver's public header.
 *
 * Words are resolved server-side and passed in: this is a diver surface, and a
 * client component that called `useTranslations()` would need a
 * `DiverIntlProvider` above it in every `/s` layout render (AGENTS.md). Props
 * are simpler and keep the nav's labels identical to the page titles they lead
 * to, because the layout hands it the same message keys those pages use.
 */
export interface PublicShopNavItem {
  href: string;
  label: string;
}

/**
 * Which destination the current URL belongs to, or `-1` for none.
 *
 * A plain prefix test is wrong here: every public path starts with the
 * schedule's `/s/<slug>`, so the schedule would light up on the course catalog
 * too. Longest match wins instead — `/s/blue-mantis/courses/open-water` is
 * Courses, `/s/blue-mantis/trips/abc` has no closer parent than the schedule it
 * was booked from, and `/s/blue-mantis` is the schedule exactly.
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

// 16px at every width. A destination label is a control's own label, which
// design principle 2 names as critical text with a 16px floor, and
// `check:critical-text` already holds the staff dock's labels to exactly that.
// This was `text-sm` below `sm`, with a comment arguing that navigation is not
// critical text — an argument against a written rule, which is not how this
// repository disagrees with one.
//
// The pixels the restore costs are bought from padding instead: `px-1.5` below
// `sm` (and a tighter list gap) rather than smaller type, so the 44px target
// and the legibility both survive. The chrome bar is one fixed-height row at
// every width now (ADR 20260827-clearwater-surface-language, decision 10), so
// at 390px the shop's own name, these two tabs and the language control share
// 358 points — and the name, which appears nowhere else above the fold on a
// shopfront page, is the one that must not lose.
const linkClass =
  "inline-flex min-h-11 items-center rounded-lg px-1.5 text-base font-medium transition-colors sm:px-3";

/**
 * The spine of a shop's public pages — the schedule, and the course catalog
 * when there is one.
 *
 * Before this, `/s/<slug>/courses` was reachable only from inside itself: the
 * schedule never linked to it, so a diver who wanted to learn to dive had to
 * guess the URL. The header carries the whole public map instead of each page
 * growing its own cross-links. Two tabs is the whole map: a third for a page
 * most divers never need is the row-of-equals principle 8 warns about.
 *
 * Never rendered in `?embed=1` mode: the layout drops the entire header there
 * (ADR 20260726-schedule-embed), so an iframe on a shop's own site gets the
 * schedule and nothing else.
 */
export function PublicShopNav({
  ariaLabel,
  items,
}: {
  ariaLabel: string;
  items: readonly PublicShopNavItem[];
}) {
  const pathname = usePathname();
  const active = activeNavIndex(pathname, items);

  return (
    <nav aria-label={ariaLabel}>
      <ul className="flex items-center gap-0.5 sm:gap-1">
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
      </ul>
    </nav>
  );
}
