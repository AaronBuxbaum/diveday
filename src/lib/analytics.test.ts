import { describe, expect, it, vi } from "vitest";
import { type AnalyticsEvent, type Tracker, trackEvent } from "./analytics";

describe("trackEvent", () => {
  it("splits the event name from its properties and forwards them", async () => {
    const calls: Array<{ name: string; props: unknown }> = [];
    const tracker: Tracker = (name, props) => {
      calls.push({ name, props });
    };
    const event: AnalyticsEvent = {
      name: "staff_recovery",
      kind: "waiver_sent",
      surface: "today",
    };
    await trackEvent(event, tracker);
    expect(calls).toEqual([
      { name: "staff_recovery", props: { kind: "waiver_sent", surface: "today" } },
    ]);
  });

  it("never throws when the tracker fails — telemetry is best-effort", async () => {
    const tracker: Tracker = () => {
      throw new Error("provider down");
    };
    await expect(
      trackEvent({ name: "blockers_surfaced", count: 3, urgent: 1 }, tracker),
    ).resolves.toBeUndefined();
  });

  it("awaits an async tracker and swallows a rejected promise", async () => {
    const rejecting = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(
      trackEvent({ name: "checkout_abandoned", isDeposit: true }, rejecting),
    ).resolves.toBeUndefined();
    expect(rejecting).toHaveBeenCalledWith("checkout_abandoned", { isDeposit: true });
  });
});
