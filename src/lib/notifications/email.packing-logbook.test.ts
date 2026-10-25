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

/**
 * The confirmation's packing checklist ends with a logbook when the shop
 * suggests one (`shops.packing_logbook`, issue #2795): a flag, said in the
 * diver's own language, rather than a line of the shop's English list.
 */
describe("bookingConfirmationEmail, the logbook line", () => {
  it("ends the checklist with a logbook, in the diver's language, when the shop suggests one", () => {
    const email = bookingConfirmationEmail({
      ...base,
      packingList: ["Reef-safe sunscreen"],
      packingLogbook: true,
    });
    expect(email.text).toContain("- Reef-safe sunscreen\n- Logbook");
    const spanish = bookingConfirmationEmail({ ...base, locale: "es-ES", packingLogbook: true });
    expect(spanish.text).toContain("- Bitácora de buceo");
  });

  it("leaves it off when the shop does not", () => {
    const email = bookingConfirmationEmail({ ...base, packingList: ["Reef-safe sunscreen"] });
    expect(email.text).toContain("- Reef-safe sunscreen");
    expect(email.text).not.toContain("Logbook");
  });
});
