import { boatSnagDetailText, openBoatCheckActionText } from "@/i18n/today-labels";
import { shopPath } from "@/lib/staff-notices";
import { type TodayAction, urgencyFor } from "@/lib/today";
import type { TodayRowsContext } from "./today-rows-context";

/**
 * **A snag still open on a boat** (fifth-loop ideas, item 1): one `boat_snag`
 * row each, naming the boat, the checklist line and what is wrong, who wrote
 * it and how many departures have sailed with it since.
 *
 * The door is the boat check of the boat's next departure, where the crew
 * will read it and can say "Fixed"; with nothing ahead, the departure it was
 * written on, or, when that departure has been deleted, the boat's row on the
 * fleet page rather than a page that is gone. Its urgency follows that next departure, so a snag on a boat
 * sailing at 7:00 tomorrow outranks one on a boat laid up for the month.
 * Informs, never gates.
 */
export function pushBoatSnagRows(actions: TodayAction[], ctx: TodayRowsContext): void {
  const { boatSnags } = ctx.wave;
  const { shopSlug, t, now } = ctx;
  for (const snag of boatSnags) {
    const tripId = snag.next?.tripId ?? (snag.notedOnLive ? snag.notedOnTripId : null);
    const dueAt = snag.next?.startsAt ?? null;
    actions.push({
      id: `boat-snag:${snag.id}`,
      kind: "boat_snag",
      urgency: urgencyFor(dueAt, now),
      subject: snag.boatName,
      context: null,
      detail: boatSnagDetailText(t, snag),
      actionLabel: openBoatCheckActionText(t),
      href: tripId
        ? `/shop/${shopSlug}/trips/${tripId}/manifest`
        : `${shopPath(shopSlug, "settings", "boats")}#boat-${snag.boatId}`,
      dueAt,
    });
  }
}
