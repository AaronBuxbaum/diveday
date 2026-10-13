import { type ShopAddressParts, shopAddressLines, shopMapQuery } from "./shop-address";

/**
 * **Where a diver goes for one departure**, in one shape every surface reads:
 * the public trip page and `/ready` ("Where to go", `TripArrivalCard`), the
 * confirmation, both reminders, the reminder text and the printed pass (ux
 * review 2026-10-11, items 4 and 27). Before this only the two pages said it,
 * so everything a diver carries to the dock at 6:40 AM said when and not where.
 *
 * The departure's own meeting point when the shop set one, otherwise the
 * shop's own address under the shop's name. `mapQuery` is null whenever an
 * honest query cannot be built (a label with no address and no shop address
 * behind it): a map link that centres on whatever the search half-matches is
 * worse than none (`src/lib/maps.ts`).
 */
export type MeetingPoint = {
  label: string;
  address: string | null;
  landmark: string | null;
  parking: string | null;
  mapQuery: string | null;
};

export type MeetingPointSource = {
  shopName: string;
  shopAddress: ShopAddressParts;
  meetingPointLabel: string | null;
  meetingPointAddress: string | null;
  arrivalLandmark: string | null;
  arrivalParkingNote: string | null;
};

function clean(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

export function meetingPointOf(source: MeetingPointSource): MeetingPoint {
  const shopLines = shopAddressLines(source.shopAddress);
  const customLabel = clean(source.meetingPointLabel);
  const customAddress = clean(source.meetingPointAddress);
  const label = customLabel ?? source.shopName;
  const address = customAddress ?? (shopLines.length > 0 ? shopLines.join(", ") : null);
  const mapQuery = customAddress
    ? [label, customAddress].filter(Boolean).join(", ")
    : customLabel
      ? address
        ? [label, address].join(", ")
        : null
      : shopMapQuery(source.shopName, source.shopAddress);
  return {
    label,
    address,
    landmark: clean(source.arrivalLandmark),
    parking: clean(source.arrivalParkingNote),
    mapQuery,
  };
}

/**
 * Whether a departure's meeting point moved between two readings of it — the
 * label or the address, the two things a diver navigates by. A landmark or a
 * parking note is help finding the place, not the place.
 */
export function meetingPointMoved(before: MeetingPoint, after: MeetingPoint): boolean {
  return before.label !== after.label || before.address !== after.address;
}

/**
 * The longest each field may be when a message carries it. Generous — the
 * staff form caps a label at 120 and a landmark at 300 — and enforced by
 * {@link meetingPointForMessage} rather than refused, because a message that
 * fails its schema is not sent at all, and a long parking note must never cost
 * a diver their confirmation.
 */
export const MEETING_POINT_LIMITS = {
  label: 300,
  address: 600,
  landmark: 600,
  parking: 600,
  mapQuery: 1_200,
} as const;

function clip(value: string | null, max: number): string | null {
  return value === null ? null : value.slice(0, max).trim() || null;
}

/** {@link MeetingPoint}, clipped to what a notification schema accepts. */
export function meetingPointForMessage(point: MeetingPoint): MeetingPoint {
  return {
    label: point.label.slice(0, MEETING_POINT_LIMITS.label).trim() || point.label.slice(0, 1),
    address: clip(point.address, MEETING_POINT_LIMITS.address),
    landmark: clip(point.landmark, MEETING_POINT_LIMITS.landmark),
    parking: clip(point.parking, MEETING_POINT_LIMITS.parking),
    mapQuery: clip(point.mapQuery, MEETING_POINT_LIMITS.mapQuery),
  };
}

/** The shop row's address columns, as {@link ShopAddressParts}. */
export function shopAddressPartsOf(shop: {
  addressStreet: string | null;
  addressLocality: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
}): ShopAddressParts {
  return {
    street: shop.addressStreet,
    locality: shop.addressLocality,
    region: shop.addressRegion,
    postalCode: shop.addressPostalCode,
    country: shop.addressCountry,
  };
}

export type MeetingPointShopRow = Parameters<typeof shopAddressPartsOf>[0] & { name: string };
export type MeetingPointTripRow = {
  meetingPointLabel: string | null;
  meetingPointAddress: string | null;
  arrivalLandmark: string | null;
  arrivalParkingNote: string | null;
};

/** {@link meetingPointOf} straight from a shop row and a trip row. */
export function meetingPointOfRows(
  shop: MeetingPointShopRow,
  trip: MeetingPointTripRow,
): MeetingPoint {
  return meetingPointOf({
    shopName: shop.name,
    shopAddress: shopAddressPartsOf(shop),
    meetingPointLabel: trip.meetingPointLabel,
    meetingPointAddress: trip.meetingPointAddress,
    arrivalLandmark: trip.arrivalLandmark,
    arrivalParkingNote: trip.arrivalParkingNote,
  });
}

/**
 * The meeting point as one staff line — "Slip 4, the east dock · 12 Ocean
 * Way, Key Largo" — the place, then its address when it has one. Staff pages
 * that state where the boat meets (the Details tab's About rows, the
 * manifest's plan) read this, so the crew never knows less than the diver
 * about the dock (UX review 2026-10-13, item 18).
 */
export function meetingPointLine(point: MeetingPoint): string {
  return point.address ? `${point.label} · ${point.address}` : point.label;
}
