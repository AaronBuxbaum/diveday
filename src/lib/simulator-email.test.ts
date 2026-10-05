import { describe, expect, it } from "vitest";
import { reservedTestRecipientDelivery } from "./notifications/provider";
import { isSimulatorEmail, simulatorEmail } from "./simulator-email";

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
