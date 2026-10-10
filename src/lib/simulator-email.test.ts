import { describe, expect, it } from "vitest";
import { reservedTestRecipientDelivery } from "./notifications/provider";
import { DEMO_MAIL_DOMAIN, deliveryAddressFor, demoEmail, simulatorEmail } from "./simulator-email";

describe("simulatorEmail", () => {
  it("labels the success address with the person, one address each", () => {
    expect(simulatorEmail("Priya Sharma")).toBe("success+priya.sharma@simulator.amazonses.com");
    expect(simulatorEmail("Mary-Ann O'Neil")).toBe(
      "success+mary.ann.o.neil@simulator.amazonses.com",
    );
    expect(simulatorEmail("priya.sharma")).toBe(simulatorEmail("Priya Sharma"));
    expect(simulatorEmail("Lena Fischer")).not.toBe(simulatorEmail("Priya Sharma"));
  });

  it("names another simulator outcome when asked", () => {
    expect(simulatorEmail("bounce test", "bounce")).toBe(
      "bounce+bounce.test@simulator.amazonses.com",
    );
  });

  it("refuses a label with nothing in it to tell people apart", () => {
    expect(() => simulatorEmail(" -- ")).toThrow();
  });

  it("is an address the provider will send to", () => {
    expect(reservedTestRecipientDelivery(simulatorEmail("Priya Sharma"))).toBeNull();
  });
});

describe("demoEmail and deliveryAddressFor (UX audit item 4)", () => {
  it("gives a seeded person an address that reads like a person's", () => {
    expect(demoEmail("Priya Sharma")).toBe("priya.sharma@mail.example");
    expect(demoEmail("priya.sharma")).toBe(demoEmail("Priya Sharma"));
    expect(() => demoEmail(" -- ")).toThrow();
  });

  const demo = { demoShop: true };
  const real = { demoShop: false };

  it("sends a demo shop's seeded address to the simulator's success box, under the same label", () => {
    expect(deliveryAddressFor(demoEmail("Priya Sharma"), demo)).toBe(
      simulatorEmail("Priya Sharma"),
    );
    expect(deliveryAddressFor(`Front.Desk@${DEMO_MAIL_DOMAIN.toUpperCase()}`, demo)).toBe(
      "success+front.desk@simulator.amazonses.com",
    );
    expect(
      reservedTestRecipientDelivery(deliveryAddressFor(demoEmail("Tom Okafor"), demo)),
    ).toBeNull();
  });

  it("never maps an address on a real shop, so the provider still refuses it", () => {
    const typed = demoEmail("Priya Sharma");
    expect(deliveryAddressFor(typed, real)).toBe(typed);
    expect(reservedTestRecipientDelivery(deliveryAddressFor(typed, real))).toMatchObject({
      errorCode: "invalid_test_recipient",
    });
  });

  it("leaves every other address exactly as written, even on a demo shop", () => {
    for (const to of [
      "diver@gmail.com",
      "priya.sharma@example.com",
      "x@mail.example.com",
      "x@evilmail.example",
      "not-an-address",
    ]) {
      expect(deliveryAddressFor(to, demo)).toBe(to);
    }
  });

  it("is refused at the provider if it ever escaped the mapping", () => {
    expect(reservedTestRecipientDelivery(demoEmail("Priya Sharma"))).not.toBeNull();
  });
});
