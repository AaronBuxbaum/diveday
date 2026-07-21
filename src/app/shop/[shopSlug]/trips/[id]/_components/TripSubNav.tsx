import Link from "next/link";

/**
 * The boat loop's spine: one compact bar on every trip surface so a captain who
 * wanders can always reach the other three in a tap. Overview holds the roster
 * and setup; the rest are the dock surfaces. Current page is marked and inert.
 *
 * Boarding is the fast pre-departure boarding pass, distinct from the Manifest
 * (the full safety document).
 */
export type TripSubNavPage = "overview" | "boarding" | "manifest" | "prep";

const TABS: { page: TripSubNavPage; label: string; suffix: string }[] = [
  { page: "overview", label: "Overview", suffix: "" },
  { page: "boarding", label: "Boarding", suffix: "/boarding" },
  { page: "manifest", label: "Manifest", suffix: "/manifest" },
  { page: "prep", label: "Prep", suffix: "/prep" },
];

export function TripSubNav({
  shopSlug,
  tripId,
  current,
  className = "",
}: {
  shopSlug: string;
  tripId: string;
  current: TripSubNavPage;
  className?: string;
}) {
  const root = `/shop/${shopSlug}/trips/${tripId}`;
  return (
    <nav
      aria-label="Trip"
      className={`flex snap-x gap-1 overflow-x-auto rounded-2xl border border-border bg-surface-sunken p-1 print:hidden ${className}`}
    >
      {TABS.map(({ page, label, suffix }) => {
        const active = page === current;
        const cls = `inline-flex min-h-11 flex-1 snap-start items-center justify-center rounded-xl px-3 text-sm font-semibold whitespace-nowrap transition-colors duration-200 ${
          active
            ? "bg-surface text-primary shadow-sm"
            : "text-muted hover:bg-surface hover:text-foreground"
        }`;
        return active ? (
          <span key={page} aria-current="page" className={cls}>
            {label}
          </span>
        ) : (
          <Link key={page} href={`${root}${suffix}`} className={cls}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
