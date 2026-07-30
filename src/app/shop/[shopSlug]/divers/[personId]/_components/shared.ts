import type { BadgeTone } from "@/components/ui/badge";
import type { getDiverProfile } from "@/db/divers";
import type { getShopById } from "@/db/shops";
import type { upcomingTripsWithCounts } from "@/db/trips";
import type { StaffMessageKey } from "@/i18n/staff-messages";
import { type CalendarDate, isCalendarDateExpired } from "@/lib/calendar-date";

export type DiverProfile = NonNullable<Awaited<ReturnType<typeof getDiverProfile>>>;
export type Shop = NonNullable<Awaited<ReturnType<typeof getShopById>>>;
export type UpcomingTrip = Awaited<ReturnType<typeof upcomingTripsWithCounts>>[number];

type Agency = "padi" | "ssi" | "naui" | "sdi" | "tdi" | "other";

/** Every value resolves to a `StaffMessageKey` now, not a rendered word — see `divers.shared.*`. */
export const AGENCY_KEYS: Record<Agency, StaffMessageKey> = {
  padi: "divers.shared.agencies.padi",
  ssi: "divers.shared.agencies.ssi",
  naui: "divers.shared.agencies.naui",
  sdi: "divers.shared.agencies.sdi",
  tdi: "divers.shared.agencies.tdi",
  other: "divers.shared.agencies.other",
};

export const PAYMENT_STATUS_KEYS: Record<string, StaffMessageKey> = {
  unpaid: "divers.shared.paymentStatus.unpaid",
  deposit_paid: "divers.shared.paymentStatus.depositPaid",
  paid: "divers.shared.paymentStatus.paid",
  waived: "divers.shared.paymentStatus.waived",
  refunded: "divers.shared.paymentStatus.refunded",
};

export const ORDER_STATUS_KEYS: Record<string, StaffMessageKey> = {
  open: "divers.shared.orderStatus.open",
  paid: "divers.shared.orderStatus.paid",
  void: "divers.shared.orderStatus.void",
  uncollectible: "divers.shared.orderStatus.uncollectible",
  refunded: "divers.shared.orderStatus.refunded",
};

/** The stored card status. Staff either certify a card or delete a bad one; there
 * is no "needs correction" state — a card the desk can't stand behind is removed. */
export type CardStatus = "pending" | "verified";

/**
 * What the badge shows: the stored status, or `expired` when a verified card is
 * past the shop's refresher-due date. Real C-cards do not expire (glossary
 * **C-card**); this date is a shop-set *refresher-due* policy, not a card
 * expiry — so the `expired` display key surfaces to staff as "refresher due".
 * It is a display overlay, not a stored state.
 */
export type CardDisplayStatus = CardStatus | "expired";

/**
 * Staff-facing card labels. A card is "certified" once staff confirm it (they
 * look the number up with the issuing agency and click Mark certified); the
 * stored status is still `verified`, which is what readiness reads. Once a card
 * passes its shop-set refresher-due date it reads as "refresher due" and no
 * longer counts as valid until refreshed (H-08).
 */
export const CARD_STATUS_KEYS: Record<CardDisplayStatus, StaffMessageKey> = {
  pending: "divers.shared.cardStatus.pending",
  verified: "divers.shared.cardStatus.verified",
  expired: "divers.shared.cardStatus.expired",
};

/**
 * A card past its shop-set refresher-due date no longer counts as a valid
 * certification — the same rule the readiness engine applies in
 * `validVerifiedCertification`, compared against the shop's own local calendar
 * date rather than a UTC instant (CR-009, src/lib/calendar-date.ts). The name
 * predates the H-08 refresher-due relabel and still tracks the same
 * `expiresAt` column.
 */
export function isCardExpired(
  card: { expiresAt?: CalendarDate | null },
  todayLocal: CalendarDate,
): boolean {
  return Boolean(card.expiresAt && isCalendarDateExpired(card.expiresAt, todayLocal));
}

/** An expired verified card reads as `expired`; every other state is unchanged. */
export function cardDisplayStatus(
  card: { status: CardStatus; expiresAt?: CalendarDate | null },
  todayLocal: CalendarDate,
): CardDisplayStatus {
  return card.status === "verified" && isCardExpired(card, todayLocal) ? "expired" : card.status;
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

/**
 * Import provenance shared by level, specialty, and nitrox cards
 * (ADR 20260724-import-verified-cards). A card brought in by the contact
 * importer lands `verified` with `importedAt` set and `reviewedAt` still null —
 * DiveDay trusts the card the shop's own system already checked, but keeps it
 * marked imported forever so it is never mistaken for one this shop carded on
 * sight. `needsImportConfirm` is the one-tap-confirm nudge: an imported card no
 * staff member here has confirmed yet. Confirming stamps `reviewedAt` through
 * the normal review path; the imported marker stays.
 */
export type ImportedCard = { importedAt?: Date | string | null; reviewedAt?: Date | string | null };

export function isImportedCard(card: ImportedCard): boolean {
  return Boolean(card.importedAt);
}

export function needsImportConfirm(card: ImportedCard): boolean {
  return Boolean(card.importedAt) && !card.reviewedAt;
}

/**
 * The badge for a card **whose gate is still shut** — an imported specialty card
 * (the dive it authorizes waits) or an imported nitrox card (the fill waits, and
 * gives plain air meanwhile). Neither may read the same as a hand-verified card,
 * which does clear: at a busy desk a green "certified" alone gets a diver told
 * they're fine for the 30 m wall, or gets them handed an EANx tank
 * (ADR 20260725-import-specialty-cards, 20260725-imported-card-sighting).
 *
 * A *level* card is deliberately not in this set: an imported level card is
 * genuinely valid on arrival (20260724-import-verified-cards), so green
 * "certified" is true of it and its confirm is only a nudge.
 */
export type HeldCardDisplayStatus = CardDisplayStatus | "confirm_to_clear";

export const HELD_CARD_STATUS_KEYS: Record<HeldCardDisplayStatus, StaffMessageKey> = {
  ...CARD_STATUS_KEYS,
  confirm_to_clear: "divers.shared.cardStatus.confirmToClear",
};

export function heldCardDisplayStatus(
  card: { status: CardStatus; expiresAt?: CalendarDate | null } & ImportedCard,
  todayLocal: CalendarDate,
): HeldCardDisplayStatus {
  const base = cardDisplayStatus(card, todayLocal);
  return base === "verified" && needsImportConfirm(card) ? "confirm_to_clear" : base;
}

export function heldCardStatusTone(status: HeldCardDisplayStatus): BadgeTone {
  // Warning, not success: the card is on file, and the gate is not open yet.
  return status === "confirm_to_clear" ? "warning" : statusTone(status);
}
