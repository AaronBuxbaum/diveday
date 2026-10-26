import { describe, expect, it } from "vitest";
import { setupRequestAlertEmail } from "./email";

/**
 * "Which one?" (2026-10-22): the onboarding mail names the system a requester
 * uses when they named one, so the first reply can start from the right guide.
 * A sibling of `email.test.ts`, which is at its length baseline.
 */
describe("setupRequestAlertEmail names the system", () => {
  const request = {
    shopName: "Reef Line Divers",
    region: "Key Largo",
    runsBoat: true,
    currentSystem: "booking_system" as const,
    contactName: "Ana Ruiz",
    contactEmail: "ana@reefline.example",
    source: "switching-fareharbor-concierge",
    requestLocale: "en-US",
  };

  it("keeps an unanswered current tool explicit without calling it paper or another system", () => {
    const message = setupRequestAlertEmail({ ...request, currentSystem: undefined });
    expect(message.text).toContain("Uses today: Not provided");
    expect(message.html).toContain("Not provided");
  });

  it("after the answer, when one was named", () => {
    expect(setupRequestAlertEmail({ ...request, currentSystemGuide: "fareharbor" }).text).toContain(
      "Uses today: a booking system, FareHarbor",
    );
    expect(
      setupRequestAlertEmail({
        ...request,
        currentSystem: "shop_software",
        currentSystemGuide: "eve",
      }).html,
    ).toContain("Uses today: <strong>dive-shop software, EVE</strong>");
  });

  it("and the answer alone when none was", () => {
    expect(setupRequestAlertEmail(request).text).toContain("Uses today: a booking system\n");
  });
});
