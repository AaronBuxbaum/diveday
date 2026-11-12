import { afterEach, describe, expect, it } from "vitest";
import {
  armNavigationGate,
  clearNavigationGates,
  releaseNavigationGate,
  waitForNavigationGate,
} from "./navigation-gate";

afterEach(clearNavigationGates);

describe("E2E navigation gate", () => {
  it("holds only the armed departure and releases every waiter", async () => {
    expect(waitForNavigationGate("other")).toBeUndefined();
    expect(armNavigationGate("trip")).toBe(true);
    expect(armNavigationGate("trip")).toBe(false);
    const first = waitForNavigationGate("trip");
    const second = waitForNavigationGate("trip");
    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(releaseNavigationGate("other")).toBe(false);
    expect(releaseNavigationGate("trip")).toBe(true);
    await Promise.all([first, second]);
    expect(waitForNavigationGate("trip")).toBeUndefined();
    expect(armNavigationGate("trip")).toBe(true);
  });

  it("releases pending gates on a fixture reset", async () => {
    armNavigationGate("first");
    armNavigationGate("second");
    const pending = [waitForNavigationGate("first"), waitForNavigationGate("second")];
    clearNavigationGates();
    await Promise.all(pending);
    expect(waitForNavigationGate("first")).toBeUndefined();
    expect(waitForNavigationGate("second")).toBeUndefined();
  });
});
