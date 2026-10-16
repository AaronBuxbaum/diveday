import type { getTripOverview } from "@/db/trips";
import { boatWorkText } from "@/i18n/boat-work-labels";
import { overRatioPulseKey } from "@/i18n/crew-gap-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type BoatWorkItem, boatWorkItems } from "@/lib/boat-work";
import { PREP_SECTION_ID } from "@/lib/element-id";
import { shopPath } from "@/lib/staff-notices";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.

import { boatClashText } from "./trip-crew-notes";

type TripOverview = NonNullable<Awaited<ReturnType<typeof getTripOverview>>>;

/** One quiet link in the Divers tab's pulse: a fact about the boat and the door to its fix. */
export type TripPulseFact = { text: string; href: string; tone?: "danger" | "warning" };

/**
 * Capacity moved into the masthead ring in slice 5e. Non-seat pulse facts
 * remain as quiet links so the redesign changes their home and emphasis,
 * not the actions they lead to.
 */
export function tripPulseFacts({
  pulseNeeded,
  pulse,
  crewGap,
  requirement,
  cancelled,
  course,
  liveBoatClashes,
  shopSlug,
  tripId,
  startsAt,
  now,
  t,
}: {
  pulseNeeded: boolean;
  pulse: TripOverview["pulse"];
  crewGap: TripOverview["crew"]["crewGap"];
  requirement: TripOverview["requirement"];
  cancelled: boolean;
  course: TripOverview["trip"]["course"];
  /** The hull's clashes with other departures; empty on a called-off one. */
  liveBoatClashes: TripOverview["boatClashes"];
  shopSlug: string;
  tripId: string;
  /** When the boat leaves, and the page's clock: the boat's work asks both. */
  startsAt: Date;
  now: Date;
  t: StaffTranslator;
}): TripPulseFact[] {
  return pulseNeeded
    ? [
        ...(pulse.blocked > 0
          ? [
              {
                text: t("trips.pulse.blocked", { count: pulse.blocked }),
                // The ledger's "Still to clear" group leads the roster, so the
                // plain anchor lands on the blocked rows (slice 5d retired the
                // `?rf=` filter with the chips).
                href: `${shopPath(shopSlug, "trips", tripId)}#roster`,
                tone: "danger" as const,
              },
            ]
          : []),
        // A course session whose crew can't cover it is a can-this-boat-sail fact
        // in the pulse's exact register — until it surfaces here, the strip's
        // quiet reads as an all clear the Crew panel three screens down would
        // contradict. The panel keeps the full sentence; this is the door to it,
        // and since #1125 these two read at the length a door is. They used to
        // be whole sentences ("This course session has no instructor yet"),
        // which the staffing week's ~135px day column — the *other* surface
        // rendering these two keys — wrapped onto four lines beside its
        // two-word codes.
        //
        // Shortened to a requirement rather than a state, on a
        // `dive-domain-expert` read: a fun dive with no instructor is an
        // ordinary Tuesday, and a course session without one cannot take a
        // single enrolment. "No instructor" described the harmless one. And
        // "Over student ratio" rather than "Over ratio" because DiveDay has two
        // ratios and the other one renders in the same column as "Under target"
        // — the agency's published training cap refuses seats, the shop's own
        // diver:divemaster target binds nothing (docs/product/glossary.md).
        ...(crewGap.code === "no_instructor"
          ? [
              {
                text: t("trips.pulse.needsInstructor"),
                href: "?view=details#crew",
                tone: "danger" as const,
              },
            ]
          : []),
        // No requirements row blocks every diver at boarding
        // (`requirements_not_configured`), and the fix lives on Details.
        ...(requirement === null && !cancelled && !course
          ? [
              {
                text: t("trips.pulse.noRequirements"),
                href: "?view=details#requirements",
                tone: "danger" as const,
              },
            ]
          : []),
        // The hull is on another departure at these hours. It holds the boat
        // up as squarely as a missing instructor does, and the fix is on one
        // of the two departures, so the door opens the other one.
        ...liveBoatClashes.map((clash) => ({
          text: boatClashText(t, clash),
          href: shopPath(shopSlug, "trips", clash.otherTripId),
          tone: "danger" as const,
        })),
        ...(crewGap.code === "over_ratio"
          ? [
              {
                text: t(overRatioPulseKey(crewGap)),
                href: "?view=details#crew",
                tone: "danger" as const,
              },
            ]
          : []),
        // **The boat's work** (third review, item 4): the same items, counts
        // and words Today's rows for this boat carry, from one reader
        // (`boatWorkItems`). Work, not hazards, so it reads in the pulse's
        // neutral ink below the facts that hold the boat up, except nitrox
        // asked for with no verified card, which carries its warning tone.
        ...boatWorkItems(pulse.work, { startsAt, now }).map((item) => ({
          text: boatWorkText(t, item),
          href: boatWorkHref(item, { shopSlug, tripId }),
          ...(item.tone === "warning" ? { tone: "warning" as const } : {}),
        })),
      ]
    : [];
}

/**
 * Where each item of the boat's work is fixed. Sizes and nitrox are the Gear
 * tab's packing list (ADR 20261001-logbook); a missing contact is the diver's
 * own row on the roster; money owed is the Orders index filtered to this
 * departure, `range=all` because the count is unwindowed: a seat sold months
 * ahead was invoiced months ago, and the index's default 90-day window would
 * open on fewer orders than the fact just promised.
 */
function boatWorkHref(
  item: BoatWorkItem,
  { shopSlug, tripId }: { shopSlug: string; tripId: string },
) {
  switch (item.code) {
    case "missing_sizes":
    case "ungated_nitrox":
      return `${shopPath(shopSlug, "trips", tripId, "prep")}#${PREP_SECTION_ID}`;
    case "missing_contact":
      return `${shopPath(shopSlug, "trips", tripId)}#roster`;
    case "open_orders":
      return `${shopPath(shopSlug, "orders")}?tripId=${tripId}&status=open&range=all`;
  }
}

/** The page's call: the overview's own parts, read off it here rather than spelled out at the route. */
export function tripPulseFactsOf(
  overview: Pick<
    TripOverview,
    "pulseNeeded" | "pulse" | "crew" | "requirement" | "cancelled" | "trip"
  >,
  page: Pick<
    Parameters<typeof tripPulseFacts>[0],
    "liveBoatClashes" | "shopSlug" | "tripId" | "now" | "t"
  >,
): TripPulseFact[] {
  return tripPulseFacts({
    pulseNeeded: overview.pulseNeeded,
    pulse: overview.pulse,
    crewGap: overview.crew.crewGap,
    requirement: overview.requirement,
    cancelled: overview.cancelled,
    course: overview.trip.course,
    startsAt: overview.trip.startsAt,
    ...page,
  });
}
