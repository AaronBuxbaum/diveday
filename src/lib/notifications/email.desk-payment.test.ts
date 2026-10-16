import { describe, expect, it } from "vitest";
import { bookingConfirmationEmail } from "./email";

const base = {
  locale: "en-US" as const,
  diverName: "Pat Diver",
  shopName: "Blue Mantis",
  tripTitle: "Two-Tank Reef",
  startsAt: new Date("2026-08-01T13:00:00.000Z"),
  endsAt: new Date("2026-08-01T17:00:00.000Z"),
  timezone: "America/New_York",
};

/** Intl's narrow and non-breaking spaces, as plain ones, for reading a body as a person would. */
const flat = (text: string) => text.replace(/[  ]/g, " ");

describe("how the desk takes money (fifth-loop ideas, item 21)", () => {
  it("says it after a figure due at the shop", () => {
    expect(
      flat(
        bookingConfirmationEmail({
          ...base,
          money: { due: "at_shop", amountCents: 12_000, currency: "usd", deskPayment: "card" },
        }).text,
      ),
    ).toContain("Your seat: $120.00, due at the shop. Pay by card when you arrive.");
  });

  it("says it for a party, in Spanish", () => {
    expect(
      flat(
        bookingConfirmationEmail({
          ...base,
          locale: "es-ES",
          money: {
            due: "at_shop",
            amountCents: 28_500,
            currency: "usd",
            seats: 3,
            deskPayment: "card_and_cash",
          },
        }).text,
      ),
    ).toContain("Paga con tarjeta o en efectivo al llegar.");
  });

  it("says nothing when the shop has not said", () => {
    const text = bookingConfirmationEmail({
      ...base,
      money: { due: "at_shop", amountCents: 12_000, currency: "usd" },
    }).text;
    expect(text).not.toContain("when you arrive");
  });
});
