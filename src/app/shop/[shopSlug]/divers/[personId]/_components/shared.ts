import type { getDiverProfile } from "@/db/divers";
import type { getShopById } from "@/db/shops";
import type { upcomingTripsWithCounts } from "@/db/trips";

export type DiverProfile = NonNullable<Awaited<ReturnType<typeof getDiverProfile>>>;
export type Shop = NonNullable<Awaited<ReturnType<typeof getShopById>>>;
export type UpcomingTrip = Awaited<ReturnType<typeof upcomingTripsWithCounts>>[number];

type Agency = "padi" | "ssi" | "naui" | "sdi" | "tdi" | "other";

export const AGENCY_LABELS: Record<Agency, string> = {
  padi: "PADI",
  ssi: "SSI",
  naui: "NAUI",
  sdi: "SDI",
  tdi: "TDI",
  other: "Other agency",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  deposit_paid: "Deposit paid",
  paid: "Paid",
  waived: "Waived",
  refunded: "Refunded",
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  open: "Invoice open",
  paid: "Paid",
  void: "Void",
  uncollectible: "Uncollectible",
  refunded: "Refunded",
};

export function statusTone(status: "pending" | "verified" | "rejected") {
  return status === "verified"
    ? "bg-success/10 text-success"
    : status === "rejected"
      ? "bg-danger/10 text-danger"
      : "bg-warning/10 text-warning";
}
