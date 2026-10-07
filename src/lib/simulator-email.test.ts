import { describe, expect, it } from "vitest";
import { reservedTestRecipientDelivery } from "./notifications/provider";
import {
  DEMO_MAIL_DOMAIN,
  deliveryAddressFor,
  demoEmail,
  isSimulatorEmail,
  simulatorEmail,
} from "./simulator-email";

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

describe("isSimulatorEmail", () => {
  it("knows the simulator by its domain, whatever the outcome or label", () => {
    expect(isSimulatorEmail("success@simulator.amazonses.com")).toBe(true);
    expect(isSimulatorEmail("Bounce+x@Simulator.AmazonSES.com")).toBe(true);
    expect(isSimulatorEmail("priya.sharma@example.com")).toBe(false);
    expect(isSimulatorEmail("x@simulator.amazonses.com.evil.example")).toBe(false);
  });
});

describe("demoEmail and deliveryAddressFor (UX audit item 4)", () => {
  it("gives a seeded person an address that reads like a person's", () => {
    expect(demoEmail("Priya Sharma")).toBe("priya.sharma@mail.example");
    expect(demoEmail("priya.sharma")).toBe(demoEmail("Priya Sharma"));
    expect(() => demoEmail(" -- ")).toThrow();
  });

  it("sends a seeded address to the simulator's success box, under the same label", () => {
    expect(deliveryAddressFor(demoEmail("Priya Sharma"))).toBe(simulatorEmail("Priya Sharma"));
    expect(deliveryAddressFor(`Front.Desk@${DEMO_MAIL_DOMAIN.toUpperCase()}`)).toBe(
      "success+front.desk@simulator.amazonses.com",
    );
    expect(reservedTestRecipientDelivery(deliveryAddressFor(demoEmail("Tom Okafor")))).toBeNull();
  });

  it("leaves every other address exactly as written", () => {
    for (const to of [
      "diver@gmail.com",
      "priya.sharma@example.com",
      "x@mail.example.com",
      "x@evilmail.example",
      "not-an-address",
    ]) {
      expect(deliveryAddressFor(to)).toBe(to);
    }
  });

  it("is refused at the provider if it ever escaped the mapping", () => {
    expect(reservedTestRecipientDelivery(demoEmail("Priya Sharma"))).not.toBeNull();
  });
});
