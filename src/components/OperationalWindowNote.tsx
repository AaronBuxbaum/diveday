import Link from "next/link";
import { Fragment } from "react";

/**
 * The one sentence that discloses the shared operational window, rendered the
 * same way on every readiness surface (Today, Not ready, Check-in), plus the
 * pivots between them.
 *
 * Those three read the same evidence through the same horizon
 * (`src/lib/operational-window.ts`); before this they each printed their own
 * bespoke window note, and a diver cleared on one list still appeared on
 * another with no explanation. Saying it once, identically, in the same place
 * on all three is what makes the shared model visible rather than merely true.
 *
 * Words come in as props — staff copy is resolved server-side by the page
 * (docs ADR 20260730-staff-copy-localization).
 */

/**
 * The lenses that share the window. Reports is a calendar month, by design.
 *
 * `blockers` is a lens, not a page: since Not ready folded into the shop home
 * it is Today's by-departure *view*, reached by a query param. It stays in this
 * list because it is still a distinct way of reading the same window that a
 * staffer standing at the counter may want to jump to — but a page that already
 * offers it as a view (the shop home, which switches between both) never
 * renders it as a pivot as well, or the same choice would appear twice on one
 * screen (design principle 8).
 */
export type ReadinessSurface = "today" | "blockers" | "check_in";

const SURFACE_PATHS: Record<ReadinessSurface, (shopSlug: string) => string> = {
  today: (shopSlug) => `/shop/${shopSlug}`,
  blockers: (shopSlug) => `/shop/${shopSlug}?view=departures`,
  check_in: (shopSlug) => `/shop/${shopSlug}/check-in`,
};

const SURFACE_ORDER: ReadinessSurface[] = ["today", "blockers", "check_in"];

export type OperationalWindowPivot = { href: string; label: string };

/**
 * The sibling lenses on the same window, in a stable order, minus the ones the
 * staffer is already looking at. `current` takes a list because the shop home
 * *is* two of them — its switch already offers by-urgency and by-departure, so
 * it passes both and pivots only to Check-in. Routes are named here once so no
 * page can drift to its own spelling of the same link.
 */
export function readinessPivots(
  shopSlug: string,
  current: ReadinessSurface | readonly ReadinessSurface[],
  labels: Record<ReadinessSurface, string>,
): OperationalWindowPivot[] {
  const here = new Set(typeof current === "string" ? [current] : current);
  return SURFACE_ORDER.filter((surface) => !here.has(surface)).map((surface) => ({
    href: SURFACE_PATHS[surface](shopSlug),
    label: labels[surface],
  }));
}

export type OperationalWindowNoteCopy = {
  /** The shared window sentence — identical on all three surfaces. */
  note: string;
  /** How this surface narrows the shared window, when it does (Check-in). */
  lens?: string;
  /** Accessible name for the pivot links. */
  pivotsLabel: string;
};

export function OperationalWindowNote({
  copy,
  pivots,
}: {
  copy: OperationalWindowNoteCopy;
  pivots: readonly OperationalWindowPivot[];
}) {
  return (
    <div className="mt-1 max-w-2xl">
      <p className="text-sm text-muted">
        {copy.note}
        {copy.lens ? ` ${copy.lens}` : null}
      </p>
      {pivots.length > 0 ? (
        <nav
          aria-label={copy.pivotsLabel}
          className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
        >
          {pivots.map((pivot, index) => (
            <Fragment key={pivot.href}>
              {index > 0 ? (
                <span aria-hidden="true" className="text-muted">
                  ·
                </span>
              ) : null}
              <Link href={pivot.href} className="font-medium text-primary hover:underline">
                {pivot.label}
              </Link>
            </Fragment>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
