"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

const linkClass =
  "inline-flex min-h-11 items-center rounded-xl px-2 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken hover:text-foreground sm:px-3";

const primaryLinks: { label: string; suffix: string; alsoMatch?: string }[] = [
  { label: "Today", suffix: "" },
  { label: "Blockers", suffix: "/blockers" },
  { label: "Divers", suffix: "/divers" },
  // Staff work a trip on /trips/[id], which is the Schedule surface's detail
  // view — keep the Schedule tab lit so they don't lose their place.
  { label: "Schedule", suffix: "/schedule", alsoMatch: "/trips" },
];

const moreLinks = [
  ["Dive sites", "/dive-sites"],
  ["Courses", "/courses"],
  ["Waivers", "/waivers"],
  ["Settings", "/settings"],
  ["Import contacts", "/settings/import"],
  ["Data export", "/settings/export"],
] as const;

function isCurrent(pathname: string, href: string, root: string) {
  return href === root ? pathname === root : pathname === href || pathname.startsWith(`${href}/`);
}

function navClass(active: boolean) {
  return `${linkClass} ${active ? "bg-primary/10 text-primary" : "text-muted"}`;
}

export function ShopNavLinks({ root, className = "" }: { root: string; className?: string }) {
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const moreIsActive = moreLinks.some(([, suffix]) =>
    isCurrent(pathname, `${root}${suffix}`, root),
  );
  const closeMore = () => {
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
  };

  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <nav
        aria-label="Primary"
        className="flex min-w-0 flex-1 snap-x items-center gap-0.5 overflow-x-auto scroll-px-1 pr-2 sm:gap-1 sm:pr-3"
      >
        {primaryLinks.map(({ label, suffix, alsoMatch }) => {
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
          More
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
          {moreLinks.map(([label, suffix]) => {
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
