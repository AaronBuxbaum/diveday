import type { DiverTranslator } from "@/i18n/messages";
import { dockCallAt } from "@/lib/dock-call";
import { formatTimeTz } from "@/lib/format";
import { meetingPointOf } from "@/lib/meeting-point";
import type { ShopAddressParts } from "@/lib/shop-address";

export type ArrivalCardShop = {
  name: string;
  slug: string;
  timezone: string;
  contactPhone: string | null;
  contactEmail: string | null;
  address: ShopAddressParts;
};

export type ArrivalCardTrip = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  meetingPointLabel: string | null;
  meetingPointAddress: string | null;
  arrivalLandmark: string | null;
  arrivalParkingNote: string | null;
  arrivalTransitNote: string | null;
  arrivalLookFor: string | null;
  arrivalFirstInteraction: string | null;
  arrivalPhotoUrl: string | null;
};

function clean(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/** The arrival projection shared by the booked Ready view and saved card. */
export function arrivalCardFacts(shop: ArrivalCardShop, trip: ArrivalCardTrip) {
  // One reading of "where to go", shared with the mail and the printed pass
  // (`src/lib/meeting-point.ts`), so the page and what the diver carries agree.
  const point = meetingPointOf({
    shopName: shop.name,
    shopAddress: shop.address,
    meetingPointLabel: trip.meetingPointLabel,
    meetingPointAddress: trip.meetingPointAddress,
    arrivalLandmark: trip.arrivalLandmark,
    arrivalParkingNote: trip.arrivalParkingNote,
  });
  return {
    label: point.label,
    address: point.address,
    mapQuery: point.mapQuery,
    landmark: point.landmark,
    parkingNote: point.parking,
    transitNote: clean(trip.arrivalTransitNote),
    lookFor: clean(trip.arrivalLookFor),
    firstInteraction: clean(trip.arrivalFirstInteraction),
    photoUrl: clean(trip.arrivalPhotoUrl),
  };
}

export function arrivalDockCallLine(
  t: DiverTranslator,
  startsAt: Date,
  dockCallMinutes: number | null | undefined,
  locale: string,
  timeZone: string,
): string | null {
  if (dockCallMinutes == null) return null;
  const at = dockCallAt(startsAt, dockCallMinutes);
  if (!at) return null;
  return t("ready.dockCallLine", {
    time: formatTimeTz(at, locale, timeZone),
    dock: t("notifications.common.dockCallMinutes", { minutes: dockCallMinutes }),
  });
}
