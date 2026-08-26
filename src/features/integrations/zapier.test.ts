import { describe, expect, it } from "vitest";
import { normalizeZapierEventTypes, normalizeZapierWebhookUrl } from "./zapier";

describe("Zapier integration", () => {
  it("accepts only HTTPS Catch Hook URLs", () => {
    expect(normalizeZapierWebhookUrl("https://hooks.zapier.com/hooks/catch/123/abc/")).toBe(
      "https://hooks.zapier.com/hooks/catch/123/abc",
    );
    expect(normalizeZapierWebhookUrl("http://hooks.zapier.com/hooks/catch/123/abc")).toBeNull();
    expect(normalizeZapierWebhookUrl("https://hooks.zapier.com/hooks/send/123/abc")).toBeNull();
    expect(normalizeZapierWebhookUrl("https://hooks.zapier.com/hooks/catch/")).toBeNull();
    expect(
      normalizeZapierWebhookUrl("https://hooks.zapier.com/hooks/catch/123/abc?token=x"),
    ).toBeNull();
  });

  it("keeps event selection in the registry vocabulary and canonical order", () => {
    expect(normalizeZapierEventTypes(["order.refunded", "future.event", "order.created"])).toEqual([
      "order.created",
      "order.refunded",
    ]);
  });
});
