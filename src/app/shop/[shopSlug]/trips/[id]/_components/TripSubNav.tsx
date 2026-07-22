import Link from "next/link";

/**
 * The boat loop's spine: one compact bar on every trip surface so a captain who
 * wanders can always reach the others in a tap. The tabs split by question:
 * Overview is *what the dive is* (details, plan, conditions, requirements,
 * crew); Guests is *who is attending* — the one place the roster, wait list,
 * and every per-diver action live. Manifest and Prep are the dock surfaces.
 * Current page is marked and inert.
 *
 * The Manifest is both the pre-departure boarding pass (its "Before departure"
 * checkpoint) and the full safety document across every later checkpoint —
 * there is no separate Boarding surface.
 */
export type TripSubNavPage = "overview" | "guests" | "manifest" | "prep";

const TABS: { page: TripSubNavPage; label: string; suffix: string }[] = [
  { page: "overview", label: "Overview", suffix: "" },
  { page: "guests", label: "Guests", suffix: "/guests" },
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
