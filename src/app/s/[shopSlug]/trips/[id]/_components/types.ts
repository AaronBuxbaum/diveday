import type { getBookingForTrip } from "@/db/bookings";
import type { listPublishedDiveSiteMoments } from "@/db/dive-sites";
import type { getBookingReadiness, getTripRequirements } from "@/db/readiness";
import type { DiverRentalFit } from "@/db/rental-fit";
import type { getShopBySlug } from "@/db/shops";
import type { getTripWithBooked, listTripDives, listTripScheduleDays } from "@/db/trips";
import type { MarineLifeCard } from "@/i18n/marine-life-labels";
import type { DiverMessageKey } from "@/i18n/messages";
import type { fetchAutomatedMarineForecast } from "@/lib/marine-forecast";

export type Shop = NonNullable<Awaited<ReturnType<typeof getShopBySlug>>>;
export type Trip = NonNullable<Awaited<ReturnType<typeof getTripWithBooked>>>;
export type TripDive = Awaited<ReturnType<typeof listTripDives>>[number];
/** One consecutive day a departure meets on — a `trip_schedule_days` row. */
export type TripMeetingDay = Awaited<ReturnType<typeof listTripScheduleDays>>[number];
export type Confirmed = NonNullable<Awaited<ReturnType<typeof getBookingForTrip>>>;
export type Readiness = Awaited<ReturnType<typeof getBookingReadiness>>;
export type Requirement = Awaited<ReturnType<typeof getTripRequirements>>;
/** Diver-facing projection — never the raw row (src/db/rental-fit.ts). */
export type RentalFit = DiverRentalFit | null;
export type AutomatedForecast = Awaited<ReturnType<typeof fetchAutomatedMarineForecast>>;

export type DiveBriefing = TripDive & {
  /**
   * The site's field guide, already resolved into the reader's language. Rows
   * store a catalog slug; the words are DiveDay's and are looked up per render
   * (ADR 20260813-marine-life-is-diveday-copy), so the page resolves them once
   * where the locale is known rather than handing raw rows down.
   */
  creatures: (MarineLifeCard & { id: string })[];
  moments: Awaited<ReturnType<typeof listPublishedDiveSiteMoments>>;
};

/**
 * Every refusal this page's booking/waitlist/rental-fit/payment actions can
 * report back, as a stable code — never rendered text (the code is what
 * crosses the `?error=` query param and the `bookSpot` action-state boundary,
 * both of which are attacker-observable). `ERROR_MESSAGE_KEYS` below is the
 * one place a code becomes a diver-facing sentence; every caller resolves
 * through it rather than growing its own copy.
 *
 * No `course-prerequisite` or `course-min-age` code on purpose. Both would
 * tell an anonymous submitter something about the person on file for an
 * email they merely typed — whether they hold a card, or whether they're a
 * child under N. `bookSpot` collapses both to the generic `unavailable`, and
 * adding codes for them here would be an invitation to wire them back up.
 */
export type ErrorCode =
  | "invalid"
  | "full"
  | "available"
  | "already"
  | "unavailable"
  | "course-unavailable"
  | "course-ratio-full"
  | "fit"
  | "pay"
  | "waiver"
  | "rate_limited";

export const ERROR_MESSAGE_KEYS: Record<ErrorCode, DiverMessageKey> = {
  invalid: "booking.errors.invalid",
  full: "booking.errors.full",
  available: "booking.errors.available",
  already: "booking.errors.already",
  unavailable: "booking.errors.unavailable",
  "course-unavailable": "booking.errors.courseUnavailable",
  "course-ratio-full": "booking.errors.courseRatioFull",
  fit: "booking.errors.fit",
  pay: "booking.errors.pay",
  // Reuses `/ready`'s own wording for the same refusal, so a diver who lands
  // on it from either surface reads one sentence, not two.
  waiver: "ready.waiverUnavailable",
  rate_limited: "common.rateLimited",
};

/** True for any string this page knows how to translate into an error notice. */
export function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_MESSAGE_KEYS, value);
}

/** What the confirmation's payment panel shows; null hides the panel entirely. */
export type PaymentPanel =
  | {
      state: "paid";
      amountCents: number | null;
      currency: string;
      /** True when only a deposit has been paid; a balance is still owed. */
      isDeposit: boolean;
      /** The per-diver balance still due after a deposit, or 0 when paid in full. */
      balanceDueCents: number;
    }
  | { state: "pending"; checkoutUrl: string }
  | { state: "payable" }
  | null;
