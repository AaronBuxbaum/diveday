// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tripCreditAction } from "../trip-credit-actions";
import { TripCreditForms, type TripCreditWords } from "./TripCreditForms";

vi.mock("../trip-credit-actions", () => ({ tripCreditAction: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const words: TripCreditWords = {
  grant: "Grant promotional credit",
  more: "Grant more credit",
  amount: "Amount (USD)",
  reason: "Reason",
  goodwill: "Goodwill",
  promotion: "Promotion",
  busy: "Saving",
  apply: "Apply {amount} credit",
  eligible: "Apply to an unpaid booking",
  noEligible: "No eligible bookings",
  policy: "Basic fares only",
  granted: "Granted {amount}. Balance: {balance}",
  applied: "Applied {amount}. Balance: {balance}",
  errors: {
    invalid: "Invalid",
    not_authorized: "Not authorized",
    not_found: "Not found",
    unavailable: "Unavailable",
    insufficient: "Insufficient",
    changed: "Changed",
    busy: "Busy",
  },
};
const props = {
  personId: "person",
  currency: "usd",
  locale: "en-US",
  balanceCents: 20_000,
  canGrant: true,
  grantAttemptId: "grant-1",
  options: [
    {
      bookingId: "booking-1",
      attemptId: "redeem-1",
      title: "Two-tank reef",
      date: "July 25, 2026, 8:00 AM EDT",
      fareCents: 10_000,
    },
  ],
  words,
  forgiving: { typedAs: "Typed as {raw}" },
};

describe("trip credit intent controls", () => {
  it("keeps the same grant intent until success and requires an explicit new grant", async () => {
    vi.mocked(tripCreditAction).mockResolvedValue({
      ok: true,
      kind: "grant",
      amountCents: 5_000,
      balanceCents: 25_000,
      currency: "usd",
    });
    render(<TripCreditForms {...props} />);
    await userEvent.type(screen.getByLabelText("Amount (USD)"), "50");
    await userEvent.click(screen.getByRole("button", { name: words.grant }));
    await waitFor(() => expect(tripCreditAction).toHaveBeenCalledTimes(1));
    const posted = vi.mocked(tripCreditAction).mock.calls[0][1];
    expect(posted.get("attemptId")).toBe("grant-1");
    expect(posted.get("amount")).toBe("50");
    expect(await screen.findByRole("button", { name: words.more })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: words.grant })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: words.more }));
    expect(screen.getByRole("button", { name: words.grant })).toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>('input[name="attemptId"]')?.value).not.toBe(
      "grant-1",
    );
  });
  it("posts the quoted full fare and shows promotional value with the remaining balance", async () => {
    vi.mocked(tripCreditAction).mockResolvedValue({
      ok: true,
      kind: "redeem",
      amountCents: 10_000,
      balanceCents: 10_000,
      currency: "usd",
    });
    render(<TripCreditForms {...props} canGrant={false} />);
    expect(screen.queryByRole("button", { name: words.grant })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Apply $100.00 credit" }));
    expect(await screen.findByText("Applied $100.00. Balance: $100.00")).toBeInTheDocument();
    const posted = vi.mocked(tripCreditAction).mock.calls[0][1];
    expect(posted.get("kind")).toBe("redeem");
    expect(posted.get("bookingId")).toBe("booking-1");
    expect(posted.get("expectedFareCents")).toBe("10000");
  });
  it("disables an unaffordable fare and retains long translated labels as visible text", () => {
    render(
      <TripCreditForms
        {...props}
        canGrant={false}
        balanceCents={9_000}
        words={{
          ...words,
          eligible: "Aplicar el crédito promocional a una reserva pendiente de pago",
          apply: "Aplicar {amount} de crédito promocional para esta salida",
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Aplicar \$100.00 de crédito promocional/ }),
    ).toBeDisabled();
    expect(
      screen.getByText("Aplicar el crédito promocional a una reserva pendiente de pago"),
    ).toBeInTheDocument();
  });
});
