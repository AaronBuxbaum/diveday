// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiverRentalFit } from "@/db/rental-fit";
import type { RentalPricing } from "@/lib/rentals";
import { renderDiver } from "@/test/intl";
import { RentalFitForm } from "./RentalFitForm";

const emptyFit: DiverRentalFit = {
  rentsBcd: false,
  bcdSize: null,
  rentsRegulator: false,
  rentsWetsuit: false,
  wetsuitSize: null,
  drysuitSize: null,
  bootSize: null,
  rentsMaskFins: false,
  finSize: null,
  rentsWeights: false,
  weightPreference: null,
  rentsDiveComputer: false,
  rentsGopro: false,
  rentsDrysuit: false,
  rentsHoodGloves: false,
  rentsTorch: false,
  rentsSmb: false,
  note: null,
  fitStatedAt: new Date("2026-07-21T13:30:00.000Z"),
};

const defaultPricing: RentalPricing = {
  setCents: 5000,
  perItemCents: {
    bcd: 1500,
    regulator: 1500,
    wetsuit: 1500,
    mask_fins: 1000,
    weights: 500,
    dive_computer: 1000,
    gopro: 2000,
  },
  nitroxCents: 1000,
};

const mockAction = vi.fn();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RentalFitForm defaults", () => {
  /**
   * The post-booking form keeps seeding from `RentableItem.defaultRented` — it
   * is a *plan*, not a charge, and a diver with nothing on file is best served
   * by the shop's usual kit already ticked. Only the checkout picker
   * (`BookingGearFields`) deliberately ignores that flag, because there the
   * same tick puts money on a card.
   */
  it("still pre-checks the shop's usual kit for a diver with no fit on file", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={null}
        rentalItems={["bcd", "mask_fins", "gopro"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    // By role, not label text: "BCD" also prefixes the "BCD size" select.
    expect(screen.getByRole("checkbox", { name: /^BCD/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Mask & fins/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^GoPro/ })).not.toBeChecked();
  });

  it("lets a saved fit that rents nothing stay empty", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd", "mask_fins"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    expect(screen.getByRole("checkbox", { name: /^BCD/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Mask & fins/ })).not.toBeChecked();
  });
});

describe("RentalFitForm scope", () => {
  it("no longer carries the free-text note — it is its own question now (issue 627)", () => {
    // "Anything else the crew should know?" is a category of its own on
    // `/ready`, saved on its own (`saveNoteFromReady`), so it is no longer a
    // trailing field of the gear form. Two boxes for one answer is how a diver
    // ends up writing it in the one the crew is not reading.
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={null}
        rentalItems={["bcd", "wetsuit"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    expect(screen.queryByLabelText(/anything else/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /anything else/i })).not.toBeInTheDocument();
  });
});

describe("RentalFitForm nitrox gate", () => {
  it("drops the nitrox box on a course taught on air", () => {
    // The same two gates the booking page applies (`nitroxAvailableOn`), so a
    // diver cannot be offered enriched air here after being refused it at
    // checkout — or the other way round.
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={null}
        rentalItems={["bcd", "nitrox"]}
        course={{ nitroxCompatible: false }}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    expect(screen.getByRole("checkbox", { name: /^BCD/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /nitrox/i })).not.toBeInTheDocument();
  });

  it("keeps it on a course that runs on nitrox at a shop that fills it", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={null}
        rentalItems={["bcd", "nitrox"]}
        course={{ nitroxCompatible: true }}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    expect(screen.getByRole("checkbox", { name: /nitrox/i })).toBeInTheDocument();
  });
});

describe("RentalFitForm nitrox card gate", () => {
  function renderNitrox(props: {
    wantsNitrox: boolean;
    nitroxCardVerified: boolean;
    nitroxCardOnFile?: boolean;
    nitroxCardEntryOffered?: boolean;
  }) {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={null}
        rentalItems={["bcd", "nitrox"]}
        course={{ nitroxCompatible: true }}
        pricing={defaultPricing}
        plannedDives={2}
        saved={false}
        currency="usd"
        {...props}
      />,
    );
  }

  it("never asks for the card here — it is a certification, and it is captured with the others", async () => {
    // The two boxes this form used to grow when the request was ticked now live
    // behind the "Add your nitrox card" disclosure in the certification
    // checklist row, beside the level and specialty cards. Asking twice for one
    // card is how a diver ends up filing it in the place the shop is not
    // looking.
    const user = userEvent.setup();
    renderNitrox({
      wantsNitrox: true,
      nitroxCardVerified: false,
      nitroxCardOnFile: true,
    });
    await user.click(screen.getByRole("checkbox", { name: /nitrox/i }));
    expect(screen.queryByLabelText(/nitrox card number/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/nitrox agency/i)).not.toBeInTheDocument();
  });

  it("hides the request entirely until a card is on file (issue 627)", () => {
    // Was a disabled checkbox under a line pointing at the card disclosure. A
    // control a diver cannot use is a question they have to work out the answer
    // to; the section simply is not here until the card that makes it real is.
    renderNitrox({
      wantsNitrox: false,
      nitroxCardVerified: false,
      nitroxCardEntryOffered: true,
    });
    expect(screen.queryByRole("checkbox", { name: /nitrox/i })).not.toBeInTheDocument();
    // And the sentence that pointed at the disclosure is gone with it.
    expect(screen.queryByText(/add your nitrox card above/i)).not.toBeInTheDocument();
  });

  it("shows the request the moment a card is on file, sighted or not", () => {
    // A card the shop has not verified yet is enough: the diver has said what
    // they hold, and the fill gate (`authorizesNitroxFill`) is a separate,
    // stricter question asked at the tank.
    renderNitrox({
      wantsNitrox: false,
      nitroxCardVerified: false,
      nitroxCardOnFile: true,
    });
    expect(screen.getByRole("checkbox", { name: /nitrox/i })).toBeEnabled();
  });

  it("never hides a request the diver already has, so saving cannot erase it", () => {
    // An absent checkbox submits nothing, and `saveFitFromReady` writes that
    // absence as `wantsNitrox: false` — so hiding a live request would delete
    // it the next time this form was saved for any other reason. The booking
    // form gates nothing, which is exactly where such a request comes from.
    renderNitrox({
      wantsNitrox: true,
      nitroxCardVerified: false,
      nitroxCardEntryOffered: true,
    });
    const box = screen.getByRole("checkbox", { name: /nitrox/i });
    expect(box).toBeEnabled();
    expect(box).toBeChecked();
  });

  it("leaves the request standing on a page offering no card disclosure", () => {
    // A departure gating on nothing renders no certification row, so `/ready`
    // offers no card entry — and a diver can still arrive here carrying a
    // request made on the booking form, which gates nothing. Hiding the box
    // there would strand that request with nowhere on the page to restate it.
    renderNitrox({ wantsNitrox: true, nitroxCardVerified: false });
    expect(screen.getByRole("checkbox", { name: /nitrox/i })).toBeEnabled();
    expect(screen.queryByText(/check your nitrox card/i)).not.toBeInTheDocument();
  });

  it("keeps the box on a page offering no card disclosure", () => {
    // A departure that gates on nothing renders no certification row, so there
    // is nowhere on the page for a card to go — and hiding the box there would
    // leave a diver who wants nitrox no way to say so at all.
    renderNitrox({ wantsNitrox: false, nitroxCardVerified: false });
    expect(screen.getByRole("checkbox", { name: /nitrox/i })).toBeEnabled();
  });
});

describe("RentalFitForm Gear-Status Light-up Indicator", () => {
  it("renders 'Bringing own gear' by default if no rentals selected", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd", "mask_fins"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Bringing own gear, so no rental needed.");
  });

  it("renders 'Select sizes' when rentals are selected but size is missing", () => {
    const fitWithRentals = { ...emptyFit, rentsBcd: true };
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={fitWithRentals}
        rentalItems={["bcd", "mask_fins"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Select sizes to confirm your gear match.");
  });

  it("renders the recorded-size and dock-check message when all sizes are confirmed", () => {
    const confirmedFit = { ...emptyFit, rentsBcd: true, bcdSize: "M" };
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={confirmedFit}
        rentalItems={["bcd"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Sizes recorded.");
  });

  it("updates dynamically when user checks a rental and inputs a size", () => {
    const { container } = renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Bringing own gear, so no rental needed.");

    // Check BCD rental checkbox by selecting specifically input[type="checkbox"] label
    const bcdCheckbox = screen.getByLabelText(/bcd/i, {
      selector: 'input[type="checkbox"]',
    }) as HTMLInputElement;
    fireEvent.click(bcdCheckbox);

    // Indicator should now tell the user to select sizes
    expect(indicator).toHaveTextContent("Select sizes to confirm your gear match.");

    // Select BCD size
    const bcdSelect = container.querySelector('select[name="bcdSize"]') as HTMLSelectElement;
    fireEvent.change(bcdSelect, { target: { value: "L" } });

    // Indicator should now light up
    expect(indicator).toHaveTextContent("Sizes recorded.");
  });

  it("renders the recorded-size message for a wetsuit once its size is provided", () => {
    const wetsuitFit = { ...emptyFit, rentsWetsuit: true };
    const { container } = renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={wetsuitFit}
        rentalItems={["wetsuit"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Select sizes to confirm your gear match.");

    // Select wetsuit size
    const wetsuitSelect = container.querySelector(
      'select[name="wetsuitSize"]',
    ) as HTMLSelectElement;
    fireEvent.change(wetsuitSelect, { target: { value: "M" } });

    expect(indicator).toHaveTextContent("Sizes recorded.");
  });

  it("renders the recorded-size message for mask/fins because fin size is optional", () => {
    const finsFit = { ...emptyFit, rentsMaskFins: true };
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={finsFit}
        rentalItems={["mask_fins"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Sizes recorded.");
  });

  it("confirms gear match when BCD size is provided even if optional fin size is empty", () => {
    const mixedFit = { ...emptyFit, rentsBcd: true, rentsMaskFins: true };
    const { container } = renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={mixedFit}
        rentalItems={["bcd", "mask_fins"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Select sizes to confirm your gear match.");

    // Select BCD size
    const bcdSelect = container.querySelector('select[name="bcdSize"]') as HTMLSelectElement;
    fireEvent.change(bcdSelect, { target: { value: "L" } });

    // Should be confirmed even though fin size is not provided
    expect(indicator).toHaveTextContent("Sizes recorded.");
  });
});

/**
 * A drysuit is offered on the drysuit grid, not the wetsuit's (issue 1414): the
 * wall is racked by girth *and* cut, so the grid carries tall variants the
 * wetsuit scale has no room for. It shares the wetsuit's girth letters, `XS`
 * included — a `dive-domain-expert` pass read the old list's missing `XS`, one
 * field below a wetsuit select that starts there, as this shop having nothing
 * for a small-framed diver.
 *
 * The grid itself is a PROPOSAL pending the owner's confirmation (H-76); these
 * tests are what pin it, and changing them is the whole cost of changing the
 * scale.
 */
describe("RentalFitForm drysuit size (issue 1414)", () => {
  function renderDrysuit() {
    return renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={{ ...emptyFit, rentsDrysuit: true }}
        rentalItems={["drysuit"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );
  }

  it("offers the drysuit grid, never the wetsuit scale", () => {
    const { container } = renderDrysuit();
    const select = container.querySelector('select[name="drysuitSize"]') as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual([
      "",
      "XS",
      "S",
      "M",
      "MT",
      "L",
      "LT",
      "XL",
      "XLT",
      "XXL",
    ]);
  });

  /**
   * The one rule the grid is held to. `MS` and `ML` sat in this list as
   * in-between girths while `MT` beside them was a height; both readings are
   * real in the field, so a staffer packing on the strength of `MS` could hand
   * a short diver a suit cut for a tall one. Every code is now a girth letter
   * with at most a `T` after it, and that is what this pins — a size whose
   * second character means something else does not belong in a diver's select,
   * whatever the owner answers on H-76.
   */
  it("says one thing by the second letter: a girth letter, optionally tall", () => {
    const { container } = renderDrysuit();
    const select = container.querySelector('select[name="drysuitSize"]') as HTMLSelectElement;
    const codes = [...select.options].map((option) => option.value).filter(Boolean);
    expect(codes.filter((code) => !/^(?:XS|S|M|L|XL|XXL)T?$/.test(code))).toEqual([]);
  });

  /**
   * Parity with the wetsuit select one field above, which starts at `XS`. A
   * drysuit grid that keeps `XXL` and drops `XS` reads as a bug to the diver it
   * excludes, and a cold-water fleet stocks the small end because a large share
   * of its drysuit divers are small-framed.
   */
  it("starts where the wetsuit select starts", () => {
    const { container } = renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={{ ...emptyFit, rentsWetsuit: true, rentsDrysuit: true }}
        rentalItems={["wetsuit", "drysuit"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );
    for (const name of ["wetsuitSize", "drysuitSize"]) {
      const select = container.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
      expect([...select.options].map((option) => option.value)).toContain("XS");
    }
  });

  it("holds the gear match open until the drysuit has a size", () => {
    const { container } = renderDrysuit();
    const indicator = screen.getByTestId("gear-status-indicator");
    expect(indicator).toHaveTextContent("Select sizes to confirm your gear match.");
    const select = container.querySelector('select[name="drysuitSize"]') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "MT" } });
    expect(indicator).toHaveTextContent("Sizes recorded.");
  });

  it("never asks a shop that does not rent drysuits", () => {
    const { container } = renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={{ ...emptyFit, rentsBcd: true }}
        rentalItems={["bcd"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );
    expect(container.querySelector('select[name="drysuitSize"]')).toBeNull();
  });

  /**
   * The drysuit tick silently answers a second question: the packing list gives
   * a drysuit renter no boots line at all, because a rental drysuit usually has
   * its boots vulcanised on (`src/lib/dive-prep.ts`'s `rentedItems`). This hint
   * is the only place a diver ever reads that, so they neither pack a pair
   * against a suit that already has them nor turn up expecting to be handed
   * one. Same shape as the two jargon hints: in the DOM, wired by
   * `aria-describedby`, and out of the checkbox's accessible name.
   */
  it("says the boots come with the suit, one hover away", () => {
    renderDrysuit();
    const trigger = screen.getByRole("button", { name: "What is Drysuit?" });
    const describedBy = trigger.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toMatch(
      /boots are part of the suit/i,
    );
    expect(screen.getByRole("checkbox", { name: "Drysuit" })).toBeInTheDocument();
  });
});

describe("RentalFitForm currency (task 35)", () => {
  it("prices the rental list in the shop's currency, not dollars", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd", "mask_fins"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="mxn"
      />,
    );

    // 1500 minor units of MXN is $15.00 in pesos — the glyph and the grouping
    // both come from the currency, never a hardcoded USD formatter.
    expect(screen.getByText("MX$15.00")).toBeInTheDocument();
    expect(screen.queryByText("$15.00")).not.toBeInTheDocument();
  });

  it("does not divide a zero-decimal currency by a hundred", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="jpy"
      />,
    );

    // JPY stores whole yen, so 1500 is ¥1,500 — a literal `/ 100` would
    // quote the BCD at ¥15.
    expect(screen.getByText("¥1,500")).toBeInTheDocument();
  });

  it("still reads as dollars for a usd shop", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );

    expect(screen.getByText("$15.00")).toBeInTheDocument();
  });
});
