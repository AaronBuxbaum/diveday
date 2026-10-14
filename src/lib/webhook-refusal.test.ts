import { afterEach, describe, expect, it, vi } from "vitest";
import { logWebhookRefusal } from "./webhook-refusal";

describe("logWebhookRefusal", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one warn line carrying the webhook and the verifier's reason", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWebhookRefusal("ses", "invalid_signature");
    expect(warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(line).toMatchObject({
      level: "warn",
      event: "webhook.refused",
      webhook: "ses",
      reason: "invalid_signature",
    });
  });
});
