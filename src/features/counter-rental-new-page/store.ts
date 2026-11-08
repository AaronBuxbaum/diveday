import { listDiverSummaries } from "@/features/divers";
import {
  counterRentalCards,
  counterRentalHasNitroxFillCard,
  counterRentalPerson,
  counterRentalUnitLabel,
  counterRentalWaiverStandings,
} from "@/features/gear-counter-rentals";
import { canPersonManageOrders } from "../../db/authz";
import type { AppDb } from "../../db/client";
import { countGearItems, listAvailableGearUnits } from "../../db/gear";
import { canAcceptPayments, getShopStripeAccount } from "../../db/stripe-accounts";
import type { CalendarDate } from "../../lib/calendar-date";

/**
 * The counter rental page's question in one call. Who: the chosen person (or
 * the divers matching the search), their cards and waiver standing (said while
 * they are still at the counter, issue #2346; informing only, never a gate).
 * Rent, once a person is chosen: the units free over the window (none when
 * the window is refused), and whether this person may invoice (manages orders,
 * and the shop takes payments). The notice's unit label is this shop's own,
 * looked up by id.
 */
export async function getCounterRentalNewPage(
  db: AppDb,
  shop: { id: string; timezone: string },
  input: {
    actorPersonId: string;
    personId: string | null | undefined;
    query: string;
    noticeUnitId: string | null | undefined;
    window: { from: CalendarDate; until: CalendarDate; todayLocal: CalendarDate };
    windowRefused: boolean;
  },
) {
  const { personId, query, noticeUnitId, window } = input;
  const [person, fleetSize, matches, cards, nitroxCard, noticeUnit, waivers] = await Promise.all([
    personId ? counterRentalPerson(db, shop.id, personId) : null,
    countGearItems(db, shop.id),
    !personId && query
      ? listDiverSummaries(db, shop.id, { query, limit: 6, timeZone: shop.timezone })
      : null,
    personId ? counterRentalCards(db, shop.id, personId) : null,
    personId ? counterRentalHasNitroxFillCard(db, shop.id, personId) : false,
    noticeUnitId ? counterRentalUnitLabel(db, shop.id, noticeUnitId) : null,
    personId
      ? counterRentalWaiverStandings(db, {
          shopId: shop.id,
          timezone: shop.timezone,
          personIds: [personId],
        })
      : null,
  ]);
  const [units, canManageOrders, paymentsReady] = person
    ? await Promise.all([
        input.windowRefused
          ? []
          : listAvailableGearUnits(db, shop.id, {
              ...window,
              serviceAsOf: window.until,
              includeUnavailable: true,
            }),
        canPersonManageOrders(db, shop.id, input.actorPersonId),
        (async () => canAcceptPayments(await getShopStripeAccount(db, shop.id)))(),
      ])
    : [[], false, false];
  return {
    person,
    fleetSize,
    matches,
    cards,
    nitroxCard,
    noticeUnit,
    waivers,
    units,
    can: {
      manageOrders: canManageOrders,
      paymentsReady,
      invoice: canManageOrders && paymentsReady,
    },
  };
}
