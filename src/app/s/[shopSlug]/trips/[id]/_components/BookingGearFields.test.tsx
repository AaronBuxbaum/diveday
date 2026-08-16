// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RentalPricing } from "@/lib/rentals";
import { renderDiver } from "@/test/intl";
import { BookingGearFields } from "./BookingGearFields";

const pricing: RentalPricing = {
  setCents: 4500,
  perItemCents: {
    bcd: 1500,
    regulator: 1500,
    wetsuit: 1200,
    mask_fins: 800,
    weights: 500,
    dive_computer: 1000,
    gopro: 2000,
  },
  nitroxCents: 1200,
};

const rentalItems = [
  "bcd",
  "regulator",
  "wetsuit",
  "mask_fins",
  "weights",
  "dive_computer",
  "gopro",
  "nitrox",
];

afterEach(cleanup);

/** Open the per-diver disclosure — gear is opt-in, so nothing is offered until then. */
function askForGear() {
  fireEvent.click(screen.getByLabelText("Need rental gear?"));
}

describe("BookingGearFields", () => {
  it("asks one question and offers no gear until the diver says yes", () => {
    renderDiver(
      <BookingGearFields
        index={0}
        showDiverLabel={false}
        rentalItems={rentalItems}
        course={null}
        pricing={pricing}
        plannedDives={2}
        currency="usd"
      />,
    );

    expect(screen.getByLabelText("Need rental gear?")).not.toBeChecked();
    expect(screen.getByText(/you won't be charged for gear/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^BCD/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/I’d like nitrox/)).not.toBeInTheDocument();
  });

  // The regression this component exists to prevent: every core item used to
  // arrive pre-ticked, so a diver who owns a full kit was billed for six paid
  // line items unless they unticked each one, per party member.
  it("pre-checks no paid item once the picker opens", () => {
    const { container } = renderDiver(
      <BookingGearFields
        index={0}
        showDiverLabel={false}
        rentalItems={rentalItems}
        course={null}
        pricing={pricing}
        plannedDives={2}
        currency="usd"
      />,
    );

    askForGear();

    for (const box of container.querySelectorAll<HTMLInputElement>(
      'input[name^="gear-0-"], input[name="nitrox-0"]',
    )) {
      expect(box).not.toBeChecked();
    }
    expect(screen.queryByText(/Gear for this diver/)).not.toBeInTheDocument();
  });

  it("reports a zero subtotal for a diver who never opens the gear question", () => {
    const onSubtotalChange = vi.fn();
    renderDiver(
      <BookingGearFields
        index={0}
        showDiverLabel={false}
        rentalItems={rentalItems}
        course={null}
        pricing={pricing}
        plannedDives={2}
        currency="usd"
        onSubtotalChange={onSubtotalChange}
      />,
    );

    expect(onSubtotalChange).toHaveBeenLastCalledWith(0, 0);
  });

  it("drops every pick when the diver closes the question again", () => {
    const onSubtotalChange = vi.fn();
    renderDiver(
      <BookingGearFields
        index={0}
        showDiverLabel={false}
        rentalItems={rentalItems}
        course={null}
        pricing={pricing}
        plannedDives={2}
        currency="usd"
        onSubtotalChange={onSubtotalChange}
      />,
    );

    askForGear();
    fireEvent.click(screen.getByLabelText(/^BCD/));
    expect(onSubtotalChange).toHaveBeenLastCalledWith(0, 1_500);

    askForGear();
    expect(onSubtotalChange).toHaveBeenLastCalledWith(0, 0);
  });

  /**
   * The definitions used to sit under the checklist as permanent paragraphs.
   * They now hang off the item they explain as an `InfoHint` — hidden until
   * hover, tap, or focus, but always in the DOM and wired to the trigger by
   * `aria-describedby`, so a screen reader still gets the whole explanation
   * without opening anything.
   */
  it("explains the jargon it just put in front of a newcomer, one hover away", () => {
    renderDiver(
      <BookingGearFields
        index={0}
        showDiverLabel={false}
        rentalItems={rentalItems}
        course={null}
        pricing={pricing}
        plannedDives={2}
        currency="usd"
      />,
    );

    askForGear();

    for (const [item, detail] of [
      ["BCD", /inflatable vest you wear that holds your tank/i],
      ["Regulator", /mouthpiece and hose that let you breathe/i],
      ["Nitrox", /breathing gas with extra oxygen/i],
    ] as const) {
      const trigger = screen.getByRole("button", { name: `What is ${item}?` });
      const describedBy = trigger.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy ?? "")?.textContent).toMatch(detail);
    }

    // The checkbox's own accessible name stays the bare item — the definition
    // is a description, never folded into what the control is called.
    expect(screen.getByRole("checkbox", { name: "BCD" })).toBeInTheDocument();
  });

  it("uses the diver-N heading once shown for more than one party member", () => {
    renderDiver(
      <BookingGearFields
        index={1}
        showDiverLabel
        rentalItems={rentalItems}
        course={null}
        pricing={pricing}
        plannedDives={2}
        currency="usd"
      />,
    );

    expect(screen.getByText("Diver 2's gear")).toBeInTheDocument();
    expect(screen.queryByText("Rental gear")).not.toBeInTheDocument();
  });

  it("field names carry the party index, so bookSpot can parse each diver separately", () => {
    const { container } = renderDiver(
      <BookingGearFields
        index={2}
        showDiverLabel
        rentalItems={rentalItems}
        course={null}
        pricing={pricing}
        plannedDives={2}
        currency="usd"
      />,
    );

    fireEvent.click(screen.getByLabelText("Need rental gear?"));
    expect(container.querySelector('input[name="gear-2-bcd"]')).not.toBeNull();
    expect(container.querySelector('input[name="gear-2-gopro"]')).not.toBeNull();
    expect(container.querySelector('input[name="nitrox-2"]')).not.toBeNull();
  });

  it("offers no nitrox on a course taught on air, however much the shop fills", () => {
    // Two gates, not one (`nitroxAvailableOn`): an Open Water class runs on
    // air, so its sessions must not advertise a fill the course cannot give —
    // and no student on one holds the verified card a fill needs anyway.
    renderDiver(
      <BookingGearFields
        index={0}
        showDiverLabel={false}
        rentalItems={rentalItems}
        course={{ nitroxCompatible: false }}
        pricing={pricing}
        plannedDives={2}
        currency="usd"
      />,
    );

    askForGear();
    // The rest of the kit is untouched — this closes one box, not the picker.
    expect(screen.getByLabelText(/^BCD/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/I’d like nitrox/)).not.toBeInTheDocument();
  });

  it("keeps the nitrox box on a course that does run on it", () => {
    renderDiver(
      <BookingGearFields
        index={0}
        showDiverLabel={false}
        rentalItems={rentalItems}
        course={{ nitroxCompatible: true }}
        pricing={pricing}
        plannedDives={2}
        currency="usd"
      />,
    );

    askForGear();
    expect(screen.getByLabelText(/I’d like nitrox/)).toBeInTheDocument();
  });

  it("quotes the set price once the diver picks the whole core kit, and adds nitrox on top", () => {
    const onSubtotalChange = vi.fn();
    renderDiver(
      <BookingGearFields
        index={0}
        showDiverLabel={false}
        rentalItems={rentalItems}
        course={null}
        pricing={pricing}
        plannedDives={2}
        currency="usd"
        onSubtotalChange={onSubtotalChange}
      />,
    );

    askForGear();
    for (const label of [/^BCD/, /^Regulator/, /^Wetsuit/, /^Mask & fins/, /^Dive computer/]) {
      fireEvent.click(screen.getByLabelText(label));
    }
    // Five of the six core pieces, priced individually, come to
    // 1500+1500+1200+800+1000 = $60.00 — more than the $45.00 set, so the
    // cheaper set price applies even though one piece is missing (H-06, HD-9).
    expect(screen.getByText("Gear for this diver: $45.00")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/^Weights/));
    expect(screen.getByText("Gear for this diver: $45.00")).toBeInTheDocument();
    expect(onSubtotalChange).toHaveBeenLastCalledWith(0, 4_500);

    fireEvent.click(screen.getByLabelText(/I’d like nitrox/));
    // Nitrox is $12/dive × 2 planned dives = $24, added on top of the $45 set.
    expect(screen.getByText("Gear for this diver: $69.00")).toBeInTheDocument();
    expect(onSubtotalChange).toHaveBeenLastCalledWith(0, 6_900);
  });

  it("renders nothing when the shop has priced no rental gear online", () => {
    const { container } = renderDiver(
      <BookingGearFields
        index={0}
        showDiverLabel={false}
        rentalItems={rentalItems}
        course={null}
        pricing={{ setCents: null, perItemCents: {}, nitroxCents: null }}
        plannedDives={2}
        currency="usd"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
