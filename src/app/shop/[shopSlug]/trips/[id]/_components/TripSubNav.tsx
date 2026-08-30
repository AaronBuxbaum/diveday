"use client";

import { usePathname } from "next/navigation";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

/**
 * The boat loop's spine: one compact bar on every trip surface so a captain who
 * wanders can always reach the others in a tap. The tabs split by question:
 * Trip is *what the dive is* and *who is coming*; Manifest is who is aboard;
 * Prep is what is loaded. This is the three-surface vocabulary from ADR
 * 20260827-the-departure-is-two-working-surfaces (slice 5e).
 * Current page is marked and inert.
 *
 * The Manifest is both the pre-departure boarding pass (its "Before departure"
 * checkpoint) and the full safety document across every later checkpoint —
 * there is no separate Boarding surface.
 *
 * It reads the active tab from the pathname rather than a prop so each surface
 * can render the same server-localized spine without duplicating route logic.
 */
export type TripSubNavPage = "trip" | "manifest" | "prep";

/** Every word this nav renders, resolved on the server — see the note in `src/i18n/staff-messages.ts`. */
export type TripSubNavCopy = {
  ariaLabel: string;
  trip: string;
  manifest: string;
  prep: string;
};

const TAB_ORDER: {
  page: TripSubNavPage;
  copyKey: keyof Omit<TripSubNavCopy, "ariaLabel">;
  suffix: string;
}[] = [
  { page: "trip", copyKey: "trip", suffix: "" },
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
  const TABS = TAB_ORDER.map((tab) => ({
    ...tab,
    label: copy[tab.copyKey],
  }));
  // Trip is the bare route; any suffixed surface wins over it. Match on the
  // exact segment (or a deeper path under it) so a query string never throws
  // the highlight off. The legacy `/guests` route is still a Trip reading, so
  // old bookmarks get the same active state while its visible tab points at
  // the canonical root. A path that matches no tab (e.g. the departure log)
  // highlights nothing rather than falsely claiming Trip.
  const current: TripSubNavPage | null =
    TABS.find((tab) =>
      tab.suffix
        ? pathname === `${root}${tab.suffix}` || pathname.startsWith(`${root}${tab.suffix}/`)
        : pathname === root || pathname.startsWith(`${root}/guests`),
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
