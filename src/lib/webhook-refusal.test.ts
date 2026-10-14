import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MINUTE_MS } from "./clock";
import { forgetWebhookRefusalReports, logWebhookRefusal } from "./webhook-refusal";

function linesFrom(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((call) => JSON.parse(String(call[0])));
}

describe("logWebhookRefusal", () => {
  beforeEach(() => forgetWebhookRefusalReports());
  afterEach(() => vi.restoreAllMocks());

  it("writes one warn line carrying the webhook, the verifier's reason and the count", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWebhookRefusal("ses", "invalid_signature", 0);
    expect(linesFrom(warn)).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "webhook.refused",
        webhook: "ses",
        reason: "invalid_signature",
        swallowed: 1,
      }),
    ]);
  });

  /**
   * **Three unsigned curls page nobody** (security review, batch 6). The
   * endpoints are public, so a bad signature is what any stranger gets: one
   * line a minute per webhook and reason, carrying how many it stands for.
   */
  it("damps a bad signature to one line a minute, and counts what it swallowed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const at of [0, 1_000, 2_000]) logWebhookRefusal("stripe", "invalid_signature", at);
    logWebhookRefusal("stripe", "invalid_signature", MINUTE_MS + 1);
    // Another webhook is its own bucket.
    logWebhookRefusal("sms", "invalid_signature", 3_000);

    expect(linesFrom(warn).map((line) => [line.webhook, line.swallowed])).toEqual([
      ["stripe", 1],
      ["stripe", 3],
      ["sms", 1],
    ]);
  });

  /** A missing secret is the deployment's own fault: every one is written, as an error. */
  it("writes every missing secret undamped, on a line of its own", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWebhookRefusal("stripe", "not_configured", 0);
    logWebhookRefusal("stripe", "not_configured", 0);
    expect(warn).not.toHaveBeenCalled();
    expect(linesFrom(error)).toEqual([
      expect.objectContaining({ event: "webhook.unconfigured", webhook: "stripe" }),
      expect.objectContaining({ event: "webhook.unconfigured", webhook: "stripe" }),
    ]);
  });
});
