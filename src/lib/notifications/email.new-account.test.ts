import { describe, expect, it } from "vitest";
import { newAccountAlertEmail } from "./email";

describe("newAccountAlertEmail", () => {
  it("says so when the shop's name is held for review (issue #2450)", () => {
    const input = {
      ownerName: "Pat Diver",
      ownerEmail: "pat@example.com",
      shopName: "PayPal Security",
      shopSlug: "paypal-security",
    };
    expect(newAccountAlertEmail(input).text).not.toContain("flagged");
    const flagged = newAccountAlertEmail({ ...input, nameFlagged: true });
    expect(flagged.text).toContain("Name flagged for review");
    expect(flagged.html).toContain("Name flagged for review");
  });
});
