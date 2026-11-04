import { describe, expect, it } from "vitest";
import { reservedTestRecipientDelivery } from "./notifications/provider";
import { demoEmail, simulatorEmail } from "./simulator-email";

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

describe("demoEmail (UX audit item 4)", () => {
  it("gives a seeded person an address that reads like a person's", () => {
    expect(demoEmail("Priya Sharma")).toBe("priya.sharma@mail.example");
    expect(demoEmail("priya.sharma")).toBe(demoEmail("Priya Sharma"));
    expect(() => demoEmail(" -- ")).toThrow();
  });

  it("is refused at the provider, so it can never reach an inbox", () => {
    expect(reservedTestRecipientDelivery(demoEmail("Priya Sharma"))).not.toBeNull();
  });
});
