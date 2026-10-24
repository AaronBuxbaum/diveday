import { emergencyCardBlankText, lostItemsWaitingText } from "@/i18n/today-labels";
import { HOUR_MS } from "@/lib/clock";
import { formatRelativeDay } from "@/lib/format";
import { staffDestination, staffDestinationHref, staffShopRoot } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { departureClockOrder, type TodayAction, urgencyFor } from "@/lib/today";
import { hasSailed } from "@/lib/trips";
import type { TodayRowsContext } from "./today-rows-context";
import { at } from "./today-shared";

/**
 * How far ahead a blank emergency card is worth a row: the window the offline
 * manifest is primed in (ADR 20260726-shopwide-offline-manifest-priming), so the
 * row arrives while the copy the crew will carry can still be fixed.
 */
export const EMERGENCY_CARD_WINDOW_MS = 48 * HOUR_MS;

/** The two desk facts Today reads with its wave (fifth loop, items 3 and 7). */
export type DeskFacts = { emergencyCardHasNumbers: boolean; lostItemsWaiting: number };

/**
 * **The desk's two quiet facts** (fifth loop):
 *
 * - **Item 3, a blank emergency reference.** When a departure sails inside
 *   the next 48 hours and the shop's emergency reference has no number to dial,
 *   the owner hears it the day before, not the captain at sea. One row for the
 *   shop, under "The desk", naming the first boat that would carry the blank
 *   card and ranked by that boat's urgency. A boat already out and not back
 *   is named first (issue #2802): the row stays while she is at sea.
 * - **Item 7, found items waiting to go home.** One counting row while anything
 *   is open, which is also Lost and found's door from Today.
 */
export function pushDeskRows(actions: TodayAction[], ctx: TodayRowsContext, facts: DeskFacts) {
  const { inWindow, now, timeZone, locale, t, shopSlug } = ctx;
  if (!facts.emergencyCardHasNumbers) {
    // **A boat at sea comes first** (issue #2802, Aaron's option b): she is
    // carrying the blank card now, and the desk can still radio her a number.
    // `boatsOut.out` is every departure past the sailing hour and not back by
    // the stage pill's own rule, so the row lets go when she is home.
    const out = [...ctx.wave.boatsOut.out].sort(departureClockOrder((trip) => trip.id))[0];
    const next = inWindow
      .filter(
        (trip) =>
          !hasSailed(trip.startsAt, now) &&
          trip.startsAt.getTime() - now.getTime() <= EMERGENCY_CARD_WINDOW_MS,
      )
      .sort(
        departureClockOrder(
          (trip) => trip.id,
          (trip) => (trip.boatId ? ctx.wave.boatNames.get(trip.boatId) : null),
        ),
      )[0];
    const boat = out ?? next;
    if (boat) {
      const words = emergencyCardBlankText(t, {
        time: at(boat.startsAt, timeZone, locale),
        day: formatRelativeDay(boat.startsAt, now, locale, timeZone),
        out: boat === out,
      });
      actions.push({
        id: "emergency-card-blank",
        kind: "emergency_card_blank",
        urgency: urgencyFor(boat.startsAt, now),
        subject: words.subject,
        context: null,
        // **A desk row, not a boat's** (Aaron 2026-10-23): the card is the
        // shop's, like the units question, so it files under "The desk" with no
        // departure. The detail still names the first boat it would sail on, and
        // its urgency is that boat's, so it ranks as high as the boat would.
        // Filed on the boat, it hid inside a folded Tomorrow the day before.
        detail: words.detail,
        actionLabel: words.actionLabel,
        href: shopPath(shopSlug, "settings", "emergency-reference"),
        dueAt: boat.startsAt,
      });
    }
  }
  if (facts.lostItemsWaiting > 0) {
    const words = lostItemsWaitingText(t, facts.lostItemsWaiting);
    actions.push({
      id: "lost-items-waiting",
      kind: "lost_items_waiting",
      urgency: "later",
      subject: words.subject,
      context: null,
      detail: "",
      actionLabel: words.actionLabel,
      href: staffDestinationHref(staffShopRoot(shopSlug), staffDestination("lostFound")),
      dueAt: null,
    });
  }
}
