// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  OfferDiscountDisclosure,
  OfferDiscountProvider,
  OfferDiscountRider,
} from "./OfferDiscount";
import { OfferSeat } from "./OfferSeat";
import { offerSeatCopy } from "./offer-seat-copy";

// The held send reaches the router once a deal's outcome carries a notice.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

const copy = offerSeatCopy(staffTranslator("en-US"));
const interests = [
  {
    interestId: "11111111-1111-4111-8111-111111111111",
    name: "Nora Quinn",
    email: "n@example.com",
  },
  { interestId: "22222222-2222-4222-8222-222222222222", name: "Rafa Ortiz", email: null },
];

const discountCopy = {
  toggle: "Add a discount to offers",
  hint: "Each offer below goes out with this discount.",
  amountAriaLabel: "Discount",
  kindAriaLabel: "Discount type",
  currencySymbol: "$",
};

/** Two rows of Who wants in: each its own Offer, one discount disclosure above. */
function renderRows({ discount = false }: { discount?: boolean } = {}) {
  return render(
    <OfferDiscountProvider>
      {discount ? <OfferDiscountDisclosure copy={discountCopy} /> : null}
      {interests.map((interest) => (
        <OfferSeat
          key={interest.interestId}
          formId={`offer-seat-${interest.interestId}`}
          tripId="33333333-3333-4333-8333-333333333333"
          interests={[interest]}
          ariaLabel={`Offer ${interest.name} a seat`}
          bookingPath="/s/blue-mantis/trips/trip-1"
          shopName="Blue Mantis"
          tripTitle="Wreck Trip"
          tripWhen="Sat 15 Aug"
          copy={copy}
          discountFields={discount ? <OfferDiscountRider /> : null}
        />
      ))}
    </OfferDiscountProvider>,
  );
}

function formOf(name: string): HTMLFormElement {
  const form = screen.getByRole("button", { name: `Offer ${name} a seat` }).closest("form");
  if (!form) throw new Error(`no form for ${name}`);
  return form;
}

describe("OfferSeat", () => {
  it("is one row's held seat_offer send, to that row's person only", () => {
    renderRows();
    const form = formOf("Nora Quinn");
    expect(form.querySelector('input[name="holdKind"]')).toHaveValue("seat_offer");
    expect(form.querySelector('input[name="tripId"]')).toHaveValue(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(new FormData(form).getAll("interestId")).toEqual([interests[0]?.interestId]);
    expect(new FormData(formOf("Rafa Ortiz")).getAll("interestId")).toEqual([
      interests[1]?.interestId,
    ]);
    // Every row's words are the same; its name for a reader says whose it is.
    expect(screen.getAllByText("Offer a seat")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Offer Nora Quinn a seat" })).toBeEnabled();
    // No tick boxes anywhere: one act per row.
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("posts no discount from any row while the disclosure is closed", () => {
    renderRows({ discount: true });
    for (const name of ["Nora Quinn", "Rafa Ortiz"]) {
      const sent = new FormData(formOf(name));
      expect(sent.has("discount")).toBe(false);
      expect(sent.has("discountKind")).toBe(false);
    }
  });

  it("rides the opened discount with each row's own offer (A14, H-145)", () => {
    const { container } = renderRows({ discount: true });
    const disclosure = container.querySelector("details[data-offer-discount]");
    if (!(disclosure instanceof HTMLDetailsElement)) throw new Error("no discount disclosure");
    act(() => {
      disclosure.open = true;
      fireEvent(disclosure, new Event("toggle"));
    });
    act(() => {
      fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "15" } });
      fireEvent.change(screen.getByLabelText("Discount type"), { target: { value: "amount" } });
    });
    for (const name of ["Nora Quinn", "Rafa Ortiz"]) {
      const sent = new FormData(formOf(name));
      expect(sent.get("discount")).toBe("15");
      expect(sent.get("discountKind")).toBe("amount");
    }
    // Closed again, the next offer is an ordinary one.
    act(() => {
      disclosure.open = false;
      fireEvent(disclosure, new Event("toggle"));
    });
    expect(new FormData(formOf("Nora Quinn")).has("discount")).toBe(false);
  });

  it("disables every row's Offer while the opened discount is blank (layer 3 security note 1)", () => {
    const { container } = renderRows({ discount: true });
    const disclosure = container.querySelector("details[data-offer-discount]");
    if (!(disclosure instanceof HTMLDetailsElement)) throw new Error("no discount disclosure");
    act(() => {
      disclosure.open = true;
      fireEvent(disclosure, new Event("toggle"));
    });
    act(() => {
      fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "" } });
    });
    for (const name of ["Nora Quinn", "Rafa Ortiz"]) {
      expect(screen.getByRole("button", { name: `Offer ${name} a seat` })).toBeDisabled();
      expect(new FormData(formOf(name)).has("discountKind")).toBe(false);
    }
    // An amount, or the disclosure closed, gives the act back.
    act(() => {
      fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "10" } });
    });
    expect(screen.getByRole("button", { name: "Offer Nora Quinn a seat" })).toBeEnabled();
    act(() => {
      fireEvent.change(screen.getByLabelText("Discount"), { target: { value: " " } });
    });
    act(() => {
      disclosure.open = false;
      fireEvent(disclosure, new Event("toggle"));
    });
    expect(screen.getByRole("button", { name: "Offer Nora Quinn a seat" })).toBeEnabled();
  });

  it("keeps the Today row's own words for a single named offer", () => {
    render(
      <OfferSeat
        formId="offer-seat-today"
        tripId="33333333-3333-4333-8333-333333333333"
        interests={interests.slice(0, 1)}
        label="Offer a seat to Nora Quinn"
        bookingPath="/s/blue-mantis/trips/trip-1"
        shopName="Blue Mantis"
        tripTitle="Wreck Trip"
        tripWhen="Sat 15 Aug"
        copy={copy}
      />,
    );
    expect(screen.getByRole("button", { name: "Offer a seat to Nora Quinn" })).toBeEnabled();
  });
});
