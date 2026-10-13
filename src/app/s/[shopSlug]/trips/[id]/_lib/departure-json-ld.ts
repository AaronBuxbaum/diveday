import { publicAppUrl } from "@/lib/notifications";
import { tripPageJsonLd } from "@/lib/structured-data";

type JsonLdArgs = Parameters<typeof tripPageJsonLd>;

/**
 * The departure's one `Event`, its price the per-diver price the form quotes
 * and its organizer carrying the shop's rating (docs ADR
 * 20260729-booking-page-structured-data). The page asks for it on the
 * canonical standalone page only.
 */
export function departureJsonLd(
  shop: JsonLdArgs[0],
  trip: Omit<JsonLdArgs[1], "priceCents" | "diveSiteName"> & {
    diveSite: { name: string } | null;
  },
  priceCents: JsonLdArgs[1]["priceCents"],
  reviewAggregate: JsonLdArgs[3],
) {
  return tripPageJsonLd(
    shop,
    {
      id: trip.id,
      title: trip.title,
      description: trip.description,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      capacity: trip.capacity,
      booked: trip.booked,
      priceCents,
      diveSiteName: trip.diveSite?.name ?? null,
      conditionsHold: trip.conditionsHold,
    },
    publicAppUrl(),
    reviewAggregate,
  );
}
