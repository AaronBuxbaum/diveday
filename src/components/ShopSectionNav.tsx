"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { DiveDayIcon, StaffDestinationIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";
import { MENU_PANEL } from "@/components/ui/menu";
import { SEGMENT_CORNER } from "@/components/ui/segmented";
import { useExitAnimation } from "@/components/useExitAnimation";
import { useMenuDismissal } from "@/components/useMenuDismissal";
import { motionMs } from "@/lib/motion";
import {
  currentStaffSection,
  isStaffDestinationPage,
  STAFF_DESTINATION_BADGE_TONES,
  STAFF_PHONE_TABS,
  type StaffDestinationGates,
  type StaffNavItem,
  type StaffSection,
  staffDestinationHref,
} from "@/lib/staff-destinations";

/**
 * **The staff nav: the shop's sections, by name, always on screen** — ADR
 * 20261001-logbook, decision 1.
 *
 * Two forms of one nav, in one file because they read one registry and one
 * copy record and may not disagree: a labelled sidebar from `lg` up, and a
 * bottom tab bar below it whose fifth slot, More, holds the sections a phone
 * reaches for least.
 *
 * A staff component takes its words as props; `staffTranslator` is
 * server-side only.
 */
export type ShopSectionNavCopy = {
  navAriaLabel: string;
  sections: Record<StaffSection, string>;
  more: string;
  /** The blocked count's noun, already pluralised for the number it carries. */
  blockedLabel: string;
};

type NavProps = {
  root: string;
  gates: StaffDestinationGates;
  items: readonly StaffNavItem[];
  /** Divers held back by medical review, badged on Today. */
  blocked?: number;
  copy: ShopSectionNavCopy;
};

/**
 * What a lit row says about itself: `"page"` only when its own link opens the
 * page being read, `"true"` when the reader is somewhere inside the section
 * (#1938).
 */
function rowAriaCurrent(
  active: boolean,
  pathname: string,
  root: string,
  item: StaffNavItem,
): "page" | "true" | undefined {
  if (!active) return undefined;
  return isStaffDestinationPage(pathname, root, item.destination) ? "page" : "true";
}

const subscribeNever = () => () => {};

/**
 * **A key that changes once, the moment hydration is over** (issue #2273).
 *
 * Both navs stream in under their own `<Suspense>`, so a staffer quick off the
 * mark can click a link before they hydrate. They then hydrate against the
 * address the click moved to, over HTML the server wrote for the one it left,
 * and React does not patch an attribute or a class that differs at hydration:
 * the old row stayed lit and `aria-current` kept naming the page left behind.
 * Keyed on this, each nav is drawn afresh right after hydrating, from the
 * address as it is.
 */
function useHydratedKey(): string {
  return useSyncExternalStore(
    subscribeNever,
    () => "client",
    () => "server",
  );
}

function BlockedBadge({ count, label }: { count: number; label: string }) {
  return (
    <Badge
      tone={STAFF_DESTINATION_BADGE_TONES.blockers}
      size="sm"
      tabularNums
      // A count, not a status: the tone and the digit say it.
      toneMark={false}
      className="ms-auto px-1.5 py-0"
    >
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{label}</span>
    </Badge>
  );
}

// 44px, the floor every other row a hand can reach stands at (principles.md
// §2): the sidebar shows from `lg` up, and 1024px is a tablet held in the
// hand as often as a desk (UX audit 2026-10-07, item 37).
const sidebarRowClass = `flex min-h-11 items-center gap-3 ${SEGMENT_CORNER} px-3 text-sm transition-colors`;

/**
 * The sidebar, from `lg` up: every section as a row with its icon and its
 * name, Settings at the foot. It sticks under the bar and scrolls with
 * nothing, so the shop's map never leaves the screen.
 */
export function ShopSidebar({ root, gates, items, blocked, copy }: NavProps) {
  const hydratedKey = useHydratedKey();
  const pathname = usePathname() ?? "";
  const current = currentStaffSection(pathname, root, gates);
  const main = items.filter((item) => item.section !== "settings");
  const foot = items.filter((item) => item.section === "settings");
  const row = (item: StaffNavItem) => {
    const active = item.section === current;
    return (
      <li key={item.section}>
        <Link
          href={staffDestinationHref(root, item.destination)}
          aria-current={rowAriaCurrent(active, pathname, root, item)}
          className={`${sidebarRowClass} ${
            active
              ? "bg-primary-tint font-semibold text-primary"
              : "font-medium text-muted hover:bg-surface-sunken hover:text-foreground"
          }`}
        >
          <StaffDestinationIcon id={item.destination.id} className="size-5 shrink-0" />
          {copy.sections[item.section]}
          {item.destination.badge && blocked ? (
            <BlockedBadge count={blocked} label={copy.blockedLabel} />
          ) : null}
        </Link>
      </li>
    );
  };
  return (
    <nav
      key={hydratedKey}
      aria-label={copy.navAriaLabel}
      className="flex h-full flex-col justify-between gap-4 px-3 py-4"
    >
      <ul className="space-y-0.5">{main.map(row)}</ul>
      {foot.length > 0 ? <ul className="space-y-0.5">{foot.map(row)}</ul> : null}
    </nav>
  );
}

const tabClass =
  "flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors";

/**
 * The phone's tab bar, below `lg`: Today, Schedule, Divers and Inbox, then
 * More for the rest. Fixed to the foot, and `--tabbar-h` tells everything else
 * that sits there (a toast, a sticky Save bar) how far to stand off it.
 *
 * `data-staff-chrome` lets the live manifest hide it with the bar, because a
 * roll call owns the whole phone.
 */
export function ShopTabBar({ root, gates, items, blocked, copy }: NavProps) {
  const hydratedKey = useHydratedKey();
  const pathname = usePathname() ?? "";
  const current = currentStaffSection(pathname, root, gates);
  const tabs = items.filter((item) =>
    (STAFF_PHONE_TABS as readonly StaffSection[]).includes(item.section),
  );
  const rest = items.filter(
    (item) => !(STAFF_PHONE_TABS as readonly StaffSection[]).includes(item.section),
  );
  const moreActive = rest.some((item) => item.section === current);
  return (
    <nav
      key={hydratedKey}
      aria-label={copy.navAriaLabel}
      data-staff-tabbar=""
      data-staff-chrome="true"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden"
    >
      <ul className="mx-auto flex h-(--tabbar-h) max-w-xl items-stretch">
        {tabs.map((item) => {
          const active = item.section === current;
          return (
            <li key={item.section} className="flex min-w-0 flex-1">
              <Link
                href={staffDestinationHref(root, item.destination)}
                aria-current={rowAriaCurrent(active, pathname, root, item)}
                className={`${tabClass} ${
                  active ? "font-semibold text-primary" : "font-medium text-muted"
                }`}
              >
                <span className="relative">
                  <StaffDestinationIcon id={item.destination.id} className="size-6" />
                  {item.destination.badge && blocked ? (
                    // A dot over the icon's corner: the digit would crowd a
                    // 64px tab. The sentence follows the name, for a screen
                    // reader.
                    <span
                      aria-hidden="true"
                      className="absolute -top-0.5 -end-1 size-2.5 rounded-full border-2 border-surface bg-danger"
                    />
                  ) : null}
                </span>
                <span className="max-w-full truncate">{copy.sections[item.section]}</span>
                {item.destination.badge && blocked ? (
                  <span className="sr-only"> {copy.blockedLabel}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
        {rest.length > 0 ? (
          <li className="flex min-w-0 flex-1">
            <MoreMenu
              root={root}
              items={rest}
              current={current}
              active={moreActive}
              pathname={pathname}
              copy={copy}
            />
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

function MoreMenu({
  root,
  items,
  current,
  active,
  pathname,
  copy,
}: {
  root: string;
  items: readonly StaffNavItem[];
  current: StaffSection | null;
  active: boolean;
  pathname: string;
  copy: ShopSectionNavCopy;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useMenuDismissal({ open, close, inside: [rootRef], returnFocus: triggerRef });
  // Matches .animate-scale-out in globals.css — the two must move together.
  const { mounted, closing } = useExitAnimation(open, motionMs("base"));
  return (
    <div ref={rootRef} className="relative flex flex-1">
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
        className={`${tabClass} cursor-pointer ${
          active ? "font-semibold text-primary" : "font-medium text-muted"
        }`}
      >
        <DiveDayIcon name="more" className="size-6" />
        <span>{copy.more}</span>
      </button>
      {mounted ? (
        <ul
          className={`absolute end-2 bottom-full mb-2 min-w-48 ${MENU_PANEL} ${closing ? "animate-scale-out" : "animate-scale-in"}`}
        >
          {items.map((item) => {
            const lit = item.section === current;
            return (
              <li key={item.section}>
                <Link
                  href={staffDestinationHref(root, item.destination)}
                  onClick={close}
                  aria-current={rowAriaCurrent(lit, pathname, root, item)}
                  className={`flex min-h-11 items-center gap-3 ${SEGMENT_CORNER} px-3 text-sm ${
                    lit
                      ? "bg-primary-tint font-semibold text-primary"
                      : "font-medium text-foreground"
                  }`}
                >
                  <StaffDestinationIcon id={item.destination.id} className="size-5" />
                  {copy.sections[item.section]}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
