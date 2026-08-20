// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderDiver } from "@/test/intl";
import { BookingConfirmation } from "./BookingConfirmation";
import type { Confirmed, PaymentPanel, Readiness, Requirement, Shop, Trip } from "./types";

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

/** A trip that gates on a waiver, and a diver whose link is issued but unsigned. */
const waiverRequirement = { requiresWaiver: true } as unknown as Requirement;
const waiverPending = {
  status: "blocked",
  blockers: [{ code: "waiver_pending" }],
} as unknown as Readiness;

function renderConfirmation(
  payment: PaymentPanel,
  overrides: {
    readiness?: Readiness;
    requirement?: Requirement;
    embed?: boolean;
    emailsOnTheWay?: boolean;
  } = {},
) {
  return renderDiver(
    <BookingConfirmation
      shop={shop}
      shopSlug="reef-shop"
      locale="en-US"
      trip={trip}
      confirmed={confirmed}
      readiness={overrides.readiness ?? null}
      requirement={overrides.requirement ?? null}
      fitRef={{
        shopSlug: "reef-shop",
        tripId: "trip-1",
        embed: overrides.embed ?? false,
        token: "tok",
      }}
      rentalFit={null}
      nitroxCardVerified={false}
      nitroxCardOnFile={false}
      fitSaved={false}
      payment={payment}
      payCancelled={false}
      readinessLink="/ready/tok"
      emailsOnTheWay={overrides.emailsOnTheWay ?? false}
      partySeats={[]}
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

describe("BookingConfirmation next step", () => {
  it("names payment without claiming it is the only open step", () => {
    renderConfirmation(
      { state: "payable" },
      { readiness: waiverPending, requirement: waiverRequirement },
    );

    expect(
      screen.getByRole("heading", { name: "Finish paying for your seat" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /One thing left/ })).not.toBeInTheDocument();
  });

  it("offers the waiver itself, not just the readiness page, when one is outstanding", () => {
    renderConfirmation(null, { readiness: waiverPending, requirement: waiverRequirement });

    expect(screen.getByRole("button", { name: "Sign your waiver now" })).toBeInTheDocument();
    // The readiness page stays reachable — it is the calmer, everything-else link.
    expect(screen.getByRole("link", { name: /readiness page/ })).toBeInTheDocument();
  });

  it("keeps the waiver as the primary action when there is no payment competing for it", () => {
    renderConfirmation(null, { readiness: waiverPending, requirement: waiverRequirement });

    expect(screen.getByRole("button", { name: "Sign your waiver now" }).className).toContain(
      "bg-primary",
    );
  });

  it("demotes the waiver button while an unpaid checkout still holds the primary", () => {
    renderConfirmation(
      { state: "payable" },
      { readiness: waiverPending, requirement: waiverRequirement },
    );

    const waiverButton = screen.getByRole("button", { name: "Sign your waiver now" });
    expect(waiverButton.className).not.toContain("bg-primary");
    expect(screen.getByRole("button", { name: "Pay now" }).className).toContain("bg-primary");
  });

  it("offers no waiver button when nothing about the waiver is outstanding", () => {
    renderConfirmation(null);

    expect(screen.queryByRole("button", { name: "Sign your waiver now" })).not.toBeInTheDocument();
  });

  it("leaves the waiver button out of the embed, where /waivers can't be framed", () => {
    renderConfirmation(null, {
      readiness: waiverPending,
      requirement: waiverRequirement,
      embed: true,
    });

    expect(screen.queryByRole("button", { name: "Sign your waiver now" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /readiness page/ })).toBeInTheDocument();
  });
});

describe("BookingConfirmation email promise", () => {
  it("warns that two emails are coming once both have actually been sent", () => {
    renderConfirmation(null, { emailsOnTheWay: true });

    expect(screen.getByText(/Two emails are on their way/)).toBeInTheDocument();
  });

  it("promises nothing to a diver whose emails never went out", () => {
    // The walk-in party member with no address of their own: claiming mail is
    // coming would send them looking for something that never left.
    renderConfirmation(null, { emailsOnTheWay: false });

    expect(screen.queryByText(/Two emails are on their way/)).not.toBeInTheDocument();
  });
});
