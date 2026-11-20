import type { StaffTranslator } from "@/i18n/staff-messages";

export function tripSeatSummary(
  t: StaffTranslator,
  booked: number,
  capacity: number,
  certifiedPassengers: number | null,
): string {
  const seats = t("trips.clock.sentence.booked", { booked, capacity });
  return certifiedPassengers === null
    ? seats
    : `${seats} · ${t("trips.about.certificatePassengers", { count: certifiedPassengers })}`;
}
