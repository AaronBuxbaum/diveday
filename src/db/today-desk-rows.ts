import { eq } from "drizzle-orm";
import { emergencyCardBlankText, lostItemsWaitingText } from "@/i18n/today-labels";
import { HOUR_MS } from "@/lib/clock";
import { emergencyCardHasNumbers } from "@/lib/emergency-reference";
import { formatRelativeDay } from "@/lib/format";
import { staffDestination, staffDestinationHref, staffShopRoot } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { type TodayAction, urgencyFor } from "@/lib/today";
import { hasSailed } from "@/lib/trips";
import type { DbExecutor } from "./client";
import { countOpenLostItems } from "./lost-items";
import { queryAll } from "./query-helpers";
import { shops } from "./schema";
import type { TodayRowsContext } from "./today-rows-context";
import { at } from "./today-shared";

/**
 * How far ahead a blank emergency card is worth a row: the window the offline
 * manifest is primed in (ADR 20260726-shopwide-offline-manifest-priming), so the
 * row arrives while the copy the crew will carry can still be fixed.
 */
export const EMERGENCY_CARD_WINDOW_MS = 48 * HOUR_MS;

/** The two desk facts Today reads beside its wave (fifth loop, items 3 and 7). */
export type DeskFacts = { emergencyCardHasNumbers: boolean; lostItemsWaiting: number };

export async function readDeskFacts(db: DbExecutor, shopId: string): Promise<DeskFacts> {
  const [[shop], lostItemsWaiting] = await queryAll(db, [
    () =>
      db
        .select({ emergencyReference: shops.emergencyReference })
        .from(shops)
        .where(eq(shops.id, shopId))
        .limit(1),
    () => countOpenLostItems(db, shopId),
  ]);
  return {
    // A shop row that is not there has no card to warn about.
    emergencyCardHasNumbers: shop ? emergencyCardHasNumbers(shop.emergencyReference) : true,
    lostItemsWaiting,
  };
}

/**
 * **The desk's two quiet facts** (fifth loop):
 *
 * - **Item 3, the blank emergency card.** When a departure sails inside the
 *   next 48 hours and the shop's card has no number to dial, the owner hears it
 *   the day before, not the captain at sea. One row for the shop, naming the
 *   first boat that would carry the blank card, filed at the desk so it is in
 *   today's list even when that boat is tomorrow's.
 * - **Item 7, found items waiting to go home.** One counting row while anything
 *   is open, which is also Lost and found's door from Today.
 */
export function pushDeskRows(actions: TodayAction[], ctx: TodayRowsContext, facts: DeskFacts) {
  const { inWindow, now, timeZone, locale, t, shopSlug } = ctx;
  if (!facts.emergencyCardHasNumbers) {
    const next = inWindow
      .filter(
        (trip) =>
          !hasSailed(trip.startsAt, now) &&
          trip.startsAt.getTime() - now.getTime() <= EMERGENCY_CARD_WINDOW_MS,
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
    if (next) {
      const words = emergencyCardBlankText(t, {
        time: at(next.startsAt, timeZone, locale),
        day: formatRelativeDay(next.startsAt, now, locale, timeZone),
      });
      actions.push({
        id: "emergency-card-blank",
        kind: "emergency_card_blank",
        urgency: urgencyFor(next.startsAt, now),
        subject: words.subject,
        context: null,
        detail: words.detail,
        actionLabel: words.actionLabel,
        href: shopPath(shopSlug, "settings", "emergency-reference"),
        dueAt: next.startsAt,
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
