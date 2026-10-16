import { describe, expect, it } from "vitest";
import { shopNameNeedsReview } from "./shop-name-review";

/**
 * **A shop name that could pass for someone else in a From column** (issue
 * #2450, Aaron's option 2): mail leads with "{Shop} via DiveDay", so a shop
 * called "PayPal Security" would send as that from DiveDay's own domain. A
 * match is flagged for a human; until one clears it the shop's mail goes out
 * under the plain "DiveDay" name. Two lists below: the obvious cases it must
 * catch, and the real dive-shop names it must leave alone.
 */
describe("shopNameNeedsReview", () => {
  it.each([
    "PayPal Security",
    "Stripe Support",
    "Chase Bank Divers",
    "Wells Fargo Fraud Team",
    "Amazon Customer Service",
    "Apple ID Support",
    "Microsoft Account Team",
    "DiveDay Support",
    "Dive Day Billing",
    "Official Account Verification",
    "IRS Refunds",
    "FedEx Delivery",
    "Bank of America",
    "Helpdesk",
    "Security Alert",
  ])("flags %s", (name) => {
    expect(shopNameNeedsReview(name)).toBe(true);
  });

  it.each([
    "P a y P a l",
    "Pay-Pal Reef",
    "PAYPAL",
    "Paypa1 Divers",
    "Amaz0n Billing",
    "Str1pe Support",
    "Sup.port Desk",
    "Ｐａｙｐａｌ Divers",
    "Рaypal Divers",
    "Pay​Pal Divers",
    "Paýpal Divers",
  ])("flags a disguised %s", (name) => {
    expect(shopNameNeedsReview(name)).toBe(true);
  });

  it.each([
    "Blue Mantis Divers",
    "Reef & Wreck Co.",
    "Banana Reef Dive Shop",
    "Coral Cove Scuba",
    "Playa del Carmen Dive Center",
    "Turks & Caicos Deep Blue",
    "Cozumel Island Diving",
    "Bonaire Dive Adventures",
    "Aqua Lung Adventures",
    "Sea Hunt Charters",
    "The Pay Dirt Wreck Divers",
    "Suppose We Dive",
    "Visage Diving",
    "Chaser Charters",
    "Pineapple Reef Divers",
    "Metallica Dive",
    "Grapple Dive Co",
    "",
  ])("leaves %s alone", (name) => {
    expect(shopNameNeedsReview(name)).toBe(false);
  });

  it("flags known false positives, which a human clears", () => {
    // Real places that read like trust words: accepted, because a flagged shop
    // still sends, only under the plain DiveDay name, until someone clears it.
    expect(shopNameNeedsReview("Silver Bank Whale Divers")).toBe(true);
    expect(shopNameNeedsReview("Apple Bay Divers")).toBe(true);
  });
});
