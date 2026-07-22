import type { BadgeTone } from "@/components/ui/badge";
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

/** The stored card status. Staff either certify a card or delete a bad one; there
 * is no "needs correction" state — a card the desk can't stand behind is removed. */
export type CardStatus = "pending" | "verified";

/**
 * What the badge shows: the stored status, or `expired` when a verified card has
 * lapsed. Expiry is a display overlay, not a stored state — the same card is
 * "certified" until its expiry passes, then "expired".
 */
export type CardDisplayStatus = CardStatus | "expired";

/**
 * Staff-facing card labels. A card is "certified" once staff confirm it (they
 * look the number up with the issuing agency and click Mark certified); the
 * stored status is still `verified`, which is what readiness reads. An expired
 * card reads as "expired" and no longer counts as valid.
 */
export const CARD_STATUS_LABELS: Record<CardDisplayStatus, string> = {
  pending: "pending",
  verified: "certified",
  expired: "expired",
};

/**
 * A card past its expiry no longer counts as a valid certification — the same
 * rule the readiness engine applies in `validVerifiedCertification`.
 */
export function isCardExpired(card: { expiresAt?: Date | null }, now: Date): boolean {
  return Boolean(card.expiresAt && card.expiresAt <= now);
}

/** An expired verified card reads as `expired`; every other state is unchanged. */
export function cardDisplayStatus(
  card: { status: CardStatus; expiresAt?: Date | null },
  now: Date,
): CardDisplayStatus {
  return card.status === "verified" && isCardExpired(card, now) ? "expired" : card.status;
}

export function statusTone(status: CardDisplayStatus): BadgeTone {
  switch (status) {
    case "verified":
      return "success";
    case "expired":
      return "danger";
    default:
      return "warning";
  }
}
