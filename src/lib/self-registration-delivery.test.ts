import { describe, expect, it } from "vitest";
import { inMemoryRateLimitStore, RATE_LIMITS } from "./rate-limit";
import { anonymousTextRecipient } from "./self-registration";
import { selfRegistrationReleaseDelivery } from "./self-registration-delivery";

const usShop = { id: "shop-us", addressCountry: "US", isDemo: false };
const now = Date.UTC(2026, 9, 6, 12);

describe("anonymousTextRecipient: which numbers the counter QR will text", () => {
  it("texts a number in the shop's own country, in E.164", () => {
    expect(anonymousTextRecipient("(305) 555-0110", usShop)).toEqual({
      recipient: "+13055550110",
    });
    expect(anonymousTextRecipient("+1 305 555 0110", usShop)).toEqual({
      recipient: "+13055550110",
    });
  });

  it("refuses a number under another calling code: the premium-route pump", () => {
    expect(anonymousTextRecipient("+44 7700 900123", usShop)).toEqual({
      refused: "foreign_number",
    });
    expect(anonymousTextRecipient("00 882 1234 5678", usShop)).toEqual({
      refused: "foreign_number",
    });
  });

  it("refuses everything from a shop whose country it cannot read", () => {
    expect(anonymousTextRecipient("+13055550110", { ...usShop, addressCountry: null })).toEqual({
      refused: "foreign_number",
    });
  });

  it("refuses a number it cannot read", () => {
    expect(anonymousTextRecipient("555-0110", usShop)).toEqual({ refused: "unreadable_number" });
  });

  it("never texts from a demo shop", () => {
    expect(anonymousTextRecipient("+13055550110", { ...usShop, isDemo: true })).toEqual({
      refused: "demo_shop",
    });
  });
});

describe("selfRegistrationReleaseDelivery", () => {
  it("sends to a phone-only registrant at home, and drops the fourth text to one number in an hour", async () => {
    const store = inMemoryRateLimitStore();
    const send = () =>
      selfRegistrationReleaseDelivery(
        usShop,
        { email: null, phone: "305-555-0110" },
        { now, store },
      );
    expect([await send(), await send(), await send(), await send()]).toEqual([
      "send",
      "send",
      "send",
      "rate_limited",
    ]);
  });

  it("counts one number across every shop, however it is typed", async () => {
    const store = inMemoryRateLimitStore();
    const other = { ...usShop, id: "shop-us-2" };
    const results = [
      await selfRegistrationReleaseDelivery(
        usShop,
        { email: null, phone: "305 555 0110" },
        { now, store },
      ),
      await selfRegistrationReleaseDelivery(
        other,
        { email: null, phone: "+1 (305) 555-0110" },
        { now, store },
      ),
      await selfRegistrationReleaseDelivery(
        usShop,
        { email: null, phone: "13055550110" },
        { now, store },
      ),
      await selfRegistrationReleaseDelivery(
        other,
        { email: null, phone: "305.555.0110" },
        { now, store },
      ),
    ];
    expect(results).toEqual(["send", "send", "send", "rate_limited"]);
  });

  it("caps a shop's anonymous texts per day, many numbers once each", async () => {
    const store = inMemoryRateLimitStore();
    const cap = RATE_LIMITS.selfRegisterTextByShop.capacity;
    const results: string[] = [];
    for (let i = 0; i <= cap; i++) {
      const phone = `305555${String(1000 + i).padStart(4, "0")}`;
      results.push(
        await selfRegistrationReleaseDelivery(usShop, { email: null, phone }, { now, store }),
      );
    }
    expect(results.slice(0, cap).every((result) => result === "send")).toBe(true);
    expect(results[cap]).toBe("rate_limited");
  });

  it("never spends a shop's daily text on a number it refused", async () => {
    const store = inMemoryRateLimitStore();
    const cap = RATE_LIMITS.selfRegisterTextByShop.capacity;
    for (let i = 0; i < cap + 5; i++) {
      await selfRegistrationReleaseDelivery(
        usShop,
        { email: null, phone: `+44 7700 9${String(10000 + i)}` },
        { now, store },
      );
    }
    expect(
      await selfRegistrationReleaseDelivery(
        usShop,
        { email: null, phone: "305-555-0199" },
        { now, store },
      ),
    ).toBe("send");
  });

  it("emails whenever there is an address, under its own bucket", async () => {
    const store = inMemoryRateLimitStore();
    const send = () =>
      selfRegistrationReleaseDelivery(
        { ...usShop, isDemo: true },
        { email: "ines@example.com", phone: "+44 7700 900123" },
        { now, store },
      );
    expect([await send(), await send(), await send(), await send()]).toEqual([
      "send",
      "send",
      "send",
      "rate_limited",
    ]);
  });

  it("says why a text was not sent", async () => {
    const store = inMemoryRateLimitStore();
    expect(
      await selfRegistrationReleaseDelivery(
        { ...usShop, isDemo: true },
        { email: null, phone: "305-555-0110" },
        { now, store },
      ),
    ).toBe("demo_shop");
    expect(
      await selfRegistrationReleaseDelivery(
        usShop,
        { email: null, phone: "+44 7700 900123" },
        { now, store },
      ),
    ).toBe("foreign_number");
  });
});
