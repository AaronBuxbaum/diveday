// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderDiver } from "@/test/intl";
import { BookingConfirmation } from "./BookingConfirmation";
import type { Confirmed, PaymentPanel, Shop, Trip } from "./types";

/**
 * The confirmation's receipt line is *evidence of what was charged*, so it
 * renders the currency stored on the payment row — never today's shop setting
 * (task 35, docs ADR 20260731-shop-currency).
 */
const shop = {
  id: "shop-1",
  name: "Reef Shop",
  slug: "reef-shop",
  timezone: "America/Cancun",
  dockCallMinutes: 30,
  currency: "mxn",
  rentalItems: [],
  rentalPricing: { setCents: null, perItemCents: {}, nitroxCents: null },
  contactEmail: null,
  contactPhone: null,
} as unknown as Shop;

const trip = {
  id: "trip-1",
  title: "Palancar Reef Two-Tank",
  startsAt: new Date("2026-08-14T13:00:00Z"),
  endsAt: new Date("2026-08-14T17:00:00Z"),
  plannedDives: 2,
} as unknown as Trip;

const confirmed = {
  booking: { id: "booking-1", wantsNitrox: false },
  person: { id: "person-1", fullName: "Ingrid Vogel", email: null },
} as unknown as Confirmed;

function renderConfirmation(payment: PaymentPanel) {
  return renderDiver(
    <BookingConfirmation
      shop={shop}
      shopSlug="reef-shop"
      locale="en-US"
      trip={trip}
      confirmed={confirmed}
      readiness={null}
      requirement={null}
      fitRef={{ shopSlug: "reef-shop", tripId: "trip-1", embed: false, token: "tok" }}
      rentalFit={null}
      nitroxCardVerified={false}
      fitSaved={false}
      payment={payment}
      payCancelled={false}
      readinessLink={null}
      progression={null}
    />,
  );
}

afterEach(cleanup);

describe("BookingConfirmation receipt currency (task 35)", () => {
  it("shows a settled payment in the currency it was charged in", () => {
    renderConfirmation({
      state: "paid",
      amountCents: 130_000,
      currency: "mxn",
      isDeposit: false,
      balanceDueCents: 0,
    });

    expect(screen.getByText(/MX\$1,300\.00/)).toBeInTheDocument();
  });

  it("does not divide a zero-decimal currency by a hundred", () => {
    // A ¥13,000 charge is stored as whole yen; a literal `/ 100` would tell
    // the diver they paid ¥130.
    renderConfirmation({
      state: "paid",
      amountCents: 13_000,
      currency: "jpy",
      isDeposit: false,
      balanceDueCents: 0,
    });

    expect(screen.getByText(/¥13,000/)).toBeInTheDocument();
  });

  it("quotes the outstanding balance in the same currency as the deposit", () => {
    renderConfirmation({
      state: "paid",
      amountCents: 40_000,
      currency: "eur",
      isDeposit: true,
      balanceDueCents: 90_000,
    });

    expect(screen.getByText(/€400\.00/)).toBeInTheDocument();
    expect(screen.getByText(/€900\.00/)).toBeInTheDocument();
  });
});
