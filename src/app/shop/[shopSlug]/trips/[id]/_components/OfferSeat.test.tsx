// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { OfferSeat } from "./OfferSeat";
import { offerSeatCopy } from "./offer-seat-copy";

// The held send reaches the router once a deal's outcome carries a notice.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

const copy = offerSeatCopy(staffTranslator("en-US"));
const interests = [
  { interestId: "11111111-1111-4111-8111-111111111111", name: "Nora Quinn", email: "n@example.com" },
  { interestId: "22222222-2222-4222-8222-222222222222", name: "Rafa Ortiz", email: null },
];

function ticks(below: boolean[] = [false, false]) {
  return interests.map((interest, index) => (
    <input
      key={interest.interestId}
      type="checkbox"
      form="offer-seat"
      name="interestId"
      value={interest.interestId}
      aria-label={interest.name}
      data-below-bar={below[index] ? "true" : undefined}
    />
  ));
}

function renderOffer(chooseByTick: boolean, below?: boolean[]) {
  return render(
    <>
      {chooseByTick ? ticks(below) : null}
      <OfferSeat
        formId="offer-seat"
        tripId="33333333-3333-4333-8333-333333333333"
        interests={chooseByTick ? interests : interests.slice(0, 1)}
        chooseByTick={chooseByTick}
        label="Offer a seat to Nora Quinn"
        bookingPath="/s/blue-mantis/trips/trip-1"
        shopName="Blue Mantis"
        tripTitle="Wreck Trip"
        tripWhen="Sat 15 Aug"
        copy={copy}
      />
    </>,
  );
}

describe("OfferSeat", () => {
  it("counts what is ticked and stays off until something is", () => {
    renderOffer(true);
    expect(screen.getByRole("button", { name: "Offer a seat" })).toBeDisabled();
    act(() => {
      fireEvent.click(screen.getByLabelText("Nora Quinn"));
    });
    expect(screen.getByRole("button", { name: "Offer a seat to 1" })).toBeEnabled();
    act(() => {
      fireEvent.click(screen.getByLabelText("Rafa Ortiz"));
    });
    expect(screen.getByRole("button", { name: "Offer a seat to 2" })).toBeEnabled();
    act(() => {
      fireEvent.click(screen.getByLabelText("Nora Quinn"));
      fireEvent.click(screen.getByLabelText("Rafa Ortiz"));
    });
    expect(screen.getByRole("button", { name: "Offer a seat" })).toBeDisabled();
  });

  it("warns about ticked names below the bar and about nobody else", () => {
    renderOffer(true, [true, false]);
    expect(screen.queryByText(/below this trip’s bar/)).toBeNull();
    act(() => {
      fireEvent.click(screen.getByLabelText("Rafa Ortiz"));
    });
    expect(screen.queryByText(/below this trip’s bar/)).toBeNull();
    act(() => {
      fireEvent.click(screen.getByLabelText("Nora Quinn"));
    });
    expect(screen.getByText("1 ticked is below this trip’s bar")).toBeVisible();
  });

  it("is always the held seat_offer send, over the interest ids it was given when nothing is ticked", () => {
    const { container } = renderOffer(false);
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("id", "offer-seat");
    expect(form?.querySelector('input[name="holdKind"]')).toHaveValue("seat_offer");
    expect(form?.querySelector('input[name="tripId"]')).toHaveValue(
      "33333333-3333-4333-8333-333333333333",
    );
    const ids = [...(form?.querySelectorAll('input[name="interestId"]') ?? [])].map(
      (input) => (input as HTMLInputElement).value,
    );
    expect(ids).toEqual([interests[0]?.interestId]);
    expect(screen.getByRole("button", { name: "Offer a seat to Nora Quinn" })).toBeEnabled();
  });

  it("takes its ticks from outside the form, so the list stays while a send is held", () => {
    const { container } = renderOffer(true);
    const form = container.querySelector("form") as HTMLFormElement;
    act(() => {
      fireEvent.click(screen.getByLabelText("Nora Quinn"));
    });
    const sent = new FormData(form);
    expect(sent.getAll("interestId")).toEqual([interests[0]?.interestId]);
    expect(form.querySelector('input[name="interestId"]')).toBeNull();
  });
});
