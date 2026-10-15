// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { PartyPaymentSection } from "./PartyPaymentSection";
import type { PaymentStatusControlCopy } from "./PaymentStatusControl";
import type { PartyPreview } from "./roster-model";

afterEach(cleanup);

const t = staffTranslator("en-US");

const COPY = {
  amountLabel: "Amount taken",
  methodLabel: "Paid by",
  methods: { cash: "Cash", card: "Card", other: "Other" },
  forgiving: { typedAs: "Typed as {raw}" },
} as unknown as PaymentStatusControlCopy;

const PARTY = { seatCount: 3, owed: "$360.00", currency: "usd", locale: "en-US" };

const PREVIEW: PartyPreview = {
  leadBookingId: "lead-1",
  amountCents: 15_000,
  method: "cash",
  shares: [
    { bookingId: "lead-1", personName: "Nora Quinn", amountCents: 12_000, settles: true },
    { bookingId: "seat-2", personName: "Ada Quinn", amountCents: 3_000, settles: false },
  ],
  unspentCents: 21_000,
};

function section(preview: PartyPreview | null) {
  return render(
    <PartyPaymentSection
      bookingId="lead-1"
      party={{ ...PARTY, preview }}
      previewAction={vi.fn()}
      confirmAction={vi.fn()}
      copy={COPY}
      t={t}
    />,
  );
}

describe("PartyPaymentSection", () => {
  it("is closed and asks for an amount and a method, with no method chosen for the staffer", () => {
    section(null);
    expect(screen.getByTestId("party-payment")).not.toHaveAttribute("open");
    expect(
      screen.getByText("3 seats in this party still owe $360.00 together."),
    ).toBeInTheDocument();
    for (const name of ["Cash", "Card", "Other"]) {
      expect(screen.getByRole("radio", { name })).not.toBeChecked();
      expect(screen.getByRole("radio", { name })).toBeRequired();
    }
    expect(screen.queryByTestId("party-payment-split")).toBeNull();
    expect(screen.getByRole("button", { name: "Show the split" })).toBeInTheDocument();
  });

  it("shows the server's split, seat by seat, and what is still owed, before the confirm", () => {
    section(PREVIEW);
    expect(screen.getByTestId("party-payment")).toHaveAttribute("open");
    const split = screen.getByTestId("party-payment-split");
    expect(within(split).getByText("Nora Quinn: $120.00, paid in full")).toBeInTheDocument();
    expect(within(split).getByText("Ada Quinn: $30.00 toward the balance")).toBeInTheDocument();
    expect(within(split).getByText("$210.00 would still be owed after this.")).toBeInTheDocument();
    expect(
      within(split).getByRole("button", { name: "Take $150.00 for the party" }),
    ).toBeInTheDocument();
    // The confirm carries only the lead, the amount and the method, never the split.
    const fields = [...split.querySelectorAll("input[type=hidden]")].map((input) => [
      input.getAttribute("name"),
      input.getAttribute("value"),
    ]);
    expect(fields).toEqual([
      ["bookingId", "lead-1"],
      ["amount", "150"],
      ["method", "cash"],
    ]);
  });

  it("says nothing about a remainder when the payment clears the party", () => {
    section({ ...PREVIEW, unspentCents: 0 });
    expect(screen.queryByText(/would still be owed/)).toBeNull();
  });

  it("reopens the form holding the amount and method that were previewed", () => {
    section(PREVIEW);
    expect(screen.getByRole("radio", { name: "Cash" })).toBeChecked();
  });
});
