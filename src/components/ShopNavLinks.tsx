"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

const linkClass =
  "inline-flex min-h-11 items-center rounded-xl px-2 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken hover:text-foreground sm:px-3";

/** Owner/manager surfaces (H-14) carry a gate key; everyone else always sees the link. */
export type ShopNavGates = {
  waivers: boolean;
  reports: boolean;
  team: boolean;
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

function primaryLinks(copy: ShopNavLinksCopy): { label: string; suffix: string; alsoMatch?: string }[] {
  return [
    { label: copy.today, suffix: "" },
    { label: copy.checkIn, suffix: "/check-in" },
    { label: copy.blockers, suffix: "/blockers" },
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
): { label: string; suffix: string; gate?: keyof ShopNavGates }[] {
  return [
    { label: copy.staffing, suffix: "/staffing" },
    { label: copy.diveSites, suffix: "/dive-sites" },
    { label: copy.courses, suffix: "/courses" },
    { label: copy.reviews, suffix: "/reviews" },
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

export function ShopNavLinks({
  root,
  gates,
  copy,
  className = "",
}: {
  root: string;
  gates: ShopNavGates;
  copy: ShopNavLinksCopy;
  className?: string;
}) {
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const visibleMoreLinks = moreLinks(copy).filter((link) => !link.gate || gates[link.gate]);
  const visibleMoreAdminLinks = moreAdminLinks(copy).filter(
    (link) => !link.gate || gates[link.gate],
  );
  const moreIsActive = [...visibleMoreLinks, ...visibleMoreAdminLinks].some((link) =>
    isCurrent(pathname, `${root}${link.suffix}`, root),
  );
  const closeMore = () => {
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
  };

  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <nav
        aria-label={copy.primaryNavAriaLabel}
        className="flex min-w-0 flex-1 snap-x items-center gap-0.5 overflow-x-auto scroll-px-1 pr-2 sm:gap-1 sm:pr-3"
      >
        {primaryLinks(copy).map(({ label, suffix, alsoMatch }) => {
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
            </Link>
          );
        })}
      </nav>
      <details ref={detailsRef} className="relative shrink-0">
        <summary
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
        {/* One column, one link per row — a two-column grid wrapped short labels onto two lines. */}
        <div className="absolute right-0 z-20 mt-2 flex w-[min(15rem,calc(100vw-2rem))] flex-col gap-0.5 rounded-2xl border border-border bg-surface p-2 shadow-xl">
          {visibleMoreLinks.map(({ label, suffix }) => {
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
