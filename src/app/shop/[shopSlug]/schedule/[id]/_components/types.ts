import type { getBookingForTrip } from "@/db/bookings";
import type { listDiveSiteCreatures, listPublishedDiveSiteMoments } from "@/db/dive-sites";
import type { getBookingReadiness, getTripRequirements } from "@/db/readiness";
import type { getRentalFit } from "@/db/rental-fit";
import type { getShopBySlug } from "@/db/shops";
import type { getTripWithBooked, listTripDives } from "@/db/trips";
import type { fetchAutomatedMarineForecast } from "@/lib/marine-forecast";

export type Shop = NonNullable<Awaited<ReturnType<typeof getShopBySlug>>>;
export type Trip = NonNullable<Awaited<ReturnType<typeof getTripWithBooked>>>;
export type TripDive = Awaited<ReturnType<typeof listTripDives>>[number];
export type Confirmed = NonNullable<Awaited<ReturnType<typeof getBookingForTrip>>>;
export type Readiness = Awaited<ReturnType<typeof getBookingReadiness>>;
export type Requirement = Awaited<ReturnType<typeof getTripRequirements>>;
export type RentalFit = Awaited<ReturnType<typeof getRentalFit>> | null;
export type AutomatedForecast = Awaited<ReturnType<typeof fetchAutomatedMarineForecast>>;

export type DiveBriefing = TripDive & {
  creatures: Awaited<ReturnType<typeof listDiveSiteCreatures>>;
  moments: Awaited<ReturnType<typeof listPublishedDiveSiteMoments>>;
};

export const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Check your name and email and give it another go.",
  full: "Someone grabbed the last spot just before you — the boat's full.",
  available: "Good news — a spot just opened. Book it before it goes.",
  already: "You're already on this trip's list — no need to book twice.",
  unavailable: "This trip isn't taking bookings anymore.",
  "course-unavailable":
    "This course still needs an assigned instructor before it can take bookings.",
  "course-prerequisite":
    "This course needs a verified certification on file. Call the shop and they’ll help get your card checked.",
  fit: "We couldn’t save that rental fit. Please check the details and try again.",
  pay: "We couldn’t open the payment page just now. Your spot is safe — try again in a moment, or pay at the shop.",
};

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
