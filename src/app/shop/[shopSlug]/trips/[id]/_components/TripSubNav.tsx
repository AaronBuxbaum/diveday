"use client";

import { usePathname } from "next/navigation";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

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
 *
 * It reads the active tab from the pathname rather than a prop so it can live in
 * the shared trip layout: that keeps the nav mounted across tab switches instead
 * of re-rendering it on every navigation, which is what makes hopping between
 * surfaces feel instant.
 */
export type TripSubNavPage = "overview" | "guests" | "manifest" | "prep";

/** Every word this nav renders, resolved on the server — see the note in `src/i18n/staff-messages.ts`. */
export type TripSubNavCopy = {
  ariaLabel: string;
  overview: string;
  guests: string;
  manifest: string;
  prep: string;
};

const TAB_ORDER: {
  page: TripSubNavPage;
  copyKey: keyof Omit<TripSubNavCopy, "ariaLabel">;
  suffix: string;
}[] = [
  { page: "overview", copyKey: "overview", suffix: "" },
  { page: "guests", copyKey: "guests", suffix: "/guests" },
  { page: "manifest", copyKey: "manifest", suffix: "/manifest" },
  { page: "prep", copyKey: "prep", suffix: "/prep" },
];

export function TripSubNav({
  shopSlug,
  tripId,
  copy,
  className = "",
}: {
  shopSlug: string;
  tripId: string;
  copy: TripSubNavCopy;
  className?: string;
}) {
  const root = `/shop/${shopSlug}/trips/${tripId}`;
  const pathname = usePathname();
  const TABS = TAB_ORDER.map((tab) => ({ ...tab, label: copy[tab.copyKey] }));
  // Overview is the bare trip route; any suffixed surface wins over it. Match on
  // the exact segment (or a deeper path under it) so a query string never throws
  // the highlight off. A path that matches no tab (e.g. the departure log) highlights
  // nothing rather than falsely claiming Overview.
  const current: TripSubNavPage | null =
    TABS.find((tab) =>
      tab.suffix
        ? pathname === `${root}${tab.suffix}` || pathname.startsWith(`${root}${tab.suffix}/`)
        : pathname === root,
    )?.page ?? null;

  return (
    <SegmentedControl
      ariaLabel={copy.ariaLabel}
      items={TABS.map(({ page, label, suffix }) => ({
        key: page,
        label,
        href: `${root}${suffix}`,
      }))}
      currentKey={current}
      fill
      className={className}
    />
  );
}
