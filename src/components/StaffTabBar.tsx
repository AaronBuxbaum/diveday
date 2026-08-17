"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  MoreGroups,
  MoreLink,
  type ShopNavCounts,
  type ShopNavGates,
} from "@/components/ShopNavLinks";
import { StaffDestinationIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";
import { useMenuDismissal } from "@/components/useMenuDismissal";
import {
  currentStaffNavDestinationId,
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
 * The sixth slot is **More** — the door to everything beyond the five tabs
 * (ADR 20260813-more-is-the-shops-other-door). It opens a bottom sheet rising
 * from the dock itself, carrying the same "Run the shop" / "Set up" groups
 * the desktop header's More menu holds, rendered by the same components
 * (MoreGroups/MoreLink), so the whole shop is reachable in two thumb-taps
 * without the dock growing past what 390px can hold. Before this sheet, the
 * only phone route to fourteen destinations was knowing ⌘K existed — a
 * desktop-keyboard answer to a phone-thumb question.
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
  closeOutLabel,
  navAriaLabel,
  badgeLabels,
  moreLabel,
  groupDailyLabel,
  groupSetupLabel,
}: {
  root: string;
  gates: ShopNavGates;
  counts?: ShopNavCounts;
  labels: StaffDestinationLabels;
  /** Compact dock word; the header/palette keep the full destination label. */
  closeOutLabel: string;
  navAriaLabel: string;
  badgeLabels: Record<StaffDestinationBadge, string>;
  /** The sixth slot's word — same key the header's More menu wears. */
  moreLabel: string;
  /** Heading over the day-to-day half of the More sheet. */
  groupDailyLabel: string;
  /** Heading over the configure-once half. */
  groupSetupLabel: string;
}) {
  const pathname = usePathname();
  const destinations = staffNavDestinations("primary", gates);
  const daily = staffNavDestinations("daily", gates);
  const setup = staffNavDestinations("setup", gates);
  // The same single answer the header computes: at most one thing anywhere
  // reads as current, and a page from the More groups lights the More slot.
  const currentId = currentStaffNavDestinationId(pathname, root, gates);
  const moreIsCurrent = [...daily, ...setup].some((destination) => destination.id === currentId);
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const groupId = useId();
  const sheetId = `${groupId}-sheet`;

  // The sheet dismisses like every other disclosed menu — outside tap,
  // Escape-with-focus-return, close on navigation — via the one shared
  // contract (useMenuDismissal). A tap on another dock tab both closes the
  // sheet (pointerdown) and navigates (click), so no second tap is owed.
  const closeSheet = useCallback(() => setMoreOpen(false), []);
  useMenuDismissal({
    open: moreOpen,
    close: closeSheet,
    inside: [sheetRef, moreButtonRef],
    returnFocus: moreButtonRef,
  });

  // The scrim promises a modal layer, so deliver one: while the sheet is
  // open the page behind it must not scroll out from under the reader (a
  // trackpad flick over the scrim used to scroll the dimmed document, losing
  // their place on a page they never meant to touch).
  useEffect(() => {
    if (!moreOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const firstFocusable = sheetRef.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();

    return () => {
      document.body.style.overflow = previous;
    };
  }, [moreOpen]);

  const trapSheetFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = [
      ...(sheetRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []),
    ];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const tabClass = (active: boolean) =>
    `flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-0.5 pt-1.5 pb-1 transition-colors duration-200 ${
      active ? "text-primary" : "text-muted hover:text-foreground"
    }`;
  // The active pill is the same grammar the header tabs speak (bg-primary/10
  // behind a primary label) — shape + color, so the current tab never reads
  // by hue alone.
  const pillClass = (active: boolean) =>
    `relative flex h-7 w-12 items-center justify-center rounded-full ${
      active ? "bg-primary/10" : ""
    }`;

  return (
    // The nav itself is only the fixed slab; the visible bar lives on the
    // inner wrapper below. The split is what keeps the scrim honest: a
    // negative-z child paints *after* its parent's own background (the nav is
    // a stacking context — fixed, z-30 — and CSS paints root background, then
    // negative-z children, then in-flow content), so a background up here
    // would be dimmed by the very scrim meant to stop at the page.
    <nav aria-label={navAriaLabel} className="fixed inset-x-0 bottom-0 z-30 print:hidden lg:hidden">
      {moreOpen ? (
        // The scrim dims the page, not the dock: it paints after nothing but
        // the nav's (empty) background, and the bar wrapper's own surface
        // paints over it, so everything above the dock recedes while the bar
        // stays crisp. Purely presentational — the pointerdown-outside
        // handler is what dismisses, so a tap here (or on another dock tab)
        // closes the sheet.
        <div
          aria-hidden="true"
          className="fixed inset-0 -z-10 animate-fade-in bg-foreground/30 backdrop-blur-sm"
        />
      ) : null}
      {/* Solid surface first, glass only where backdrop-filter exists: at 85%
          with no blur, the operational text scrolling beneath (often a danger
          sentence on Today) stays legible through the bar. The safe-area pad
          is dormant until the app ever ships `viewport-fit=cover` — kept so
          the dock doesn't sit under a home indicator the day it does. */}
      <div className="relative border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] backdrop-blur-xl supports-[backdrop-filter]:bg-surface/95">
        <ul className="mx-auto flex w-full max-w-xl items-stretch">
          {destinations.map((destination) => {
            const href = staffDestinationHref(root, destination);
            const active = destination.id === currentId;
            const count = destination.badge ? counts?.[destination.badge] : undefined;
            return (
              <li key={destination.id} className="min-w-0 flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  aria-label={labels[destination.id]}
                  className={tabClass(active)}
                >
                  <span className={pillClass(active)}>
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
                    {destination.id === "closeOut" ? closeOutLabel : labels[destination.id]}
                  </span>
                </Link>
              </li>
            );
          })}
          {daily.length + setup.length === 0 ? null : (
            <li className="min-w-0 flex-1">
              <button
                type="button"
                ref={moreButtonRef}
                onClick={() => setMoreOpen((current) => !current)}
                onKeyDown={(event) => {
                  if (event.key !== "Tab" || !moreOpen) return;
                  const focusable = [
                    ...(sheetRef.current?.querySelectorAll<HTMLElement>(
                      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
                    ) ?? []),
                  ];
                  const first = focusable[0];
                  const last = focusable[focusable.length - 1];
                  if (!first || !last) return;
                  if (event.shiftKey) {
                    event.preventDefault();
                    last.focus();
                  } else {
                    event.preventDefault();
                    first.focus();
                  }
                }}
                aria-expanded={moreOpen}
                aria-controls={moreOpen ? sheetId : undefined}
                // When the current page lives behind this door, say so in the
                // tree, not just in color: the five tabs' aria-current="page"
                // needs this counterpart or a screen reader on /close-out hears
                // five non-current tabs and nothing current anywhere.
                aria-current={moreIsCurrent ? "true" : undefined}
                // The stable hook the e2e specs open the sheet by, like the
                // identity menu's `data-identity-menu`.
                data-dock-more
                className={`${tabClass(moreOpen || moreIsCurrent)} cursor-pointer`}
              >
                <span className={pillClass(moreOpen || moreIsCurrent)}>
                  {/* Not a destination, so not in StaffDestinationIcon: the
                    ellipsis every mobile tab bar spells "More" with. */}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-6"
                  >
                    <circle cx="5" cy="12" r="1" />
                    <circle cx="12" cy="12" r="1" />
                    <circle cx="19" cy="12" r="1" />
                  </svg>
                </span>
                <span className="max-w-full truncate text-xs font-medium leading-tight">
                  {moreLabel}
                </span>
              </button>
            </li>
          )}
        </ul>
      </div>
      {moreOpen ? (
        // The sheet rises from the dock itself — bottom-anchored, where the
        // thumb already is, never a dropdown from the far top edge. Same
        // rows, same groups, same components as the desktop More menu. In the
        // DOM it *follows* the bar, so Tab from the More button walks into
        // the rows it just disclosed (the desktop menu's summary→panel order,
        // kept here even though the sheet renders above the bar).
        <div
          id={sheetId}
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${sheetId}-heading`}
          onKeyDown={trapSheetFocus}
          className="rise-in absolute inset-x-0 bottom-full max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-t-2xl border-t border-border bg-surface shadow-xl"
        >
          <div className="mx-auto w-full max-w-xl p-3 pb-2">
            <h2 id={`${sheetId}-heading`} className="sr-only">
              {moreLabel}
            </h2>
            <MoreGroups
              daily={daily}
              setup={setup}
              groupId={groupId}
              copy={{ groupDaily: groupDailyLabel, groupSetup: groupSetupLabel }}
              renderLink={(destination) => (
                <MoreLink
                  key={destination.id}
                  destination={destination}
                  root={root}
                  active={destination.id === currentId}
                  label={labels[destination.id]}
                  count={destination.badge ? counts?.[destination.badge] : undefined}
                  badgeLabel={destination.badge ? badgeLabels[destination.badge] : undefined}
                  onNavigate={closeSheet}
                />
              )}
            />
          </div>
        </div>
      ) : null}
    </nav>
  );
}
