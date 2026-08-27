import type { BeforeSend } from "@vercel/analytics/server";
import { track as vercelTrack } from "@vercel/analytics/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AnalyticsEvent, type Tracker, trackEvent } from "./analytics";

// The default tracker is the only path that touches the network; stubbing it
// lets the provider-skip rule be asserted without making a real request.
vi.mock("@vercel/analytics/server", () => ({ track: vi.fn() }));

/**
 * Every forwarded call carries the redaction hook as its third argument — see
 * the `beforeSend` block at the foot of this file for what the hook does. It is
 * matched loosely here because these cases are about the event *mapping*; a
 * case that cared about the hook would assert on the hook.
 */
const redaction = { beforeSend: expect.any(Function) };

/** Pull the `beforeSend` a tracker was handed, so a test can run it. */
function hookFrom(tracker: { mock: { calls: unknown[][] } }): BeforeSend {
  const options = tracker.mock.calls[0]?.[2] as { beforeSend: BeforeSend };
  return options.beforeSend;
}

describe("trackEvent", () => {
  beforeEach(() => {
    vi.mocked(vercelTrack).mockClear();
  });

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
    expect(rejecting).toHaveBeenCalledWith("checkout_abandoned", { isDeposit: true }, redaction);
  });

  it("skips the default provider when external HTTP is disabled", async () => {
    // Regression: the default tracker is a network call, and `trackEvent` is
    // awaited at the top of `enterDemoAction` before the shop is minted. Under
    // restricted egress the call hangs until it fails rather than erroring
    // fast, adding that stall to a user-facing flow — in e2e it blew past the
    // 15s per-test budget with the CTA stuck on "Getting your shop ready…".
    // Best-effort telemetry must not be able to add latency either.
    vi.stubEnv("DIVEDAY_DISABLE_EXTERNAL_HTTP", "1");
    await expect(
      trackEvent({ name: "demo_entered", source: "home-hero", role: "owner" }),
    ).resolves.toBeUndefined();
    expect(vercelTrack).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("still runs an injected tracker when external HTTP is disabled", async () => {
    // The flag turns off the *provider*, not the seam: unit tests that inject
    // a tracker still exercise the mapping (mirrors marine-forecast.ts).
    vi.stubEnv("DIVEDAY_DISABLE_EXTERNAL_HTTP", "1");
    const tracker = vi.fn();
    await trackEvent({ name: "demo_entered", source: "home-hero", role: "owner" }, tracker);
    expect(tracker).toHaveBeenCalledWith(
      "demo_entered",
      { source: "home-hero", role: "owner" },
      redaction,
    );
    vi.unstubAllEnvs();
  });

  /**
   * **The capability-URL redaction.**
   *
   * `@vercel/analytics/server` composes an event's page URL itself, and DiveDay
   * fires server-side events while rendering pages where that URL *is* the
   * credential. The SDK now takes a `beforeSend` hook — added by
   * `patches/@vercel__analytics@2.0.1.patch`, which carries vercel/analytics#208
   * until it is released — and `trackEvent` passes one on every call.
   *
   * These cases run the hook the way the SDK does rather than reading the SDK's
   * source: what matters is what a bearer-token route's event carries, not how
   * the library is written.
   */
  describe("the beforeSend hook it hands the SDK", () => {
    it("redacts a capability URL down to its route", async () => {
      const tracker = vi.fn();
      await trackEvent({ name: "waiver_signed" }, tracker);
      expect(hookFrom(tracker)({ type: "event", url: "https://dive.day/waivers/tok" })).toEqual({
        type: "event",
        url: "/waivers/[token]",
      });
    });

    it("redacts a capability URL that arrives as a query parameter", async () => {
      // The `?booking=<token>` confirmation URL is not path-shaped, and the
      // SDK's own fallback is the `Referer` header — which the old
      // request-context shim could not see at all.
      const tracker = vi.fn();
      await trackEvent({ name: "booking_cancelled", source: "diver" }, tracker);
      expect(
        hookFrom(tracker)({ type: "event", url: "https://dive.day/s/blue-mantis?booking=tok" }),
      ).toEqual({ type: "event", url: "/s/blue-mantis?booking=%5Btoken%5D" });
    });

    it("leaves an ordinary page URL alone", async () => {
      const tracker = vi.fn();
      await trackEvent({ name: "trial_started", source: "pricing" }, tracker);
      expect(hookFrom(tracker)({ type: "event", url: "https://dive.day/pricing" })).toEqual({
        type: "event",
        url: "https://dive.day/pricing",
      });
    });

    it("withholds the event rather than send a URL it could not redact", async () => {
      // Fail closed, and prove it against the contract rather than the
      // implementation: `null` is how the hook says "send nothing", and losing
      // a count is cheaper than shipping a live waiver token to an ad platform.
      // `redactCapabilityUrl` does not throw today, so this is forced.
      const tracker = vi.fn();
      await trackEvent({ name: "waiver_signed" }, tracker);
      const hook = hookFrom(tracker);
      const hostile = {
        type: "event" as const,
        get url(): string {
          throw new Error("unreadable");
        },
      };
      expect(hook(hostile)).toBeNull();
    });
  });

  it("carries the funnel source on both halves of the marketing funnel", async () => {
    const tracker = vi.fn();
    await trackEvent({ name: "demo_entered", source: "pricing", role: "captain" }, tracker);
    await trackEvent({ name: "trial_started", source: "pricing" }, tracker);
    expect(tracker.mock.calls).toEqual([
      ["demo_entered", { source: "pricing", role: "captain" }, redaction],
      ["trial_started", { source: "pricing" }, redaction],
    ]);
  });

  it("carries the refusal reason for a blocked booking, the confusion signal", async () => {
    const tracker = vi.fn();
    await trackEvent(
      { name: "booking_blocked", source: "diver", reason: "course_prerequisite" },
      tracker,
    );
    expect(tracker).toHaveBeenCalledWith(
      "booking_blocked",
      { source: "diver", reason: "course_prerequisite" },
      redaction,
    );
  });

  it("carries which schedule builder mutation ran and how it landed", async () => {
    const tracker = vi.fn();
    await trackEvent(
      { name: "schedule_builder_action", action: "move", outcome: "already_sailed" },
      tracker,
    );
    expect(tracker).toHaveBeenCalledWith(
      "schedule_builder_action",
      { action: "move", outcome: "already_sailed" },
      redaction,
    );
  });

  it("distinguishes an automatic cancellation refund from a staff-run one", async () => {
    const tracker = vi.fn();
    await trackEvent({ name: "refund_issued", auto: true, status: "refunded" }, tracker);
    await trackEvent({ name: "refund_issued", auto: false, status: "manual" }, tracker);
    expect(tracker.mock.calls).toEqual([
      ["refund_issued", { auto: true, status: "refunded" }, redaction],
      ["refund_issued", { auto: false, status: "manual" }, redaction],
    ]);
  });

  it("records the trip packet button from the Overview surface", async () => {
    const tracker = vi.fn();
    await trackEvent({ name: "trip_print_pdf_clicked", surface: "trip_overview" }, tracker);
    expect(tracker).toHaveBeenCalledWith(
      "trip_print_pdf_clicked",
      { surface: "trip_overview" },
      redaction,
    );
  });
});
