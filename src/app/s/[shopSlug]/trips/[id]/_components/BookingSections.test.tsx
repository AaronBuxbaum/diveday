// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_RENTAL_PRICING, type RentalPricing } from "@/lib/rentals";
import { renderDiver } from "@/test/intl";
import { BookSpotSection, TripFullSection } from "./BookingSections";
import type { Trip } from "./types";

/**
 * The per-diver price on the booking form is a list price, so it follows
 * `shops.currency` — Ingrid booking a Cozumel dive is quoted pesos, not
 * dollars (task 35, docs ADR 20260731-shop-currency).
 */
function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    shopId: "shop-1",
    title: "Palancar Reef Two-Tank",
    description: null,
    capacity: 8,
    booked: 2,
    plannedDives: 2,
    course: null,
    conditionsHold: false,
    ...overrides,
  } as Trip;
}

const tripRef = { shopSlug: "reef-shop", tripId: "trip-1", embed: false };

afterEach(cleanup);

/** Every figure the card renders at or above the total's own size. */
function loudFigures() {
  return [...document.querySelectorAll(".text-lg, .text-xl, .text-2xl, .text-3xl")]
    .map((node) => node.textContent ?? "")
    .filter((text) => /\d/.test(text));
}

describe("BookSpotSection price currency (task 35)", () => {
  it("quotes the per-diver price in the shop's currency, not dollars", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={130_000}
        currency="mxn"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={[]}
        rentalPricing={EMPTY_RENTAL_PRICING}
      />,
    );

    expect(screen.getByText(/MX\$1,300\.00 × 1 diver/)).toBeInTheDocument();
  });

  it("does not divide a zero-decimal currency by a hundred", () => {
    // JPY stores whole yen: a ¥13,000 dive is `13000`, and a literal `/ 100`
    // would offer the seat at ¥130.
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={13_000}
        currency="jpy"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={[]}
        rentalPricing={EMPTY_RENTAL_PRICING}
      />,
    );

    expect(screen.getByText(/¥13,000 × 1 diver/)).toBeInTheDocument();
  });

  it("still reads as dollars for a usd shop", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={13_000}
        currency="usd"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={[]}
        rentalPricing={EMPTY_RENTAL_PRICING}
      />,
    );

    expect(screen.getByText(/\$130\.00 × 1 diver/)).toBeInTheDocument();
  });
});

/**
 * ADR 20260827-the-divers-thread, decision 2. The card said the money five
 * ways — a description under the heading, a party total, a running checkout
 * total, a fee line and a tax line — and the hero shouted a sixth figure a page
 * above. It says it once now, in `MoneyBlock`, directly above the button.
 */
describe("BookSpotSection — the money says itself once", () => {
  it("renders exactly one figure at total scale when the diver pays now", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={9_500}
        currency="usd"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={[]}
        rentalPricing={EMPTY_RENTAL_PRICING}
      />,
    );

    expect(loudFigures()).toEqual(["$95.00"]);
    expect(screen.getByText("Due now")).toBeInTheDocument();
  });

  it("renders exactly one figure at total scale when the shop is paid at the counter", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking={false}
        perDiverPriceCents={9_500}
        currency="usd"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={[]}
        rentalPricing={EMPTY_RENTAL_PRICING}
      />,
    );

    expect(loudFigures()).toEqual(["$95.00"]);
    expect(screen.getByText("Due at the shop")).toBeInTheDocument();
  });

  it("says no money at all on an unpriced departure", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking={false}
        perDiverPriceCents={null}
        currency="usd"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={[]}
        rentalPricing={EMPTY_RENTAL_PRICING}
      />,
    );

    expect(loudFigures()).toEqual([]);
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("still calls itself Grab a spot, because the party still defaults to one", () => {
    // The SPEC allows a plural heading *if and only if* the count defaults
    // above 1. It does not, so no second heading key exists — the plural was
    // never a design preference, only a consequence.
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={9_500}
        currency="usd"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={[]}
        rentalPricing={EMPTY_RENTAL_PRICING}
      />,
    );

    expect(screen.getByRole("heading", { name: "Grab a spot" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "1 diver" })).toBeChecked();
  });

  it("no longer quotes the per-diver price under its own heading", () => {
    // The hero says the price once, at figure scale. A card description
    // repeating it was the second of five places this form said the money.
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={9_500}
        currency="usd"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={[]}
        rentalPricing={EMPTY_RENTAL_PRICING}
      />,
    );

    expect(screen.queryByText(/paid securely when you book/i)).not.toBeInTheDocument();
  });
});

/**
 * The fine print under the button, and nothing else under it. `TripTerms`
 * arrives as a node from the page; the retired full-terms disclosure must not
 * leave a second, redundant surface behind.
 */
describe("BookSpotSection — under the button", () => {
  function renderWithTerms(payAtBooking: boolean) {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking={payAtBooking}
        perDiverPriceCents={9_500}
        currency="usd"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={[]}
        rentalPricing={EMPTY_RENTAL_PRICING}
        terms={<p>Free cancellation until Fri, 11:00 AM EDT</p>}
      />,
    );
  }

  it("keeps only the cancellation fine print", () => {
    renderWithTerms(true);
    expect(screen.getByText(/Free cancellation until/)).toBeInTheDocument();
    expect(screen.queryByText("Full terms")).not.toBeInTheDocument();
    expect(screen.queryByText(/No account needed/i)).not.toBeInTheDocument();
  });

  it("promises a secure page only when there is a checkout to reach", () => {
    renderWithTerms(true);
    expect(screen.getByText(/secure Stripe page/i)).toBeInTheDocument();

    cleanup();
    renderWithTerms(false);
    expect(screen.queryByText(/secure Stripe page/i)).not.toBeInTheDocument();
  });

  it("states the shop's cancellation window and nothing else it was handed", () => {
    renderWithTerms(false);
    expect(screen.getByText(/Free cancellation until/)).toBeInTheDocument();
  });
});

/**
 * The requirement note is the *page's*, above the form. It was a sunken
 * bordered panel inside this raised card — a box inside a box, and the first
 * thing a diver met on reaching the form.
 */
describe("BookSpotSection — no box inside the box", () => {
  it("renders no requirement panel of its own", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={9_500}
        currency="usd"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={[]}
        rentalPricing={EMPTY_RENTAL_PRICING}
      />,
    );

    expect(screen.queryByText(/Who this trip is for/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/This charter is for divers with/i)).not.toBeInTheDocument();
  });

  it("wraps no party or gear step in a bordered fieldset", () => {
    const { container } = renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={4}
        payAtBooking
        perDiverPriceCents={9_500}
        currency="usd"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={["bcd", "regulator", "wetsuit", "mask_fins", "weights"]}
        rentalPricing={pricedRentals}
      />,
    );

    for (const fieldset of container.querySelectorAll("fieldset")) {
      expect(fieldset.className).not.toMatch(/\bborder\b/);
    }
  });
});

// Diver-selectable checkout upsells (docs ADR 20260801-checkout-upsells-rental-gear).
const pricedRentals: RentalPricing = {
  setCents: 4500,
  perItemCents: { bcd: 1500, regulator: 1500, wetsuit: 1200, mask_fins: 800, weights: 500 },
  nitroxCents: null,
};

describe("BookSpotSection rental gear at checkout", () => {
  it("shows a gear step per diver when the shop prices rental gear and checkout is on", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={12_000}
        currency="usd"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={["bcd", "regulator", "wetsuit", "mask_fins", "weights"]}
        rentalPricing={pricedRentals}
      />,
    );

    expect(screen.getByText("Rental gear", { selector: "legend" })).toBeInTheDocument();
    // Nothing is added until the diver asks for gear, so the running total
    // stays out of the way rather than announcing a charge nobody chose.
    expect(screen.queryByText("Rental gear", { selector: "dt" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Need rental gear?"));
    fireEvent.click(screen.getByLabelText(/^BCD/));
    // $120 seat + $15 BCD, resolved in one block and stated once at total
    // scale — the running "total due at checkout" line is gone with the other
    // four places this form used to say the money.
    expect(screen.getByText("Rental gear", { selector: "dt" })).toBeInTheDocument();
    expect(loudFigures()).toEqual(["$135.00"]);
  });

  it("shows no gear step when the shop hasn't priced any rental gear online", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={12_000}
        currency="usd"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={["bcd", "regulator", "wetsuit", "mask_fins", "weights"]}
        rentalPricing={EMPTY_RENTAL_PRICING}
      />,
    );

    expect(screen.queryByText("Rental gear", { selector: "legend" })).not.toBeInTheDocument();
  });

  it("shows no gear step when checkout itself is off, even with rental pricing configured", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking={false}
        perDiverPriceCents={null}
        currency="usd"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={["bcd", "regulator", "wetsuit", "mask_fins", "weights"]}
        rentalPricing={pricedRentals}
      />,
    );

    expect(screen.queryByText("Rental gear", { selector: "legend" })).not.toBeInTheDocument();
  });
});

/**
 * Issue #1019. With Stripe Tax on, every line is tax-*exclusive*: Stripe
 * computes tax at the session from an address this page has never seen and adds
 * it on top. The quoted total is therefore lower than the card is charged — on
 * the one figure a booking page must not surprise anyone with. The page cannot
 * compute the number, so it says the number is not the whole story.
 */
describe("BookSpotSection tax disclosure", () => {
  it("says tax is added at checkout when the shop has Stripe Tax on", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={19_500}
        currency="usd"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={[]}
        rentalPricing={EMPTY_RENTAL_PRICING}
        passThroughFee={{ name: "Marine park fee", amountCents: 2_500 }}
        taxEnabled
      />,
    );

    expect(screen.getByText("Tax")).toBeInTheDocument();
    expect(screen.getByText("added at checkout")).toBeInTheDocument();
  });

  it("says nothing about tax when the shop handles it outside DiveDay", () => {
    renderDiver(
      <BookSpotSection
        trip={trip()}
        tripRef={tripRef}
        remaining={6}
        payAtBooking
        perDiverPriceCents={19_500}
        currency="usd"
        locale="en-US"
        timeZone="America/New_York"
        rentalItems={[]}
        rentalPricing={EMPTY_RENTAL_PRICING}
        passThroughFee={{ name: "Marine park fee", amountCents: 2_500 }}
      />,
    );

    expect(screen.queryByText("Tax")).not.toBeInTheDocument();
  });
});

/**
 * **A full boat stops being the end of the conversation** (issue #1166, D06).
 *
 * The restraint is the half worth guarding hardest: this surface already links
 * to the whole schedule, so a list of vaguely-similar departures would be that
 * page with extra steps. Relevant, or nothing.
 */
describe("TripFullSection — the shop's own better answer", () => {
  const alternative = {
    tripId: "trip-2",
    title: "Palancar Reef Two-Tank",
    href: "/s/reef-shop/trips/trip-2",
    when: { weekday: "Thu", day: "7", month: "Aug" },
    reason: "same_site" as const,
  };

  function renderFull(alternatives?: React.ComponentProps<typeof TripFullSection>["alternatives"]) {
    return renderDiver(
      <TripFullSection
        shopSlug="reef-shop"
        trip={trip({ booked: 8 })}
        tripRef={tripRef}
        remaining={0}
        alternatives={alternatives}
      />,
    );
  }

  it("names each alternative, with the reason it is one", () => {
    renderFull([alternative]);
    const link = screen.getByRole("link", { name: "Palancar Reef Two-Tank" });
    expect(link).toHaveAttribute("href", "/s/reef-shop/trips/trip-2");
    // Why, not just what: an unexplained list of other boats tells a diver
    // nothing they could not get from the schedule link above it.
    expect(screen.getByText("Same site, Thu 7 Aug")).toBeInTheDocument();
  });

  it("says which are the same course, and which merely the same place", () => {
    renderFull([{ ...alternative, reason: "same_course" }]);
    expect(screen.getByText("Same course, Thu 7 Aug")).toBeInTheDocument();
    expect(screen.queryByText(/Same site/)).toBeNull();
  });

  it("renders no list at all when nothing is similar, and still offers the wait list", () => {
    // The ordinary case. A heading over an empty list is the furniture this
    // whole surface is written not to build, and the wait list is still the
    // page's real next step.
    renderFull([]);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getAllByText("Join the wait list").length).toBeGreaterThan(0);
  });
});
