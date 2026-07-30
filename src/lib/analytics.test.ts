import { describe, expect, it, vi } from "vitest";
import { type AnalyticsEvent, eventSource, type Tracker, trackEvent } from "./analytics";

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

  it("carries the funnel source on both halves of the marketing funnel", async () => {
    const tracker = vi.fn();
    await trackEvent({ name: "demo_entered", source: "pricing" }, tracker);
    await trackEvent({ name: "trial_started", source: "pricing" }, tracker);
    expect(tracker.mock.calls).toEqual([
      ["demo_entered", { source: "pricing" }],
      ["trial_started", { source: "pricing" }],
    ]);
  });
});

describe("eventSource", () => {
  it("keeps the slug vocabulary the marketing pages emit", () => {
    expect(eventSource("pricing")).toBe("pricing");
    expect(eventSource("switching-eve")).toBe("switching-eve");
  });

  it("falls back to unknown for anything the pages never send", () => {
    // The value reaches us from the visitor's own request, so free-form text,
    // markup, and absent values all collapse to one bucket rather than
    // becoming their own event properties.
    expect(eventSource(undefined)).toBe("unknown");
    expect(eventSource(null)).toBe("unknown");
    expect(eventSource("")).toBe("unknown");
    expect(eventSource("Pricing Page")).toBe("unknown");
    expect(eventSource("<script>alert(1)</script>")).toBe("unknown");
    expect(eventSource("a".repeat(41))).toBe("unknown");
    expect(eventSource(42)).toBe("unknown");
  });
});
