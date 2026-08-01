import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "./log";

describe("log", () => {
  beforeEach(() => {
    vi.stubEnv("DIVEDAY_CLOCK", "2026-08-01T12:00:00.000Z");
    vi.stubEnv("DATABASE_URL", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("writes an info line to console.log as one JSON object with event, level, and time", () => {
    log("stripe_webhook.event_claimed", "info", { eventId: "evt_1" });

    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    const line = vi.mocked(console.log).mock.calls[0]?.[0] as string;
    expect(() => JSON.parse(line)).not.toThrow();
    expect(JSON.parse(line)).toEqual({
      time: "2026-08-01T12:00:00.000Z",
      level: "info",
      event: "stripe_webhook.event_claimed",
      eventId: "evt_1",
    });
  });

  it("routes a warn level to console.warn", () => {
    log("resend_webhook.unknown_message", "warn", { providerMessageId: "em_1" });

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
    const line = vi.mocked(console.warn).mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toEqual({
      time: "2026-08-01T12:00:00.000Z",
      level: "warn",
      event: "resend_webhook.unknown_message",
      providerMessageId: "em_1",
    });
  });

  it("routes an error level to console.error", () => {
    log("checkout.paid_account_mismatch", "error", { checkoutId: "chk_1" });

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
    const line = vi.mocked(console.error).mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toEqual({
      time: "2026-08-01T12:00:00.000Z",
      level: "error",
      event: "checkout.paid_account_mismatch",
      checkoutId: "chk_1",
    });
  });

  it("defaults context to an empty object, emitting just event/level/time", () => {
    log("cron_reminders.scan_complete", "info");

    const line = vi.mocked(console.log).mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toEqual({
      time: "2026-08-01T12:00:00.000Z",
      level: "info",
      event: "cron_reminders.scan_complete",
    });
  });
});
