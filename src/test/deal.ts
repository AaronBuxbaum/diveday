import type { AppDb } from "@/db/client";
import { offerSeats } from "@/db/lead-offers";
import { listAnytimeLeadsCovering } from "@/db/leads";
import { getTripWithBooked } from "@/db/trips-record";
import type { NotificationProvider } from "@/lib/notifications";
import type { PromotionProvider } from "@/lib/payments/promotions";

/**
 * A deal as a staffer sends it from the trip page: **Offer a seat** to every
 * last-minute-list lead the panel's third group would reach (optionally only
 * those whose person is named), carrying a discount. The answer is the deal's
 * own outcome (`offerSeats`), so a test reads the code and the count the way it
 * read the blast.
 */
export async function sendDeal(
  db: AppDb,
  input: {
    shopId: string;
    shopSlug: string;
    tripId: string;
    discountPercent?: number;
    discountAmountCents?: number;
    createdByPersonId?: string;
    recipientPersonIds?: string[];
  },
  promotions: PromotionProvider,
  notifications?: NotificationProvider,
) {
  const trip = await getTripWithBooked(db, input.shopId, input.tripId);
  const covering = trip
    ? await listAnytimeLeadsCovering(db, input.shopId, {
        id: trip.id,
        startsAt: trip.startsAt,
        course: trip.course ?? null,
      })
    : null;
  const allowed = input.recipientPersonIds ? new Set(input.recipientPersonIds) : null;
  const leadIds = (covering?.eligible ?? [])
    .filter(({ person }) => !allowed || allowed.has(person.id))
    .map(({ lead }) => lead.id);
  const outcome = await offerSeats(
    db,
    {
      shopId: input.shopId,
      shopSlug: input.shopSlug,
      tripId: input.tripId,
      leadIds,
      discount:
        input.discountAmountCents !== undefined
          ? { amountCents: input.discountAmountCents }
          : { percent: input.discountPercent ?? 0 },
      createdByPersonId: input.createdByPersonId,
    },
    notifications,
    promotions,
  );
  if (!outcome.deal) throw new Error("sendDeal: the offer carried no deal");
  return outcome.deal;
}
