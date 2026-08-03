"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  STAFF_DESTINATION_BADGE_TONES,
  type StaffDestination,
  type StaffDestinationBadge,
  type StaffDestinationCounts,
  type StaffDestinationGates,
  type StaffDestinationLabels,
  staffDestinationHref,
  staffNavDestinations,
} from "@/lib/staff-destinations";

// `whitespace-nowrap`: the primary row is `flex-1` per link inside a
// horizontally scrolling, snapping strip. Without it a narrow phone shrinks
// each link below its label and breaks the word instead of scrolling —
// "Check-in" rendered as "Check-" / "in" and "Not ready" as "Not" / "ready".
const linkClass =
  "inline-flex min-h-11 items-center rounded-xl px-2 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-200 hover:bg-surface-sunken hover:text-foreground sm:px-3";

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

function isCurrent(pathname: string, href: string, root: string) {
  return href === root ? pathname === root : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Whether this destination is the page being looked at — its own path, or the
 * `alsoMatch` prefix it claims (the board claims `/trips`, Settings claims
 * `/promos`). Shared by the primary tabs, the "More" rows, and the "More"
 * button's own state: those three used to answer the question three ways, and
 * only the first knew about `alsoMatch`, so a destination reached *from* a
 * "More" page left the whole header with nothing reading as current.
 */
function isDestinationCurrent(pathname: string, root: string, destination: StaffDestination) {
  return (
    isCurrent(pathname, staffDestinationHref(root, destination), root) ||
    (destination.alsoMatch ? isCurrent(pathname, `${root}${destination.alsoMatch}`, root) : false)
  );
}

function navClass(active: boolean) {
  return `${linkClass} ${active ? "bg-primary/10 text-primary" : "text-muted"}`;
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
      className="ml-1.5 px-1.5 py-0"
    >
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{label}</span>
    </Badge>
  );
}

/** One row inside the "More" panel. */
function MoreLink({
  destination,
  root,
  pathname,
  label,
  count,
  badgeLabel,
  onNavigate,
}: {
  destination: StaffDestination;
  root: string;
  pathname: string;
  label: string;
  count: number | undefined;
  badgeLabel: string | undefined;
  onNavigate: () => void;
}) {
  const href = staffDestinationHref(root, destination);
  const active = isDestinationCurrent(pathname, root, destination);
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
function MoreGroup({
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
  const moreIsActive = [...daily, ...setup].some((destination) =>
    isDestinationCurrent(pathname, root, destination),
  );
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
  // clicks), so outside-click/Escape handlers only attach while genuinely open.
  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    const handleToggle = () => setMoreOpen(details.open);
    details.addEventListener("toggle", handleToggle);
    return () => details.removeEventListener("toggle", handleToggle);
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (detailsRef.current && !detailsRef.current.contains(event.target as Node)) {
        closeMore();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMore();
        // Return focus to the toggle, matching every other dismissible menu.
        summaryRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [moreOpen, closeMore]);

  const moreLink = (destination: StaffDestination) => (
    <MoreLink
      key={destination.id}
      destination={destination}
      root={root}
      pathname={pathname}
      label={copy.labels[destination.id]}
      count={destination.badge ? counts?.[destination.badge] : undefined}
      badgeLabel={destination.badge ? copy.badgeLabels[destination.badge] : undefined}
      onNavigate={closeMore}
    />
  );

  return (
    // `items-start` so "More" sits on the first row when the links wrap to two
    // on a phone, rather than floating in the gutter between them. Identical to
    // `items-center` from `sm` up, where the strip is a single row.
    <div className={`flex min-w-0 items-start gap-2 ${className}`}>
      {/*
       * Wraps rather than scrolls. The primary labels (four of them since Not
       * ready became Today's view) still need more room than a phone gives this
       * strip — ~285px — so as a one-line scroller it hid the tail of the row:
       * the right edge guillotined "Divers" mid-word against the More button,
       * and on the schedule board the *active* tab sat entirely off-screen, so
       * nothing on the page read as current. Wrapping costs one
       * header row on a phone and shows every destination, with the label
       * itself kept whole by `whitespace-nowrap` in `linkClass`. It never wraps
       * from `sm` up, where the row has room.
       */}
      <nav
        aria-label={copy.primaryNavAriaLabel}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-0.5 gap-y-1 pr-2 sm:gap-x-1 sm:pr-3"
      >
        {primary.map((destination) => {
          const href = staffDestinationHref(root, destination);
          const active = isDestinationCurrent(pathname, root, destination);
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
      <details ref={detailsRef} className="relative shrink-0">
        <summary
          ref={summaryRef}
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
        {/* Mobile-only scrim: makes the panel read as modal on a phone (where
            it covers most of the viewport) and gives a large, obvious tap
            target to dismiss it, on top of the outside-click handler above. */}
        {moreOpen ? (
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={closeMore}
            className="fixed inset-0 z-10 cursor-default bg-foreground/20 sm:hidden"
          />
        ) : null}
        {/*
         * One column, one link per row — a two-column grid wrapped short labels
         * onto two lines. Two named groups rather than one bare rule: the
         * divider that used to sit here said "these are different" without ever
         * saying how, so which half held Reports and which held Promo codes was
         * a memory test.
         */}
        <div className="absolute right-0 z-20 mt-2 flex w-[min(15rem,calc(100vw-2rem))] flex-col rounded-2xl border border-border bg-surface p-2 shadow-xl">
          {daily.length > 0 ? (
            <MoreGroup id={`${groupId}-daily`} heading={copy.groupDaily}>
              {daily.map(moreLink)}
            </MoreGroup>
          ) : null}
          {/* A visible heading over a single row is noise, so the configure-once
              half wears one only once it is a genuine group. It keeps the same
              accessible name either way — a screen reader still hears which
              half of the menu it is in. */}
          {setup.length > 1 ? (
            <MoreGroup id={`${groupId}-setup`} heading={copy.groupSetup} className="mt-2">
              {setup.map(moreLink)}
            </MoreGroup>
          ) : setup.length === 1 ? (
            <ul
              aria-label={copy.groupSetup}
              className="mt-2 flex flex-col gap-0.5 border-t border-border pt-2"
            >
              {setup.map(moreLink)}
            </ul>
          ) : null}
        </div>
      </details>
    </div>
  );
}
