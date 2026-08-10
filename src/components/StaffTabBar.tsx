"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  isDestinationCurrent,
  type ShopNavCounts,
  type ShopNavGates,
} from "@/components/ShopNavLinks";
import { StaffDestinationIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";
import {
  STAFF_DESTINATION_BADGE_TONES,
  type StaffDestinationBadge,
  type StaffDestinationLabels,
  staffDestinationHref,
  staffNavDestinations,
} from "@/lib/staff-destinations";

/**
 * The phone dock: the staff app's primary destinations as a fixed bottom tab
 * bar, thumb-reach first (dock test, principle 2). Below `lg` this replaces
 * the header's tab strip, which used to wrap into two extra header rows on a
 * phone — every destination visible, but at the top of the screen, exactly
 * where a wet thumb isn't. From `lg` up the header row has the room and this
 * bar renders nothing (`lg:hidden`).
 *
 * Same registry, same labels, same active-destination logic as the header
 * tabs — the dock is a *position* for the primary group, not a second nav
 * that can drift. Each tab is icon-over-label, ≥44px tall, with the one badge
 * the registry declares (Today's blocked-diver count) riding the icon corner.
 *
 * Pages clear it via `--dock-clearance` on the shop layout's content wrapper;
 * fixed elements that share the bottom edge (UndoToast) add the same variable
 * to their offset, so the dock never covers what a page just said.
 */
export function StaffTabBar({
  root,
  gates,
  counts,
  labels,
  navAriaLabel,
  badgeLabels,
}: {
  root: string;
  gates: ShopNavGates;
  counts?: ShopNavCounts;
  labels: StaffDestinationLabels;
  navAriaLabel: string;
  badgeLabels: Record<StaffDestinationBadge, string>;
}) {
  const pathname = usePathname();
  const destinations = staffNavDestinations("primary", gates);
  return (
    <nav
      aria-label={navAriaLabel}
      // Solid surface first, glass only where backdrop-filter exists: at 85%
      // with no blur, the operational text scrolling beneath (often a danger
      // sentence on Today) stays legible through the bar. The safe-area pad is
      // dormant until the app ever ships `viewport-fit=cover` — kept so the
      // dock doesn't sit under a home indicator the day it does.
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] backdrop-blur-xl supports-[backdrop-filter]:bg-surface/95 print:hidden lg:hidden"
    >
      <ul className="mx-auto flex w-full max-w-xl items-stretch">
        {destinations.map((destination) => {
          const href = staffDestinationHref(root, destination);
          const active = isDestinationCurrent(pathname, root, destination);
          const count = destination.badge ? counts?.[destination.badge] : undefined;
          return (
            <li key={destination.id} className="min-w-0 flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 pt-1.5 pb-1 transition-colors duration-200 ${
                  active ? "text-primary" : "text-muted hover:text-foreground"
                }`}
              >
                {/* The active pill is the same grammar the header tabs speak
                    (bg-primary/10 behind a primary label) — shape + color, so
                    the current tab never reads by hue alone. */}
                <span
                  className={`relative flex h-7 w-12 items-center justify-center rounded-full ${
                    active ? "bg-primary/10" : ""
                  }`}
                >
                  <StaffDestinationIcon id={destination.id} className="size-6" />
                  {destination.badge && count ? (
                    <Badge
                      tone={STAFF_DESTINATION_BADGE_TONES[destination.badge]}
                      size="sm"
                      tabularNums
                      // A count riding an icon, not a status pill — the tone
                      // and the digit say it (same call as the header's badge).
                      toneMark={false}
                      className="absolute -top-1 left-full min-w-4 -translate-x-1/2 justify-center px-1 py-0 text-xs leading-4"
                    >
                      <span aria-hidden="true">{count}</span>
                      <span className="sr-only">{badgeLabels[destination.badge]}</span>
                    </Badge>
                  ) : null}
                </span>
                {/* Truncates rather than wraps: a two-line label makes the dock
                    taller for every tab because one translation ran long. The
                    full text stays in the DOM, so the accessible name is never
                    the truncated form — and a label that actually truncates at
                    390px is a locale bug to shorten in the bundle, not a
                    rendering strategy. es-ES's longest ("Buceadores") fits. */}
                <span className="max-w-full truncate text-xs font-medium leading-tight">
                  {labels[destination.id]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
