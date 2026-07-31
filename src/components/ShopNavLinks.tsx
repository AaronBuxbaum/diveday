"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";

const linkClass =
  "inline-flex min-h-11 items-center rounded-xl px-2 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken hover:text-foreground sm:px-3";

/** Owner/manager surfaces (H-14) carry a gate key; everyone else always sees the link. */
export type ShopNavGates = {
  waivers: boolean;
  reports: boolean;
  team: boolean;
};

/**
 * Small "pending work" counts, server-computed on each page that already
 * tracks them — Reviews' "waiting on you" moderation queue, Blockers' count
 * of divers who can't board yet — so a badge here never runs its own extra
 * query (task 83, UX persona 11 "Kai" / persona 12 "Maren").
 */
export type ShopNavCounts = {
  reviews: number;
  blockers: number;
};

/** Every word this component renders, resolved server-side. */
export interface ShopNavLinksCopy {
  primaryNavAriaLabel: string;
  more: string;
  today: string;
  checkIn: string;
  blockers: string;
  divers: string;
  schedule: string;
  staffing: string;
  diveSites: string;
  courses: string;
  reviews: string;
  waivers: string;
  reports: string;
  promoCodes: string;
  settings: string;
  team: string;
}

function primaryLinks(
  copy: ShopNavLinksCopy,
): { label: string; suffix: string; alsoMatch?: string; count?: keyof ShopNavCounts }[] {
  return [
    { label: copy.today, suffix: "" },
    { label: copy.checkIn, suffix: "/check-in" },
    { label: copy.blockers, suffix: "/blockers", count: "blockers" },
    { label: copy.divers, suffix: "/divers" },
    // Staff work a trip on /trips/[id], which is the Schedule surface's detail
    // view — keep the Schedule tab lit so they don't lose their place.
    { label: copy.schedule, suffix: "/schedule", alsoMatch: "/trips" },
  ];
}

/**
 * Two rows in one dropdown: day-to-day reference surfaces, then a divider,
 * then shop administration. Import/export are one level further down still —
 * they're rare, owner/manager-only errands, so they live as links inside
 * Settings itself (src/app/shop/[shopSlug]/settings/SettingsPage.tsx) rather
 * than earning their own top-level "More" row.
 */
function moreLinks(
  copy: ShopNavLinksCopy,
): { label: string; suffix: string; gate?: keyof ShopNavGates; count?: keyof ShopNavCounts }[] {
  return [
    { label: copy.staffing, suffix: "/staffing" },
    { label: copy.diveSites, suffix: "/dive-sites" },
    { label: copy.courses, suffix: "/courses" },
    { label: copy.reviews, suffix: "/reviews", count: "reviews" },
    { label: copy.waivers, suffix: "/waivers", gate: "waivers" },
    { label: copy.reports, suffix: "/reports", gate: "reports" },
  ];
}

function moreAdminLinks(
  copy: ShopNavLinksCopy,
): { label: string; suffix: string; gate?: keyof ShopNavGates }[] {
  return [
    // Promo codes move money, so they sit with the other owner/manager payment
    // settings rather than in the day-to-day row (H-14).
    { label: copy.promoCodes, suffix: "/promos", gate: "reports" },
    { label: copy.settings, suffix: "/settings" },
    { label: copy.team, suffix: "/settings/team", gate: "team" },
  ];
}

function isCurrent(pathname: string, href: string, root: string) {
  return href === root ? pathname === root : pathname === href || pathname.startsWith(`${href}/`);
}

function navClass(active: boolean) {
  return `${linkClass} ${active ? "bg-primary/10 text-primary" : "text-muted"}`;
}

/** A count badge next to a nav label — omitted entirely at zero, never a "0" pill. */
function NavCountBadge({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <Badge tone="primary" size="sm" tabularNums className="ml-1.5 px-1.5 py-0">
      {count}
    </Badge>
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
  const [moreOpen, setMoreOpen] = useState(false);
  const visibleMoreLinks = moreLinks(copy).filter((link) => !link.gate || gates[link.gate]);
  const visibleMoreAdminLinks = moreAdminLinks(copy).filter(
    (link) => !link.gate || gates[link.gate],
  );
  const moreIsActive = [...visibleMoreLinks, ...visibleMoreAdminLinks].some((link) =>
    isCurrent(pathname, `${root}${link.suffix}`, root),
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

  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <nav
        aria-label={copy.primaryNavAriaLabel}
        className="flex min-w-0 flex-1 snap-x items-center gap-0.5 overflow-x-auto scroll-px-1 pr-2 sm:gap-1 sm:pr-3"
      >
        {primaryLinks(copy).map(({ label, suffix, alsoMatch, count }) => {
          const href = `${root}${suffix}`;
          const active =
            isCurrent(pathname, href, root) ||
            (alsoMatch ? isCurrent(pathname, `${root}${alsoMatch}`, root) : false);
          return (
            <Link
              key={href}
              href={href}
              className={`${navClass(active)} flex-1 justify-center snap-start sm:flex-none sm:justify-start`}
              aria-current={active ? "page" : undefined}
              onClick={closeMore}
            >
              {label}
              <NavCountBadge count={count ? counts?.[count] : undefined} />
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
        {/* One column, one link per row — a two-column grid wrapped short labels onto two lines. */}
        <div className="absolute right-0 z-20 mt-2 flex w-[min(15rem,calc(100vw-2rem))] flex-col gap-0.5 rounded-2xl border border-border bg-surface p-2 shadow-xl">
          {visibleMoreLinks.map(({ label, suffix, count }) => {
            const href = `${root}${suffix}`;
            const active = isCurrent(pathname, href, root);
            return (
              <Link
                key={href}
                href={href}
                onClick={closeMore}
                className={`${navClass(active)} whitespace-nowrap`}
                aria-current={active ? "page" : undefined}
              >
                {label}
                <NavCountBadge count={count ? counts?.[count] : undefined} />
              </Link>
            );
          })}
          {/* Shop administration, set off from the day-to-day links above. */}
          {visibleMoreAdminLinks.length > 0 ? (
            <div className="my-1 border-t border-border" />
          ) : null}
          {visibleMoreAdminLinks.map(({ label, suffix }) => {
            const href = `${root}${suffix}`;
            const active = isCurrent(pathname, href, root);
            return (
              <Link
                key={href}
                href={href}
                onClick={closeMore}
                className={`${navClass(active)} whitespace-nowrap`}
                aria-current={active ? "page" : undefined}
              >
                {label}
              </Link>
            );
          })}
        </div>
      </details>
    </div>
  );
}
