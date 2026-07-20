"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const linkClass =
  "inline-flex min-h-11 items-center rounded-xl px-2 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken hover:text-foreground sm:px-3";

const primaryLinks: { label: string; suffix: string; alsoMatch?: string }[] = [
  { label: "Today", suffix: "" },
  { label: "Divers", suffix: "/divers" },
  // Staff work a trip on /trips/[id], which is the Schedule surface's detail
  // view — keep the Schedule tab lit so they don't lose their place.
  { label: "Schedule", suffix: "/schedule", alsoMatch: "/trips" },
  { label: "Gear", suffix: "/gear" },
];

const moreGroups = [
  {
    label: "Plan",
    links: [["Dive sites", "/dive-sites"]],
  },
  {
    label: "Business",
    links: [
      ["Courses", "/courses"],
      ["Waivers", "/waivers"],
      ["Settings", "/settings/payments"],
    ],
  },
] as const;

function isCurrent(pathname: string, href: string, root: string) {
  return href === root ? pathname === root : pathname === href || pathname.startsWith(`${href}/`);
}

function navClass(active: boolean) {
  return `${linkClass} ${active ? "bg-primary/10 text-primary" : "text-muted"}`;
}

export function ShopNavLinks({ root, className = "" }: { root: string; className?: string }) {
  const pathname = usePathname();
  const isBoatSurface = pathname.includes("/manifest");
  const moreIsActive = moreGroups.some((group) =>
    group.links.some(([, suffix]) => isCurrent(pathname, `${root}${suffix}`, root)),
  );

  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      {isBoatSurface ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
          <span aria-hidden="true">⚓</span>
          <span>Boat view</span>
        </span>
      ) : null}
      <nav
        aria-label={isBoatSurface ? "Shop and boat navigation" : "Primary"}
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
      <details className="relative shrink-0">
        <summary
          className={`${navClass(moreIsActive)} flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden`}
        >
          More{" "}
          <span aria-hidden="true" className="ml-1 text-xs">
            ⌄
          </span>
        </summary>
        {/*
         * One column, one link per row. The old two-column grid wrapped short
         * labels ("Nitrox fills", "Dive sites") onto two lines and let a
         * three-link group spill a stray item into a column of its own, which
         * read as a layout bug rather than a menu.
         */}
        <div className="absolute right-0 z-20 mt-2 flex w-[min(15rem,calc(100vw-2rem))] flex-col gap-3 rounded-2xl border border-border bg-surface p-3 shadow-xl">
          {moreGroups.map((group) => (
            <div key={group.label} className="flex flex-col">
              <p className="px-3 pb-1 text-xs font-semibold tracking-widest text-muted uppercase">
                {group.label}
              </p>
              {group.links.map(([label, suffix]) => {
                const href = `${root}${suffix}`;
                const active = isCurrent(pathname, href, root);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`${navClass(active)} whitespace-nowrap`}
                    aria-current={active ? "page" : undefined}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
