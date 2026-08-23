"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useMenuDismissal } from "@/components/useMenuDismissal";
import {
  currentStaffNavDestinationId,
  STAFF_DESTINATION_BADGE_TONES,
  type StaffDestination,
  type StaffDestinationBadge,
  type StaffDestinationCounts,
  type StaffDestinationGates,
  type StaffDestinationId,
  type StaffDestinationLabels,
  staffDestinationHref,
  staffNavDestinations,
} from "@/lib/staff-destinations";

// `whitespace-nowrap`: a flex item can shrink below its label's width, and a
// squeezed tab must never break its word ("Check-in" as "Check-" / "in") —
// the strip only renders from `lg` up, but a crowded row is still possible
// with long translations.
const linkClass =
  "inline-flex min-h-11 items-center rounded-xl px-2 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-surface-sunken hover:text-foreground sm:px-3";

/** Owner/manager surfaces (H-14) carry a gate; everyone else always sees the link. */
export type ShopNavGates = StaffDestinationGates;

/**
 * Small "pending work" counts, server-computed on each page that already
 * tracks them — Reviews' "waiting on you" moderation queue, Blockers' count
 * of divers who can't board yet — so a badge here never runs its own extra
 * query (task 83, UX persona 11 "Kai" / persona 12 "Maren").
 */
export type ShopNavCounts = StaffDestinationCounts;

/**
 * Every word this component renders, resolved server-side. The destination
 * labels are one record keyed by registry id (src/lib/staff-destinations.ts),
 * so a new destination is a type error here until it has a word.
 */
export interface ShopNavLinksCopy {
  primaryNavAriaLabel: string;
  more: string;
  /** Heading over the day-to-day half of the "More" menu. */
  groupDaily: string;
  /** Heading over the configure-once half. */
  groupSetup: string;
  labels: StaffDestinationLabels;
  /**
   * What each badge's number counts, already pluralised for that count —
   * "3 divers blocked", "2 reviews waiting". Rendered sr-only beside the digit:
   * a bare "3" next to "Today" is a number with no noun, which is exactly what
   * a screen reader announces. Sighted staff get the same fact from the tone
   * and the tab it hangs off.
   */
  badgeLabels: Record<StaffDestinationBadge, string>;
}

function navClass(active: boolean) {
  return `${linkClass} ${active ? "bg-primary-tint text-primary" : "text-muted"}`;
}

/**
 * A count badge next to a nav label — omitted entirely at zero, never a "0"
 * pill. Tone comes from what the number means
 * (`STAFF_DESTINATION_BADGE_TONES`), not from the nav, and the number never
 * travels without a noun.
 */
function NavCountBadge({
  badge,
  count,
  label,
}: {
  badge: StaffDestinationBadge | undefined;
  count: number | undefined;
  label: string | undefined;
}) {
  if (!badge || !count) return null;
  return (
    <Badge
      tone={STAFF_DESTINATION_BADGE_TONES[badge]}
      size="sm"
      tabularNums
      // A count, not a status (see `Badge`): the tone and the digit already
      // say it, and the mark's width is what pushed a six-tab phone header
      // into a ragged second row.
      toneMark={false}
      className="ml-1.5 px-1.5 py-0"
    >
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{label}</span>
    </Badge>
  );
}

/**
 * One row inside a "More" surface — the header menu here, and the phone
 * dock's bottom sheet (StaffTabBar), which renders the identical rows so the
 * two doors can never present the same destination differently. `active`
 * comes from `currentStaffNavDestinationId` so at most one row anywhere
 * reads as current.
 */
export function MoreLink({
  destination,
  root,
  active,
  label,
  count,
  badgeLabel,
  onNavigate,
}: {
  destination: StaffDestination;
  root: string;
  active: boolean;
  label: string;
  count: number | undefined;
  badgeLabel: string | undefined;
  onNavigate: () => void;
}) {
  const href = staffDestinationHref(root, destination);
  return (
    <li className="flex">
      <Link
        href={href}
        onClick={onNavigate}
        className={`${navClass(active)} w-full whitespace-nowrap`}
        aria-current={active ? "page" : undefined}
      >
        {label}
        <NavCountBadge badge={destination.badge} count={count} label={badgeLabel} />
      </Link>
    </li>
  );
}

/** The heading over one "More" group, and the group box it labels. */
export function MoreGroup({
  id,
  heading,
  className = "",
  children,
}: {
  id: string;
  heading: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <p
        id={id}
        className="px-2 pt-1 pb-1 text-xs font-semibold tracking-wide text-muted uppercase"
      >
        {heading}
      </p>
      {/* A named list rather than a bare stack: the heading is the list's
          accessible name, so a screen reader announces "Run the shop, list, 7
          items" instead of leaving the grouping purely visual. */}
      <ul aria-labelledby={id} className="flex flex-col gap-0.5">
        {children}
      </ul>
    </div>
  );
}

/**
 * The two "More" groups as one column — shared verbatim by the header menu's
 * panel and the phone dock's bottom sheet. The setup half wears its heading
 * only once it is a genuine group: a visible heading over a single row is
 * noise, but it keeps the same accessible name either way, so a screen
 * reader still hears which half of the menu it is in.
 */
export function MoreGroups({
  daily,
  setup,
  groupId,
  copy,
  renderLink,
}: {
  daily: readonly StaffDestination[];
  setup: readonly StaffDestination[];
  groupId: string;
  copy: Pick<ShopNavLinksCopy, "groupDaily" | "groupSetup">;
  renderLink: (destination: StaffDestination) => React.ReactNode;
}) {
  return (
    <>
      {daily.length > 0 ? (
        <MoreGroup id={`${groupId}-daily`} heading={copy.groupDaily}>
          {daily.map(renderLink)}
        </MoreGroup>
      ) : null}
      {setup.length > 1 ? (
        <MoreGroup id={`${groupId}-setup`} heading={copy.groupSetup} className="mt-2">
          {setup.map(renderLink)}
        </MoreGroup>
      ) : setup.length === 1 ? (
        <ul
          aria-label={copy.groupSetup}
          className="mt-2 flex flex-col gap-0.5 border-t border-border pt-2"
        >
          {setup.map(renderLink)}
        </ul>
      ) : null}
    </>
  );
}

export function ShopNavLinks({
  root,
  gates,
  copy,
  counts,
  className = "",
}: {
  root: string;
  gates: ShopNavGates;
  copy: ShopNavLinksCopy;
  /** Omitted entirely (never shown as zero) when the caller has no counts to report. */
  counts?: ShopNavCounts;
  className?: string;
}) {
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const groupId = useId();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = staffNavDestinations("primary", gates);
  const daily = staffNavDestinations("daily", gates);
  const setup = staffNavDestinations("setup", gates);
  // One answer to "which row is current?" for the whole header (and the same
  // answer the dock computes) — most specific destination wins, so Team's row
  // lights on /settings/team without Settings' row lighting beside it.
  const currentId: StaffDestinationId | null = currentStaffNavDestinationId(pathname, root, gates);
  const moreIsActive = [...daily, ...setup].some((destination) => destination.id === currentId);
  // Stable across renders (empty deps — it only touches a ref), so effects
  // below can list it as a dependency without re-subscribing every render.
  const closeMore = useCallback(() => {
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
  }, []);

  // <details>/<summary> has no built-in outside-click or Escape dismissal —
  // on a phone the panel covers most of the viewport, so a stray tap
  // elsewhere used to leave it stuck open (task 80, UX persona 11 "Kai").
  // The native `toggle` event is the source of truth for open state (it also
  // fires for a keyboard/assistive-tech toggle, not just this component's own
  // clicks), so the shared dismissal contract only attaches while genuinely
  // open.
  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    const handleToggle = () => setMoreOpen(details.open);
    details.addEventListener("toggle", handleToggle);
    return () => details.removeEventListener("toggle", handleToggle);
  }, []);

  useMenuDismissal({
    open: moreOpen,
    close: closeMore,
    inside: [detailsRef],
    returnFocus: summaryRef,
  });

  const moreLink = (destination: StaffDestination) => (
    <MoreLink
      key={destination.id}
      destination={destination}
      root={root}
      active={destination.id === currentId}
      label={copy.labels[destination.id]}
      count={destination.badge ? counts?.[destination.badge] : undefined}
      badgeLabel={destination.badge ? copy.badgeLabels[destination.badge] : undefined}
      onNavigate={closeMore}
    />
  );

  return (
    // Display is the caller's call: below `lg` the primary destinations render
    // as the phone dock (StaffTabBar) instead, and ShopNav hands this strip
    // `hidden lg:flex` — so none of the phone-wrap layout this strip used to
    // carry survives here.
    <div className={`min-w-0 items-center gap-2 ${className}`}>
      <nav
        aria-label={copy.primaryNavAriaLabel}
        className="flex min-w-0 flex-1 items-center gap-x-1 pr-3"
      >
        {primary.map((destination) => {
          const href = staffDestinationHref(root, destination);
          const active = destination.id === currentId;
          return (
            <Link
              key={destination.id}
              href={href}
              className={navClass(active)}
              aria-current={active ? "page" : undefined}
              onClick={closeMore}
            >
              {copy.labels[destination.id]}
              <NavCountBadge
                badge={destination.badge}
                count={destination.badge ? counts?.[destination.badge] : undefined}
                label={destination.badge ? copy.badgeLabels[destination.badge] : undefined}
              />
            </Link>
          );
        })}
      </nav>
      {/* Defensive only: both groups carry ungated rows today (Close-out,
          Staffing, the calendar feed), so no role sees an empty "More" — but
          a menu over nothing must render nothing, never an empty panel. */}
      {daily.length + setup.length === 0 ? null : (
        <details ref={detailsRef} className="relative shrink-0">
          <summary
            ref={summaryRef}
            // The ARIA counterpart of the active pill: when the current page
            // lives behind this menu, the door itself says so in the tree —
            // the tabs' aria-current="page" otherwise leaves nothing current.
            aria-current={moreIsActive ? "true" : undefined}
            className={`${navClass(moreIsActive)} flex cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden`}
          >
            {copy.more}
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-3"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          {/*
           * One column, one link per row — a two-column grid wrapped short labels
           * onto two lines. Two named groups rather than one bare rule: the
           * divider that used to sit here said "these are different" without ever
           * saying how, so which half held Reports and which held Promo codes was
           * a memory test.
           */}
          <div className="absolute right-0 z-20 mt-2 flex w-[min(15rem,calc(100vw-2rem))] flex-col rounded-2xl border border-border bg-surface p-2 shadow-xl">
            <MoreGroups
              daily={daily}
              setup={setup}
              groupId={groupId}
              copy={copy}
              renderLink={moreLink}
            />
          </div>
        </details>
      )}
    </div>
  );
}
