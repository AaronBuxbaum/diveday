/**
 * The phone foot bar's words on a full boat: the wait list while the shop
 * keeps one, else the way to another trip, since `#book` then holds only the
 * "find another trip" link (the wait list is a Features switch).
 */
export function fullFootLabel(shop: {
  waitlistEnabled: boolean;
}): "booking.waitlistHeading" | "booking.findAnotherTrip" {
  return shop.waitlistEnabled ? "booking.waitlistHeading" : "booking.findAnotherTrip";
}
