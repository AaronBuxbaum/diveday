import { boatWorkItems, boatWorkText } from "@/features/boat-work";
import { openOrdersFix } from "@/features/trip-fix-list";
import type { getTripOverview } from "@/features/trip-overview";
import { overRatioPulseKey } from "@/i18n/crew-gap-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { PREP_SECTION_ID } from "@/lib/element-id";
import { shopPath } from "@/lib/staff-notices";
import type { FixListPhase, TripFix } from "./guest-fix-rows";
import { boatClashText } from "./trip-crew-notes";

type TripOverview = NonNullable<Awaited<ReturnType<typeof getTripOverview>>>;

/**
 * **What holds the whole boat up**, as fix-list rows (ADR
 * 20261117-trip-page-clock): a course with no instructor, a crew under the
 * training ratio, requirements never set (every diver blocks at boarding),
 * the hull on another departure at these hours, and, worth a minute, nitrox
 * asked for with no verified card. Each is one row with the door to its fix.
 * The day before and at Check-in, a trip with no crew or no dive plan says so
 * too. In Filling and Getting ready, this departure's orders still awaiting
 * payment are one row opening them (`openOrdersFix`, issue #4685). Nothing on
 * a finished or cancelled trip.
 *
 * It replaces the old "Needs you" fold: a guest's own work is their fix-list
 * row, and Today keeps the shop-wide queue.
 */
export function tripFixes(
  overview: Pick<
    TripOverview,
    "pulseNeeded" | "pulse" | "crew" | "requirement" | "cancelled" | "trip" | "tripDiveList"
  >,
  {
    liveBoatClashes,
    phase,
    shopSlug,
    tripId,
    now,
    t,
  }: {
    liveBoatClashes: TripOverview["boatClashes"];
    phase: FixListPhase;
    shopSlug: string;
    tripId: string;
    now: Date;
    t: StaffTranslator;
  },
): TripFix[] {
  if (!overview.pulseNeeded || overview.cancelled) return [];
  const { crewGap } = overview.crew;
  const edit = (section: string) => `${shopPath(shopSlug, "trips", tripId)}?view=edit#${section}`;
  const setCrew = { href: edit("crew"), label: t("trips.fixList.setCrew") };
  const dayOf = phase === "ready" || phase === "checkin";
  const orders = openOrdersFix(overview.pulse.work.openOrders, phase);
  return [
    ...(crewGap.code === "no_instructor"
      ? [
          {
            key: "instructor",
            text: t("trips.pulse.needsInstructor"),
            tone: "danger" as const,
            action: setCrew,
          },
        ]
      : []),
    ...(crewGap.code === "over_ratio"
      ? [
          {
            key: "ratio",
            text: t(overRatioPulseKey(crewGap)),
            tone: "danger" as const,
            action: setCrew,
          },
        ]
      : []),
    // No requirements row blocks every diver at boarding (`requirements_not_configured`).
    ...(!overview.requirement && !overview.trip.course
      ? [
          {
            key: "requirements",
            text: t("trips.pulse.noRequirements"),
            tone: "danger" as const,
            action: { href: edit("requirements"), label: t("trips.fixList.setRequirements") },
          },
        ]
      : []),
    // The fix is on one of the two departures, so the door opens the other one.
    ...liveBoatClashes.map((clash) => ({
      key: `clash:${clash.otherTripId}`,
      text: boatClashText(t, clash),
      tone: "danger" as const,
      action: {
        href: shopPath(shopSlug, "trips", clash.otherTripId),
        label: t("trips.fixList.openTrip"),
      },
    })),
    ...(dayOf && overview.crew.crewIds.length === 0 && crewGap.code !== "no_instructor"
      ? [
          {
            key: "crew",
            text: t("trips.fixList.noCrew"),
            tone: "warning" as const,
            action: setCrew,
          },
        ]
      : []),
    ...(dayOf && overview.tripDiveList.length === 0
      ? [
          {
            key: "plan",
            text: t("trips.fixList.noPlan"),
            tone: "warning" as const,
            action: { href: edit("dives"), label: t("trips.fixList.setPlan") },
          },
        ]
      : []),
    ...((phase === "filling" || phase === "ready") && overview.pulse.work.openOrders > 0
      ? [
          {
            key: "open_orders",
            text: boatWorkText(t, {
              code: "open_orders",
              count: overview.pulse.work.openOrders,
              tone: "work",
            }),
            tone: "warning" as const,
            action: {
              href: `${shopPath(shopSlug, "orders")}?tripId=${encodeURIComponent(tripId)}&status=open&range=all`,
              label: t("today.actionLabel.openOrders"),
            },
          },
        ]
      : []),
    // Nitrox asked for with no verified card is packed as air: worth a word.
    ...boatWorkItems(overview.pulse.work, { startsAt: overview.trip.startsAt, now })
      .filter((item) => item.tone === "warning")
      .map((item) => ({
        key: item.code,
        text: boatWorkText(t, item),
        tone: "warning" as const,
        action: {
          href: `${shopPath(shopSlug, "trips", tripId, "prep")}#${PREP_SECTION_ID}`,
          label: t("trips.fixList.openGear"),
        },
      })),
    // Orders never hold a guest up: worth a minute, in the boat's work's own words.
    ...(orders
      ? [
          {
            key: "orders",
            text: boatWorkText(t, { code: "open_orders", count: orders.count, tone: "work" }),
            tone: "warning" as const,
            action: {
              href: `${shopPath(shopSlug, "orders")}?tripId=${tripId}&status=open&range=all`,
              label: t("trips.fixList.openOrders"),
            },
          },
        ]
      : []),
  ];
}
